// `trail` for the "Bản đồ code" tab (app/api/codemap/*). Every run is argv only (never a shell), in
// the root of a project HQ has registered (looked up by id, never a path from the browser), with a
// hard timeout and a cap on what it may print. On Windows `trail` is an npm `.cmd` shim, which Node
// will not spawn without a shell: the shim's script runs under node instead (like npmCommand in
// play.ts). Pure parts: lib/codemap.ts. Tested in tests/codemap.test.ts.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { buildProgress, checkProjectId, stripAnsi, type BuildState, type IndexState } from "@/lib/codemap";
import { childEnv } from "./child-env";
import { killTree } from "./play";

export const READ_TIMEOUT_MS = 60_000;
export const BUILD_TIMEOUT_MS = 10 * 60_000;
/** What a read may print before it is stopped: a map or a page of hits fits well under it. */
export const OUTPUT_CAP = 200 * 1024;
/** A graphify graph.html larger than this is not sent to the browser. */
export const GRAPH_MAX = 40 * 1024 * 1024;
/** Reads at once across the server; one more answers 429 (each is a node process). */
export const READS_MAX = 3;
/** Builds at once across the server (one per project). */
export const BUILDS_MAX = 2;
const STDERR_KEEP = 16 * 1024;

export type TrailCommand = { cmd: string; pre: string[] };
export type TrailOut = { ok: boolean; code: number | null; stdout: string; stderr: string; timedOut: boolean; capped: boolean; missing: boolean };
export type Project = { id: number; name: string; root: string };
export type Refusal = { error: string; status: number };

type Fsx = { exists: (p: string) => boolean; read: (p: string) => string };
const realFs: Fsx = { exists: fs.existsSync, read: (p) => fs.readFileSync(p, "utf8") };

/**
 * How to run `trail` without a shell, or null when it is not on PATH. Windows: `trail.exe` as is; an
 * npm/pnpm `trail.cmd` shim is read for the script it starts (`"%dp0%\node_modules\…\trail.js"`),
 * run by the shim's own node.exe when it has one, else by the node running HQ.
 */
export function trailCommand(o: { env?: Record<string, string | undefined>; platform?: NodeJS.Platform; execPath?: string; fsx?: Fsx } = {}): TrailCommand | null {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const fsx = o.fsx ?? realFs;
  const p = platform === "win32" ? path.win32 : path.posix;
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  const dirs = (key ? (env[key] ?? "") : "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  for (const dir of dirs) {
    if (platform !== "win32") {
      if (fsx.exists(p.join(dir, "trail"))) return { cmd: p.join(dir, "trail"), pre: [] };
      continue;
    }
    if (fsx.exists(p.join(dir, "trail.exe"))) return { cmd: p.join(dir, "trail.exe"), pre: [] };
    const shim = p.join(dir, "trail.cmd");
    if (!fsx.exists(shim)) continue;
    let text = "";
    try {
      text = fsx.read(shim);
    } catch {
      continue;
    }
    const m = /"%~?dp0%?\\([^"%]+?\.(?:js|cjs|mjs))"/i.exec(text);
    if (!m) continue;
    const script = p.join(dir, m[1]);
    if (!fsx.exists(script)) continue;
    const own = p.join(dir, "node.exe");
    return { cmd: fsx.exists(own) ? own : (o.execPath ?? process.execPath), pre: [script] };
  }
  return null;
}

/**
 * One `trail` run. Stops it (and what it started) at `timeoutMs`, or as soon as stdout passes `cap`
 * (the first `cap` bytes are kept); stderr keeps its last 16 KB. `onData` sees both streams as they come.
 */
