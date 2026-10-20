// "Chơi thử": build a project's origin/main once and serve its `dist/` inside HQ (an iframe in the
// play viewer, or its own tab). One detached git worktree per project, kept OUTSIDE the repo under the
// platform data dir (paths.ts playRootDir), so Preview never scans it and the repo stays clean. Every
// command is a fixed argv (no shell); the only outside value in it is a project root HQ already knows.
// Files are served only from `<worktree>/dist`, by real path, to a browser holding the `hq_play` cookie
// that an authed status call set (an iframe cannot send the `x-hq-token` header).
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { groupKey } from "../sidebar";
import { cookieValue, PUB_COOKIE, readPublic, safeEqual, SESSION_MS, sideOf, viaTunnel } from "./auth";
import { childEnv } from "./child-env";
import { playRootDir, playSecretPath } from "./paths";

export const PLAY_TIMEOUT_MS = 10 * 60_000;
export const LOG_LINES = 200;
const LINE_MAX = 400;
/** In the worktree: what the last good install/build was. */
export const STAMP = ".hq-play.json";
export const PLAY_COOKIE = "hq_play";
/** `<slug>-<10 hex>`: a folder name and a URL segment, never a path. */
export const KEY_RE = /^[a-z0-9][a-z0-9-]{0,40}-[0-9a-f]{10}$/;
/** `git fetch` on a status call with `fresh`: at most this often per project. */
const FETCH_EVERY_MS = 30_000;

export type PlayStep = "fetch" | "checkout" | "install" | "build";
export type PlayState = "none" | "building" | "ready" | "failed";
export type PlayStatus = {
  key: string;
  /** Root-relative play URL (the iframe src and "Mở tab mới"). */
  url: string;
  /** Root-relative demo link (`url?k=…`, 12 h): "Copy link demo" makes it absolute on the page's origin. */
  shareUrl: string;
  state: PlayState;
  /** Commit the served `dist/` was built from. */
  sha: string | null;
  builtAt: number | null;
  /** origin/main as of the last fetch. */
  mainSha: string | null;
  /** Ready, but origin/main has moved on. */
  stale: boolean;
  /** origin/main's package.json has a `build` script. */
  buildable: boolean;
  /** Why it is not buildable, in the owner's words. */
  reason: string | null;
  step: PlayStep | null;
  startedAt: number | null;
  error: string | null;
  log: string[];
};

type Stamp = { lockHash: string | null; sha: string | null; builtAt: number | null };
type Job = { root: string; state: "building" | "failed"; step: PlayStep | null; log: string[]; startedAt: number; error: string | null };

// Route handlers are separate bundles with their own module copies (KNOWLEDGE 2026-10-19): one registry per process.
const G = globalThis as { __hqPlay?: { jobs: Map<string, Job>; roots: Map<string, string>; fetched: Map<string, number> } };
const reg = (G.__hqPlay ??= { jobs: new Map(), roots: new Map(), fetched: new Map() });

/** `3d-game-1a2b3c4d5e`: the folder name under hq-play and the URL segment for one project root. */
export function playKey(root: string): string {
  const base = path.basename(root.replace(/[\\/]+$/, "")).toLowerCase();
  const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "p";
  return `${slug}-${crypto.createHash("sha1").update(groupKey(root)).digest("hex").slice(0, 10)}`;
}

export const playDir = (key: string, base = playRootDir()) => path.join(base, key);
export const playUrl = (key: string) => `/api/play/${key}/index.html`;

/** Remember which root a key belongs to, so file requests resolve without listing projects. */
export function rememberRoot(root: string): string {
  const key = playKey(root);
  reg.roots.set(key, root);
  return key;
}

export const rootOfKey = (key: string): string | null => reg.roots.get(key) ?? null;

// ---- argv (pure, tested) ---------------------------------------------------------------------

