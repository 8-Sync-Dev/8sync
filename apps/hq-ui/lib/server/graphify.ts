// `graphify` for the "Bản đồ code" tab (app/api/codemap/graphify): rebuild the code graph
// (`graphify update . --no-cluster`) and ask it (`explain`, `path`; never `query`, which calls a model).
// Runs through trail.ts runTrail: argv only, no shell, hard timeout, output cap, in the root of a
// project HQ knows (resolved server-side, never a path from the browser). Tested in tests/graphify.test.ts.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stripAnsi } from "@/lib/codemap";
import { childEnv } from "./child-env";
import { OUTPUT_CAP, runTrail, type Project, type Refusal, type TrailCommand, type TrailOut } from "./trail";

export const UPDATE_TIMEOUT_MS = 180_000;
export const ASK_TIMEOUT_MS = 30_000;
export const SYMBOL_MAX = 200;
export const GRAPHIFY_WORKERS = "4";
export const MISSING_TEXT = "chưa cài graphify — chạy `8sync setup`";
const TAIL_KEEP = 4096;

export type GraphifyUpdate = { state: "running" | "done" | "failed"; startedAt: number; endedAt: number | null; tail: string; error: string | null };

/** `graphify` on PATH (graphify.exe on Windows: a real binary, spawnable without a shell), or null. */
export function graphifyCommand(o: { env?: Record<string, string | undefined>; platform?: NodeJS.Platform; exists?: (p: string) => boolean } = {}): TrailCommand | null {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const exists = o.exists ?? ((p: string) => fs.existsSync(p) && fs.statSync(p).isFile());
  const p = platform === "win32" ? path.win32 : path.posix;
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  const dirs = (key ? (env[key] ?? "") : "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const name = platform === "win32" ? "graphify.exe" : "graphify";
  for (const dir of dirs) if (exists(p.join(dir, name))) return { cmd: p.join(dir, name), pre: [] };
  return null;
}

/** A node name for explain/path: trimmed, 1..200 chars, no leading "-", no control chars or newlines. */
export function checkSymbol(raw: unknown, label = "ký hiệu"): { ok: true; value: string } | { ok: false; error: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: false, error: `nhập ${label}` };
  if (s.length > SYMBOL_MAX) return { ok: false, error: `${label}: tối đa ${SYMBOL_MAX} ký tự` };
  if (s.startsWith("-")) return { ok: false, error: `${label}: không được bắt đầu bằng "-"` };
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(s)) return { ok: false, error: `${label}: có ký tự điều khiển hoặc xuống dòng` };
  return { ok: true, value: s };
}

const keyOf = (p: string) => {
  let r = path.resolve(p);
  try {
    r = fs.realpathSync(r);
  } catch {
    // keep the resolved spelling
  }
  return process.platform === "win32" ? r.toLowerCase() : r;
};

/** 409 unless `root` is one of the roots HQ knows (lib/server/in-view.ts knownRoots). */
export function checkRoot(root: string, known: string[]): Refusal | null {
  const k = keyOf(root);
  return known.some((r) => keyOf(r) === k) ? null : { error: "thư mục dự án không nằm trong các dự án HQ đang thấy", status: 409 };
}

// ---- argv: `--` is not taken by graphify, so checkSymbol keeps "-" out of the first character ----
export const updateArgs = () => ["update", ".", "--no-cluster"];
export const explainArgs = (x: string) => ["explain", x];
export const pathArgs = (a: string, b: string) => ["path", a, b];

const clean = (s: string) => stripAnsi(s).replace(/\r\n?/g, "\n").trim();

/** Why a graphify run gave nothing usable, or null. */
export function graphifyRefusal(r: TrailOut, timeoutMs: number): Refusal | null {
  if (r.missing) return { error: MISSING_TEXT, status: 503 };
  if (r.timedOut) return { error: `graphify chạy quá ${Math.round(timeoutMs / 1000)} s, đã dừng`, status: 504 };
  if (r.capped) return { error: `kết quả graphify vượt ${Math.round(OUTPUT_CAP / 1024)} KB, đã dừng`, status: 413 };
  if (!r.ok) {
    const why = clean(r.stderr || r.stdout).split("\n").filter(Boolean).slice(-3).join(" · ");
    return { error: why ? `graphify lỗi: ${why.slice(0, 400)}` : `graphify lỗi (mã ${r.code ?? "?"})`, status: 502 };
  }
  return null;
}

// One registry for the server (each route bundle has its own module copy): updates per root, asks in flight.
const G = globalThis as { __hqGraphify?: { updates: Map<string, GraphifyUpdate>; asks: number } };
const reg = (G.__hqGraphify ??= { updates: new Map(), asks: 0 });
export const ASKS_MAX = 3;