export function runTrail(args: string[], o: { cwd: string; timeoutMs: number; cap: number; onData?: (text: string) => void; command?: TrailCommand | null; env?: Record<string, string> }): Promise<TrailOut> {
  const command = o.command === undefined ? trailCommand() : o.command;
  const { promise, resolve } = Promise.withResolvers<TrailOut>();
  const done = (x: Partial<TrailOut>) => resolve({ ok: false, code: null, stdout: "", stderr: "", timedOut: false, capped: false, missing: false, ...x });
  if (!command) {
    done({ missing: true });
    return promise;
  }
  const child = spawn(command.cmd, [...command.pre, ...args], {
    cwd: o.cwd,
    env: { ...childEnv(), NO_COLOR: "1", FORCE_COLOR: "0", ...o.env },
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: Buffer[] = [];
  let outBytes = 0;
  let err = "";
  let capped = false;
  let timedOut = false;
  const stop = () => {
    if (child.pid) killTree(child.pid);
  };
  child.stdout.on("data", (b: Buffer) => {
    o.onData?.(b.toString("utf8"));
    if (capped) return;
    if (outBytes + b.length > o.cap) {
      out.push(b.subarray(0, o.cap - outBytes));
      outBytes = o.cap;
      capped = true;
      stop();
      return;
    }
    out.push(b);
    outBytes += b.length;
  });
  child.stderr.on("data", (b: Buffer) => {
    const s = b.toString("utf8");
    o.onData?.(s);
    err = (err + s).slice(-STDERR_KEEP);
  });
  const t = setTimeout(() => {
    timedOut = true;
    stop();
  }, o.timeoutMs);
  child.on("error", (e) => {
    clearTimeout(t);
    done({ stderr: e.message, missing: (e as NodeJS.ErrnoException).code === "ENOENT" });
  });
  child.on("close", (code) => {
    clearTimeout(t);
    done({ ok: code === 0 && !timedOut && !capped, code, stdout: Buffer.concat(out).toString("utf8"), stderr: err, timedOut, capped });
  });
  return promise;
}

/** The registered project behind `raw` (an id from the browser), its root resolved on disk. */
export function projectFor(db: DatabaseSync, raw: unknown): { ok: true; project: Project } | ({ ok: false } & Refusal) {
  const id = checkProjectId(raw);
  if (!id.ok) return { ok: false, error: id.error, status: 422 };
  const row = db.prepare("SELECT id, path, name FROM projects WHERE id = ?").get(id.value) as { id: number; path: string; name: string } | undefined;
  if (!row) return { ok: false, error: "không có dự án này trong HQ", status: 404 };
  try {
    const root = fs.realpathSync(row.path);
    if (!fs.statSync(root).isDirectory()) throw new Error("not a folder");
    return { ok: true, project: { id: row.id, name: row.name, root } };
  } catch {
    return { ok: false, error: "thư mục dự án không còn trên máy", status: 410 };
  }
}

/** `rel` resolved inside `root` (symlinks followed, then checked to stay inside), or null. */
export function insideRoot(root: string, rel: string): string | null {
  try {
    const base = fs.realpathSync(root);
    const real = fs.realpathSync(path.resolve(base, rel));
    const r = path.relative(base, real);
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? real : null;
  } catch {
    return null;
  }
}

/** Where trail keeps a repo's map (lib: trail `mapDirFor`): `.trail/cache/` on trail, `graft/` before it. */
const MAP_DIRS = [".trail/cache", "graft"];

/** Indexed or not, and when: the mtime of the wiring graph `trail build` writes. */
export function indexStatus(root: string): IndexState {
  for (const dir of MAP_DIRS) {
    try {
      const st = fs.statSync(path.join(root, dir, ".graph", "wiring.json"));
      if (st.isFile()) return { indexed: true, builtAt: st.mtimeMs, dir };
    } catch {
      // not this one
    }
  }
  return { indexed: false, builtAt: null, dir: null };
}

/**
 * `graphify-out/` and its `graph.html` when they are real (no symlink at either level, inside the
 * root) and the page is under GRAPH_MAX.
 */
export function graphInfo(root: string): { dir: boolean; html: { file: string; size: number; mtime: number } | null } {
  const dir = path.join(root, "graphify-out");
  try {
    if (!fs.lstatSync(dir).isDirectory()) return { dir: false, html: null };
  } catch {
    return { dir: false, html: null };
  }
  try {
    const st = fs.lstatSync(path.join(dir, "graph.html"));
    const file = insideRoot(root, "graphify-out/graph.html");
    if (!st.isFile() || !file || st.size > GRAPH_MAX) return { dir: true, html: null };
    return { dir: true, html: { file, size: st.size, mtime: st.mtimeMs } };
  } catch {
    return { dir: true, html: null };
  }
}

/**
 * graph.html's bytes, read through one handle: the file is opened once (no following a link where
 * the OS allows it), then that handle must be a regular file with a single name (a hard link to a
 * file outside the repo has two) and under GRAPH_MAX. Null when not.
 */
export function readGraph(file: string): Buffer | null {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > GRAPH_MAX) return null;
    const buf = Buffer.alloc(st.size);
    let at = 0;
    while (at < buf.length) {
      const n = fs.readSync(fd, buf, at, buf.length - at, at);
      if (n === 0) break;
      at += n;
    }
    return buf.subarray(0, at);
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// Each route is its own bundle, each with its own copy of this module: reads and builds live on
// globalThis so the caps hold for the whole server and GET /api/codemap sees a build /build started.
const G = globalThis as { __hqTrail?: { reads: number; builds: Map<number, BuildState> } };
const reg = (G.__hqTrail ??= { reads: 0, builds: new Map() });

/** A read-only `trail` query in the project root: READS_MAX at once, 60 s, OUTPUT_CAP. */
export async function trailRead(root: string, args: string[], run: typeof runTrail = runTrail): Promise<TrailOut | Refusal> {
  if (reg.reads >= READS_MAX) return { error: "trail đang chạy nhiều việc, thử lại sau vài giây", status: 429 };
  reg.reads++;
  try {
    return await run(args, { cwd: root, timeoutMs: READ_TIMEOUT_MS, cap: OUTPUT_CAP });
  } finally {
    reg.reads--;
  }
}

/** Why a run gave nothing usable, or null when it worked. */
export function refusalOf(r: TrailOut, timeoutMs = READ_TIMEOUT_MS): Refusal | null {
  if (r.missing) return { error: "không tìm thấy lệnh trail trên máy này (PATH của HQ)", status: 503 };
  if (r.timedOut) return { error: `trail chạy quá ${Math.round(timeoutMs / 1000)} s, đã dừng`, status: 504 };
  if (r.capped) return { error: `kết quả trail vượt ${Math.round(OUTPUT_CAP / 1024)} KB, đã dừng: thu hẹp điều cần tìm`, status: 413 };
  if (!r.ok) {
    const why = stripAnsi(r.stderr || r.stdout).trim().split(/\r?\n/).find(Boolean) ?? "";
    return { error: why ? `trail lỗi: ${why.slice(0, 300)}` : `trail lỗi (mã ${r.code ?? "?"})`, status: 502 };
  }
  return null;
}

/** trail's `--json` answer parsed by `parse`, or why not. */
export function trailJson<T>(r: TrailOut | Refusal, parse: (v: unknown) => T | null): { ok: true; value: T } | ({ ok: false } & Refusal) {
  if ("status" in r) return { ok: false, ...r };
  const no = refusalOf(r);
  if (no) return { ok: false, ...no };
  try {
    const v = parse(JSON.parse(r.stdout));
    if (v) return { ok: true, value: v };
  } catch {
    // below
  }
  return { ok: false, error: "trail trả JSON không đọc được", status: 502 };
}

// ---- argv (no shell: each value is one argument; `--` keeps a query that starts with "-" a query) ----

export const mapArgs = (root: string) => ["map", "--json", "--no-refresh", root];
export const askArgs = (q: string, root: string) => ["ask", "--json", "--no-refresh", "-n", "20", "--", q, root];
export const grepArgs = (pattern: string, root: string) => ["grep", "--json", "--no-refresh", "-i", "--", pattern, root];
export const skeletonArgs = (file: string, root: string) => ["skeleton", "--json", "--no-refresh", "--", file, root];
export const buildArgs = (root: string) => ["build", root];

// ---- builds: one per project, in memory (a restart forgets them; the index on disk stays) ----

const builds = reg.builds;
/** Lines of a build's output kept for the tab (its last words: counts, where the map went). */
const TAIL_LINES = 6;

export const buildState = (id: number): BuildState | null => builds.get(id) ?? null;

/** The last lines worth showing: colour codes out, the `parsing N/M` progress lines out. */
function tailOf(text: string): string {
  return stripAnsi(text)
    .split(/[\r\n]+/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^\s*parsing \d+\/\d+/.test(l))
    .slice(-TAIL_LINES)
    .join("\n");
}

/** Start `trail build` for a project unless one runs for it already (or BUILDS_MAX do). */
export function startBuild(p: Project, run: typeof runTrail = runTrail, now = Date.now): BuildState | Refusal {
  if (builds.get(p.id)?.state === "running") return { error: "dự án này đang được index", status: 409 };
  if ([...builds.values()].filter((b) => b.state === "running").length >= BUILDS_MAX) return { error: "đang index dự án khác, chờ xong rồi thử lại", status: 429 };
  const job: BuildState = { state: "running", startedAt: now(), endedAt: null, progress: null, tail: "", error: null };
  builds.set(p.id, job);
  let seen = "";
  void run(buildArgs(p.root), {
    cwd: p.root,
    timeoutMs: BUILD_TIMEOUT_MS,
    cap: 1024 * 1024,
    onData: (s) => {
      seen = (seen + s).slice(-8192);
      job.progress = buildProgress(s) ?? job.progress;
      job.tail = tailOf(seen);
    },
  }).then((r) => {
    const no = refusalOf(r, BUILD_TIMEOUT_MS);
    job.state = no ? "failed" : "done";
    job.error = no?.error ?? null;
    job.tail = tailOf(seen);
    job.endedAt = now();
  });
  return job;
}

/** Tests: forget builds and reads. */
export function resetTrail(): void {
  builds.clear();
  reg.reads = 0;
}