export const fetchArgs = (root: string) => ["-C", root, "fetch", "--no-tags", "origin", "main"];
export const mainShaArgs = (root: string) => ["-C", root, "rev-parse", "--verify", "--quiet", "origin/main^{commit}"];
export const mainPkgArgs = (root: string) => ["-C", root, "show", "origin/main:package.json"];
/** First build: a detached worktree (`--force` only overrides a registration whose folder was deleted; the folder is checked absent first). */
export const addArgs = (root: string, dir: string, sha: string) => ["-C", root, "worktree", "add", "--detach", "--force", dir, sha];
/** Later builds: move the same worktree to the new commit, dropping local edits to tracked files. */
export const checkoutArgs = (dir: string, sha: string) => ["-C", dir, "checkout", "--detach", "--force", sha];
export const installArgs = (hasLock: boolean) => (hasLock ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"]);
/** `--base ./`: relative asset URLs, so `dist/` works under `/api/play/<key>/` and behind a proxy path. */
export const buildArgs = () => ["run", "build", "--", "--base", "./"];

/**
 * npm as `node <npm-cli.js>`: Node refuses to spawn `npm.cmd` without a shell on Windows, and a shell
 * is what this module never uses. Falls back to `npm` on PATH (fine off Windows).
 */
export function npmCommand(execPath = process.execPath, exists: (p: string) => boolean = fs.existsSync): { cmd: string; pre: string[] } {
  const dir = path.dirname(execPath);
  for (const cli of [path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"), path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")]) {
    if (exists(cli)) return { cmd: execPath, pre: [cli] };
  }
  return { cmd: "npm", pre: [] };
}

/** `scripts.build` of a package.json text, or why there is none. */
export function buildScript(pkg: string | null): { ok: true } | { ok: false; reason: string } {
  if (pkg === null) return { ok: false, reason: "origin/main chưa có package.json" };
  try {
    const v = JSON.parse(pkg) as { scripts?: Record<string, unknown> };
    const s = v?.scripts?.build;
    return typeof s === "string" && s.trim() ? { ok: true } : { ok: false, reason: "package.json trên origin/main không có script build" };
  } catch {
    return { ok: false, reason: "package.json trên origin/main không đọc được" };
  }
}

// ---- status (pure, tested) -------------------------------------------------------------------

const SHA_RE = /^[0-9a-f]{40}$/;

export function parseStamp(text: string | null): Stamp | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<Stamp>;
    const sha = typeof v.sha === "string" && SHA_RE.test(v.sha) ? v.sha : null;
    const builtAt = typeof v.builtAt === "number" && Number.isFinite(v.builtAt) ? v.builtAt : null;
    const lockHash = typeof v.lockHash === "string" ? v.lockHash : null;
    return { lockHash, sha: sha && builtAt ? sha : null, builtAt: sha && builtAt ? builtAt : null };
  } catch {
    return null;
  }
}

/** What the viewer shows: a running or failed job wins, else a stamped build with its `dist/index.html`. */
export function playState(x: { job: Pick<Job, "state" | "step" | "log" | "startedAt" | "error"> | null; stamp: Stamp | null; distOk: boolean; mainSha: string | null }) {
  const built = x.stamp?.sha && x.distOk ? { sha: x.stamp.sha, builtAt: x.stamp.builtAt } : { sha: null, builtAt: null };
  const state: PlayState = x.job ? x.job.state : built.sha ? "ready" : "none";
  return {
    state,
    ...built,
    mainSha: x.mainSha,
    stale: state === "ready" && !!x.mainSha && built.sha !== x.mainSha,
    step: x.job?.state === "building" ? x.job.step : null,
    startedAt: x.job?.startedAt ?? null,
    error: x.job?.error ?? null,
    log: x.job?.log ?? [],
  };
}

// ---- files (pure, tested) --------------------------------------------------------------------

export const PLAY_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ktx2": "image/ktx2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

export const playType = (file: string) => PLAY_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/**
 * The path segments after `/api/play/<key>/` in a URL pathname (still percent-encoded), decoded one by
 * one. Null for anything that is not a plain relative file path: `.`/`..` (also encoded), empty
 * segments, separators or `:` inside a segment (`%2F`, `%5C`, drive letters, NTFS streams), control
 * characters, and a trailing dot or space (Windows drops those, `.. ` would read as `..`).
 */
export function playSegments(rest: string): string[] | null {
  if (rest === "") return ["index.html"];
  const out: string[] = [];
  for (const raw of rest.split("/")) {
    let s: string;
    try {
      s = decodeURIComponent(raw);
    } catch {
      return null;
    }
    // `.` and `..` end in a dot too.
    if (!s || /[/\\:\x00-\x1f\x7f]/.test(s) || /[. ]$/.test(s)) return null;
    out.push(s);
  }
  return out;
}

/** Real paths compare case-insensitively on Windows (one folder, two spellings). */
const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** The real file under `dist` for those segments, or null (missing, a folder, or a link out of `dist`). */
export function resolvePlayFile(dist: string, segments: string[]): { abs: string; size: number; mtimeMs: number } | null {
  try {
    const base = fold(fs.realpathSync(dist));
    const real = fs.realpathSync(path.join(dist, ...segments));
    if (!fold(real).startsWith(base.endsWith(path.sep) ? base : base + path.sep)) return null;
    const st = fs.statSync(real);
    return st.isFile() ? { abs: real, size: st.size, mtimeMs: st.mtimeMs } : null;
  } catch {
    return null;
  }
}