export const updateState = (root: string): GraphifyUpdate | null => reg.updates.get(keyOf(root)) ?? null;

/** Start `graphify update . --no-cluster` (GRAPHIFY_MAX_WORKERS=4) unless one runs for this root already. */
export function startUpdate(p: Project, o: { run?: typeof runTrail; command?: TrailCommand | null; now?: () => number } = {}): GraphifyUpdate | Refusal {
  const run = o.run ?? runTrail;
  const now = o.now ?? Date.now;
  const command = o.command === undefined ? graphifyCommand() : o.command;
  if (!command) return { error: MISSING_TEXT, status: 503 };
  const k = keyOf(p.root);
  if (reg.updates.get(k)?.state === "running") return { error: "graph của dự án này đang được cập nhật", status: 409 };
  const job: GraphifyUpdate = { state: "running", startedAt: now(), endedAt: null, tail: "", error: null };
  reg.updates.set(k, job);
  let seen = "";
  void run(updateArgs(), {
    cwd: p.root,
    timeoutMs: UPDATE_TIMEOUT_MS,
    cap: OUTPUT_CAP,
    command,
    env: { GRAPHIFY_MAX_WORKERS: GRAPHIFY_WORKERS },
    onData: (s) => {
      seen = (seen + s).slice(-TAIL_KEEP);
      job.tail = tail(seen);
    },
  }).then((r) => {
    const no = graphifyRefusal(r, UPDATE_TIMEOUT_MS);
    job.state = no ? "failed" : "done";
    job.error = no?.error ?? null;
    job.tail = tail(seen);
    job.endedAt = now();
    if (!no) void excludeGraphifyOut(p.root).catch((e) => console.warn("[hq] graphify-out exclude:", e));
  });
  return job;
}

const tail = (s: string) => clean(s).split("\n").filter((l) => l.trim()).slice(-8).join("\n");

function gitRun(args: string[]): Promise<{ code: number; out: string }> {
  const { promise, resolve } = Promise.withResolvers<{ code: number; out: string }>();
  execFile("git", args, { timeout: 10_000, windowsHide: true, maxBuffer: 1 << 20, env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } }, (err, out) =>
    resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, out: String(out ?? "") }),
  );
  return promise;
}

/**
 * Keep `graphify-out/` out of `git add -A` in projects that never ran `8sync harness init` (only its
 * seed_gitignore adds it): append `graphify-out/` to `<git-common-dir>/info/exclude` (local, shared by
 * linked worktrees) unless git already ignores it. Not a git repo → nothing. Returns whether it wrote.
 */
export async function excludeGraphifyOut(root: string): Promise<boolean> {
  const dir = await gitRun(["-C", root, "rev-parse", "--git-common-dir"]);
  const common = dir.code === 0 ? dir.out.trim() : "";
  if (!common) return false;
  const ignored = await gitRun(["-C", root, "check-ignore", "-q", "graphify-out/graph.json"]);
  if (ignored.code !== 1) return false; // 0 = already ignored, anything else = git error
  const file = path.join(path.resolve(root, common), "info", "exclude");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const sep = text && !text.endsWith("\n") ? eol : "";
  fs.writeFileSync(file, `${text}${sep}graphify-out/${eol}`);
  return true;
}

/** `graphify explain|path` in the root: ASKS_MAX at once, 30 s, OUTPUT_CAP; the text it printed. */
export async function graphifyAsk(root: string, args: string[], o: { run?: typeof runTrail; command?: TrailCommand | null } = {}): Promise<{ ok: true; text: string } | ({ ok: false } & Refusal)> {
  const command = o.command === undefined ? graphifyCommand() : o.command;
  if (!command) return { ok: false, error: MISSING_TEXT, status: 503 };
  if (reg.asks >= ASKS_MAX) return { ok: false, error: "graphify đang chạy nhiều việc, thử lại sau vài giây", status: 429 };
  reg.asks++;
  try {
    const r = await (o.run ?? runTrail)(args, { cwd: root, timeoutMs: ASK_TIMEOUT_MS, cap: OUTPUT_CAP, command, env: { GRAPHIFY_MAX_WORKERS: GRAPHIFY_WORKERS } });
    const no = graphifyRefusal(r, ASK_TIMEOUT_MS);
    return no ? { ok: false, ...no } : { ok: true, text: clean(r.stdout) || "(graphify không in gì)" };
  } finally {
    reg.asks--;
  }
}

/** Tests: forget updates and asks. */
export function resetGraphify(): void {
  reg.updates.clear();
  reg.asks = 0;
}