// ---- auth for the file route -----------------------------------------------------------------

let secretCache: { file: string; secret: string } | null = null;

/**
 * The HMAC key of play cookies and demo links: 32 random bytes in `~/.config/8sync/hq/play-secret`
 * (0600, made on first use). Not the UI token and not derived from it, so a play link can never be
 * turned into API access; deleting the file revokes every link and cookie.
 */
export function playSecret(): string {
  const file = playSecretPath();
  if (secretCache?.file === file) return secretCache.secret;
  let secret = readText(file)?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, secret + "\n", { mode: 0o600 });
  }
  secretCache = { file, secret };
  return secret;
}

/** `<expiry ms>.<hmac_sha256(secret, "<key>.<expiry>")>`: good for one project key until `expiry`. */
export function playSig(key: string, expiry: number, secret = playSecret()): string {
  return `${expiry}.${crypto.createHmac("sha256", secret).update(`${key}.${expiry}`).digest("hex")}`;
}

/** True for a signature of exactly this key, not expired, at most 12 h ahead; compared in constant time. */
export function playSigValid(value: string, key: string, now = Date.now(), secret = playSecret()): boolean {
  const m = /^(\d{1,15})\.[0-9a-f]{64}$/.exec(value);
  if (!m) return false;
  const expiry = Number(m[1]);
  return expiry > now && expiry <= now + SESSION_MS && safeEqual(value, playSig(key, expiry, secret));
}

/** The page came over https (VPS proxy `X-Forwarded-Proto`, Cloudflare tunnel): the cookie gets `Secure`. */
export const viaHttps = (h: Headers) => h.get("x-forwarded-proto") === "https" || viaTunnel(h);

/**
 * `Set-Cookie` for one project's play files: 12 h, HttpOnly, SameSite=Lax (a demo link opened from
 * another app still loads its assets), sent only under `/api/play/<key>/`, so it reaches no other HQ
 * route and no other project. The routes under `/api/*` never read it: they want the token header.
 */
export function playCookie(key: string, secure: boolean, now = Date.now()): string {
  return `${PLAY_COOKIE}=${playSig(key, now + SESSION_MS)}; HttpOnly; SameSite=Lax; Path=/api/play/${key}/; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`;
}

/**
 * "Copy link demo": the play URL with `?k=` (the cookie's signature, 12 h, this project only). The
 * file route trades it for the cookie, so someone who can already reach this HQ (the owner's other
 * device, a GitHub user the VPS gate lets in) plays without opening HQ first. Never the token.
 */
export const playShareUrl = (key: string, now = Date.now()) => `${playUrl(key)}?k=${playSig(key, now + SESSION_MS)}`;

/**
 * The file route's gate: the same Host rule as every HQ route (loopback, or the public tunnel host with
 * its login cookie; a proxy that rewrites Host to loopback counts as local, as for the rest of HQ), plus
 * a valid signature for this `key`: an `hq_play` cookie (in place of the header an iframe cannot send;
 * every one sent is tried, so a stale or broader-path one never shadows the right one), or `link` (a
 * demo link's `k`).
 */
export function playAllowed(h: Headers, key: string, now = Date.now(), link?: string): boolean {
  const side = sideOf({ host: h.get("host"), cookie: cookieValue(h.get("cookie"), PUB_COOKIE), tunnel: viaTunnel(h) }, readPublic(), now);
  if (!side) return false;
  if (link !== undefined) return playSigValid(link, key, now);
  const prefix = `${PLAY_COOKIE}=`;
  return (h.get("cookie") ?? "").split(";").some((p) => p.trim().startsWith(prefix) && playSigValid(p.trim().slice(prefix.length), key, now));
}

// ---- processes -------------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

/** Append output to a ring of at most LOG_LINES lines (progress `\r` redraws count as new lines). */
export function pushLog(log: string[], chunk: string, carry: { rest: string }) {
  const parts = (carry.rest + chunk).replace(ANSI_RE, "").split(/\r\n|\r|\n/);
  carry.rest = parts.pop() ?? "";
  for (const p of parts) if (p.trim()) log.push(p.length > LINE_MAX ? `${p.slice(0, LINE_MAX)}…` : p);
  if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
}

function killTree(pid: number) {
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** One step, argv only, output into the job log; resolves with how it ended (a spawn error is a failure). */
function step(job: Job, cmd: string, args: string[], cwd: string, deadline: number): Promise<{ ok: boolean; timedOut: boolean }> {
  const { promise, resolve } = Promise.withResolvers<{ ok: boolean; timedOut: boolean }>();
  const left = deadline - Date.now();
  if (left <= 0) {
    resolve({ ok: false, timedOut: true });
    return promise;
  }
  const env = { ...childEnv(), NO_COLOR: "1", FORCE_COLOR: "0", npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false", GIT_TERMINAL_PROMPT: "0" };
  const child = spawn(cmd, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let timedOut = false;
  const carry = { rest: "" };
  const onData = (b: Buffer) => pushLog(job.log, b.toString("utf8"), carry);
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const t = setTimeout(() => {
    timedOut = true;
    if (child.pid) killTree(child.pid);
  }, left);
  child.on("error", (e) => {
    clearTimeout(t);
    job.log.push(`không chạy được ${path.basename(cmd)}: ${e.message}`);
    resolve({ ok: false, timedOut: false });
  });
  child.on("close", (code) => {
    clearTimeout(t);
    pushLog(job.log, "\n", carry);
    resolve({ ok: code === 0 && !timedOut, timedOut });
  });
  return promise;
}

/** Quiet git for status reads: stdout, or null on any failure. */
function gitOut(args: string[], timeoutMs = 8000): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  execFile("git", args, { timeout: timeoutMs, maxBuffer: 1 << 20, env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0" }, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  return promise;
}

const sha256 = (file: string): string | null => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
};

const readText = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const writeStamp = (dir: string, s: Stamp) => fs.writeFileSync(path.join(dir, STAMP), JSON.stringify(s));

/** The repo's shared git dir (`.git` of the main checkout), as a real path. */
async function commonDir(cwd: string): Promise<string | null> {
  const out = (await gitOut(["-C", cwd, "rev-parse", "--git-common-dir"]))?.trim();
  if (!out) return null;
  try {
    return fs.realpathSync(path.resolve(cwd, out));
  } catch {
    return null;
  }
}

/** True when `dir` is itself the top of a worktree of the repo at `root`. */
export async function isWorktreeOf(dir: string, root: string): Promise<boolean> {
  const top = (await gitOut(["-C", dir, "rev-parse", "--show-toplevel"]))?.trim();
  if (!top) return false;
  try {
    if (fold(fs.realpathSync(top)) !== fold(fs.realpathSync(dir))) return false;
  } catch {
    return false;
  }
  const [a, b] = await Promise.all([commonDir(dir), commonDir(root)]);
  return !!a && !!b && fold(a) === fold(b);
}

/** Commit of origin/main and whether it can be built, from the local refs. */
async function mainFacts(root: string): Promise<{ mainSha: string | null; buildable: boolean; reason: string | null }> {
  const sha = (await gitOut(mainShaArgs(root)))?.trim() ?? "";
  if (!SHA_RE.test(sha)) return { mainSha: null, buildable: false, reason: "repo chưa có origin/main" };
  const b = buildScript(await gitOut(mainPkgArgs(root)));
  return { mainSha: sha, buildable: b.ok, reason: b.ok ? null : b.reason };
}

/** Status of one project root; `fresh` fetches origin/main first (at most every 30 s). */
export async function playStatus(root: string, opts: { fresh?: boolean; base?: string } = {}): Promise<PlayStatus> {
  const key = rememberRoot(root);
  const job = reg.jobs.get(key) ?? null;
  if (opts.fresh && job?.state !== "building" && Date.now() - (reg.fetched.get(key) ?? 0) > FETCH_EVERY_MS) {
    reg.fetched.set(key, Date.now());
    await gitOut(fetchArgs(root), 60_000);
  }
  const dir = playDir(key, opts.base);
  const facts = await mainFacts(root);
  const stamp = parseStamp(readText(path.join(dir, STAMP)));
  const distOk = fs.existsSync(path.join(dir, "dist", "index.html"));
  return { key, url: playUrl(key), shareUrl: playShareUrl(key), ...facts, ...playState({ job, stamp, distOk, mainSha: facts.mainSha }) };
}

/**
 * Start a build of origin/main for one project root (does not wait). Refused while one runs for that
 * project. Steps: fetch, worktree add/checkout, `npm ci` only when package-lock.json changed since the
 * last good install (or node_modules is gone), `npm run build -- --base ./`. 10 minutes in total.
 */
export function startPlayBuild(root: string, opts: { base?: string; npm?: { cmd: string; pre: string[] } } = {}): { ok: true; key: string } | { ok: false; error: string } {
  const key = rememberRoot(root);
  if (reg.jobs.get(key)?.state === "building") return { ok: false, error: "đang build rồi, chờ xong" };
  const job: Job = { root, state: "building", step: "fetch", log: [], startedAt: Date.now(), error: null };
  reg.jobs.set(key, job);
  void runBuild(job, key, playDir(key, opts.base), opts.npm ?? npmCommand()).catch((e) => fail(job, `lỗi HQ: ${(e as Error).message}`));
  return { ok: true, key };
}

function fail(job: Job, error: string) {
  job.state = "failed";
  job.step = null;
  job.error = error;
}

async function runBuild(job: Job, key: string, dir: string, npm: { cmd: string; pre: string[] }) {
  const deadline = job.startedAt + PLAY_TIMEOUT_MS;
  const root = job.root;
  const late = () => fail(job, `quá ${PLAY_TIMEOUT_MS / 60_000} phút, đã dừng`);

  job.log.push(`$ git fetch origin main`);
  const f = await step(job, "git", fetchArgs(root), root, deadline);
  if (f.timedOut) return late();
  reg.fetched.set(key, Date.now());
  // A failed fetch (offline) still builds the origin/main HQ already has; the log says so.
  if (!f.ok) job.log.push("không fetch được, build origin/main đang có trên máy");
  const facts = await mainFacts(root);
  if (!facts.mainSha) return fail(job, facts.reason ?? "không đọc được origin/main");
  if (!facts.buildable) return fail(job, facts.reason ?? "không có script build");
  const sha = facts.mainSha;

  job.step = "checkout";
  if (fs.existsSync(dir)) {
    if (!(await isWorktreeOf(dir, root))) {
      return fail(job, `thư mục ${dir} đã có nhưng không phải worktree của ${root}; HQ không xoá nó, dời hoặc xoá tay rồi build lại`);
    }
    job.log.push(`$ git checkout --detach --force ${sha.slice(0, 7)}`);
    const c = await step(job, "git", checkoutArgs(dir, sha), dir, deadline);
    if (c.timedOut) return late();
    if (!c.ok) return fail(job, "git checkout thất bại");
  } else {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    job.log.push(`$ git worktree add --detach ${dir} ${sha.slice(0, 7)}`);
    const a = await step(job, "git", addArgs(root, dir, sha), root, deadline);
    if (a.timedOut) return late();
    if (!a.ok) return fail(job, "git worktree add thất bại");
  }

  const old = parseStamp(readText(path.join(dir, STAMP)));
  const lock = path.join(dir, "package-lock.json");
  const lockHash = sha256(lock);
  const hasModules = fs.existsSync(path.join(dir, "node_modules"));
  if (!hasModules || !old || old.lockHash !== lockHash || lockHash === null) {
    job.step = "install";
    const args = installArgs(lockHash !== null);
    job.log.push(`$ npm ${args.join(" ")}`);
    // Whatever the old stamp said no longer holds once install runs.
    writeStamp(dir, { lockHash: null, sha: null, builtAt: null });
    const i = await step(job, npm.cmd, [...npm.pre, ...args], dir, deadline);
    if (i.timedOut) return late();
    if (!i.ok) return fail(job, `npm ${args[0]} thất bại`);
  } else {
    job.log.push("package-lock.json không đổi, bỏ qua npm ci");
  }

  job.step = "build";
  // dist/ is about to be rewritten: it is not a good build again until this one finishes.
  writeStamp(dir, { lockHash, sha: null, builtAt: null });
  job.log.push(`$ npm ${buildArgs().join(" ")}`);
  const b = await step(job, npm.cmd, [...npm.pre, ...buildArgs()], dir, deadline);
  if (b.timedOut) return late();
  if (!b.ok) return fail(job, "npm run build thất bại");
  if (!fs.existsSync(path.join(dir, "dist", "index.html"))) return fail(job, "build xong nhưng không có dist/index.html");
  writeStamp(dir, { lockHash, sha, builtAt: Date.now() });
  reg.jobs.delete(key);
}

/** Test seam: forget jobs, keys and fetch times. */
export function __resetPlayForTest() {
  reg.jobs.clear();
  reg.roots.clear();
  reg.fetched.clear();
}

/** Wait until the build for `key` is no longer running (tests, smoke runs). */
export async function waitPlayBuild(key: string, timeoutMs = PLAY_TIMEOUT_MS) {
  const end = Date.now() + timeoutMs;
  while (reg.jobs.get(key)?.state === "building" && Date.now() < end) await sleep(100);
}
