// Preview tab: the screenshots rooms save while they work (qa/ui put UAT shots in
// `qa/evidence/card-<id>-<slug>.png`, crates/cli/src/verbs/ccc/room.rs). Read-only, a few known
// folders per project root and its worktrees, never a path the client sends: the file route serves
// an image only by the opaque id this list gave it.
//
// Time: a checkout rewrites the mtime of every file it writes, so a 7-hour-old shot of card #5 looked
// new each time a worktree was made. An image's time is the commit that last touched it when git
// tracks it unmodified in that checkout, the file's mtime only when it is untracked or modified.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ProjectInfo } from "../office";
import { cardOf, mainRoot, rootKey, worktreeCard, type MainHead, type PreviewItem, type ProjectPreviews } from "../preview";
import { childEnv } from "./child-env";
import { projectOf } from "./office";

export type { PreviewItem, ProjectPreviews };

/** Folders an image may come from, relative to a project root or a worktree. */
export const PREVIEW_DIRS = ["qa/evidence", "evidence", "screenshots", "su-code/shots", "docs/screenshots"] as const;
export const PREVIEW_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  // Demo recordings (owner 2026-10-22: "xem video demo nếu có").
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
/** Levels of sub-folders walked inside a preview folder. */
export const PREVIEW_DEPTH = 3;
export const PREVIEW_MAX_BYTES = 15 * 1024 * 1024;
/** A demo video may be bigger than a screenshot. */
export const PREVIEW_VIDEO_MAX_BYTES = 60 * 1024 * 1024;
/** The size cap for a preview file by its name. */
export const maxBytesFor = (name: string): number => (/\.(mp4|webm)$/i.test(name) ? PREVIEW_VIDEO_MAX_BYTES : PREVIEW_MAX_BYTES);
export const PREVIEW_CAP = 300;
/** Directory entries looked at per preview folder: a huge evidence tree never stalls a poll. */
const ENTRY_BUDGET = 4_000;
const WORKTREES_MAX = 60;
/** Commits `git log` reads per checkout: an image older than that gets the oldest time read. */
export const LOG_MAX = 400;
const GIT_TIMEOUT_MS = 8_000;
/** git processes at once across a scan (a repo with 30 worktrees must not spawn 60 at once). */
const GIT_PARALLEL = 6;
/** Main branch tips, newest wins: rooms fetch `origin` while the root checkout may sit on an old commit. */
const MAIN_REFS = ["refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"];
/** The file route reuses the last scan of a root this long before scanning again. */
const SCAN_TTL_MS = 30_000;

/** sha1 of the absolute path: stable across polls, says nothing about the path. */
export const previewId = (abs: string) => crypto.createHash("sha1").update(abs).digest("hex");
export const isPreviewId = (v: string | null): v is string => !!v && /^[0-9a-f]{40}$/.test(v);

const inside = (real: string, base: string) => real === base || real.startsWith(base.endsWith(path.sep) ? base : base + path.sep);

function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function readSafe(f: string): string | null {
  try {
    return fs.readFileSync(f, "utf8").slice(0, 4096);
  } catch {
    return null;
  }
}

function mtimeOf(f: string): number {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
}

type Found = { abs: string; st: fs.Stats };

/** Image files under one preview folder, depth-limited; every entry's real path stays inside `realBase`. */
function walk(dir: string, realBase: string, depth: number, budget: { n: number }, out: Found[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (--budget.n < 0) return;
    const abs = path.join(dir, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      // A link may point anywhere: follow it only when its target stays in the root.
      const real = realOrNull(abs);
      if (!real || !inside(real, realBase)) continue;
      try {
        const st = fs.statSync(real);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) {
      if (depth < PREVIEW_DEPTH && !e.name.startsWith(".")) walk(abs, realBase, depth + 1, budget, out);
      continue;
    }
    if (!isFile || !PREVIEW_TYPES[path.extname(e.name).toLowerCase()]) continue;
    try {
      const st = fs.statSync(abs);
      if (st.size > 0 && st.size <= maxBytesFor(e.name)) out.push({ abs, st });
    } catch {
      /* gone between readdir and stat */
    }
  }
}

/** A tree path the walk would list: in a preview folder, ≤ PREVIEW_DEPTH sub-folders, no dot folder, an image type. */
export function inPreviewDir(sub: string): boolean {
  if (!PREVIEW_TYPES[path.posix.extname(sub).toLowerCase()]) return false;
  const top = PREVIEW_DIRS.find((d) => sub.startsWith(d + "/"));
  if (!top) return false;
  const folders = sub.slice(top.length + 1).split("/").slice(0, -1);
  return folders.length <= PREVIEW_DEPTH && !folders.some((f) => f.startsWith("."));
}

/** Every base a project's images live under: the root, then each `.claude/worktrees/*`. */
function bases(root: string): { dir: string; worktree: string | null }[] {
  const out: { dir: string; worktree: string | null }[] = [{ dir: root, worktree: null }];
  try {
    const wt = path.join(root, ".claude", "worktrees");
    for (const e of fs.readdirSync(wt, { withFileTypes: true }).slice(0, WORKTREES_MAX)) {
      if (e.isDirectory()) out.push({ dir: path.join(wt, e.name), worktree: e.name });
    }
  } catch {
    /* no worktrees */
  }
  return out;
}

// ---- git, read-only, fixed argv ----

let gitActive = 0;
const gitQueue: (() => void)[] = [];

/** stdout of `git <args>`, or null on any failure; at most GIT_PARALLEL at once. */
async function git(args: string[]): Promise<string | null> {
  if (gitActive < GIT_PARALLEL) gitActive++;
  else await new Promise<void>((r) => gitQueue.push(r));
  try {
    const { promise, resolve } = Promise.withResolvers<string | null>();
    execFile("git", args, { timeout: GIT_TIMEOUT_MS, maxBuffer: 8 << 20, windowsHide: true, env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } }, (err, stdout) =>
      resolve(err ? null : String(stdout)),
    );
    return await promise;
  } finally {
    // Hand the slot straight to the next caller, so the count never overshoots.
    const next = gitQueue.shift();
    if (next) next();
    else gitActive--;
  }
}

/** A checkout's git dir (a worktree's `.git` is a file naming it) and the repo's common dir; null if not a checkout. */
function gitDirs(dir: string): { gitDir: string; common: string } | null {
  const dotgit = path.join(dir, ".git");
  let gitDir = dotgit;
  try {
    if (fs.statSync(dotgit).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readSafe(dotgit) ?? "");
      if (!m) return null;
      gitDir = path.resolve(dir, m[1].trim());
    }
  } catch {
    return null;
  }
  const common = readSafe(path.join(gitDir, "commondir"))?.trim();
  return { gitDir, common: common ? path.resolve(gitDir, common) : gitDir };
}

/** `git log --format=@@%ct --name-only` → each path's newest commit time (ms) and the oldest time read. */
export function parseLogTimes(out: string): { times: Map<string, number>; oldest: number; commits: number } {
  const times = new Map<string, number>();
  let ct = 0;
  let commits = 0;
  for (const line of out.split("\n")) {
    const l = line.replace(/\r$/, "");
    if (l.startsWith("@@")) {
      ct = Number(l.slice(2)) * 1000;
      commits++;
    } else if (l && ct > 0 && !times.has(l)) times.set(l, ct);
  }
  return { times, oldest: ct, commits };
}

/** `git status --porcelain=v1 -z` → every path it lists (modified, staged, untracked, ignored); a folder ends with `/`. */
export function parseStatus(out: string): string[] {
  const toks = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.length < 4) continue;
    paths.push(t.slice(3));
    // A rename or copy carries its old path as the next token.
    if (t[0] === "R" || t[0] === "C") i++;
  }
  return paths;
}

type Times = { times: Map<string, number>; oldest: number; truncated: boolean };
type CheckoutGit = Times & { changed: string[] };

const logArgs = (dir: string, rev: string[]) => ["-C", dir, "-c", "core.quotePath=false", "log", "-n", String(LOG_MAX), "--no-renames", "--format=@@%ct", "--name-only", ...rev, "--", ...PREVIEW_DIRS];

function timesOf(out: string): Times {
  const t = parseLogTimes(out);
  return { times: t.times, oldest: t.oldest, truncated: t.commits >= LOG_MAX };
}

/** Keyed by checkout dir; `stamp` says when to ask git again (HEAD, its ref, the index, the files seen). */
const checkoutCache = new Map<string, { stamp: string; v: CheckoutGit | null }>();
const mainCache = new Map<string, { stamp: string; v: MainTree | null }>();

/** What git knows about one checkout's preview folders; null when it is not a checkout or git failed. */
async function checkoutGit(dir: string, filesStamp: string): Promise<CheckoutGit | null> {
  const g = gitDirs(dir);
  if (!g) return null;
  const head = (readSafe(path.join(g.gitDir, "HEAD")) ?? "").trim();
  const ref = /^ref:\s*(refs\/\S+)$/.exec(head)?.[1];
  const stamp = [head, ref ? mtimeOf(path.join(g.common, ref)) : 0, mtimeOf(path.join(g.common, "packed-refs")), mtimeOf(path.join(g.gitDir, "index")), filesStamp].join("|");
  const hit = checkoutCache.get(dir);
  if (hit?.stamp === stamp) return hit.v;
  const [log, status] = await Promise.all([
    git(logArgs(dir, [])),
    git(["-C", dir, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--", ...PREVIEW_DIRS]),
  ]);
  const v = log == null || status == null ? null : { ...timesOf(log), changed: parseStatus(status) };
  if (checkoutCache.size > 500) checkoutCache.clear();
  checkoutCache.set(dir, { stamp, v });
  return v;
}

type TreeFile = { sub: string; oid: string; size: number };
type MainTree = Times & { head: MainHead; files: TreeFile[] };

/** The newest main tip and the preview images in its tree; read from git, never from a checkout. */
async function mainTree(root: string): Promise<MainTree | null> {
  const g = gitDirs(root);
  if (!g) return null;
  const stamp = [...MAIN_REFS, "packed-refs"].map((r) => mtimeOf(path.join(g.common, r))).join("|");
  const hit = mainCache.get(root);
  if (hit?.stamp === stamp) return hit.v;
  let v: MainTree | null = null;
  const refs = await git(["-C", root, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(committerdate:unix)%00%(subject)", ...MAIN_REFS]);
  const tip = (refs ?? "")
    .split("\n")
    .map((l) => l.split("\0"))
    .filter((f) => f.length >= 4 && /^[0-9a-f]{40,64}$/.test(f[1]))
    .map((f) => ({ ref: f[0].replace(/^refs\/(heads|remotes)\//, ""), sha: f[1], at: Number(f[2]) * 1000, subject: f.slice(3).join(" ").trim() }))
    .sort((a, b) => b.at - a.at)[0];
  if (tip) {
    const [tree, log] = await Promise.all([git(["-C", root, "ls-tree", "-r", "-l", "-z", tip.sha, "--", ...PREVIEW_DIRS]), git(logArgs(root, [tip.sha]))]);
    const files: TreeFile[] = [];
    for (const rec of (tree ?? "").split("\0")) {
      const tab = rec.indexOf("\t");
      if (tab < 0) continue;
      const [, type, oid, size] = rec.slice(0, tab).trim().split(/\s+/);
      const sub = rec.slice(tab + 1);
      const n = Number(size);
      if (type === "blob" && /^[0-9a-f]{40,64}$/.test(oid) && n > 0 && n <= maxBytesFor(sub) && inPreviewDir(sub)) files.push({ sub, oid, size: n });
    }
    v = { head: tip, files, ...timesOf(log ?? "") };
  }
  if (mainCache.size > 100) mainCache.clear();
  mainCache.set(root, { stamp, v });
  return v;
}

// ---- scan ----

type Target = { type: string } & ({ kind: "file"; abs: string } | { kind: "blob"; root: string; oid: string });
const typeOf = (name: string) => PREVIEW_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
type Cand = { item: PreviewItem; target: Target; key: string };

/** Of two copies of one image: a commit time beats an mtime (a copy's mtime is the copy's), then the newer wins. */
function better(a: Cand, b: Cand): Cand {
  if (a.item.timeFrom !== b.item.timeFrom) return a.item.timeFrom === "commit" ? a : b;
  return b.item.at > a.item.at ? b : a;
}

/** One checkout's images with their true time and card; a card worktree keeps only its card's images. */
async function scanBase(p: { root: string; name: string }, b: { dir: string; worktree: string | null }, realRoot: string): Promise<Cand[]> {
  const realBase = realOrNull(b.dir);
  // A worktree folder that is itself a link out of the repo is skipped whole.
  if (!realBase || !inside(realBase, realRoot)) return [];
  const found: Found[] = [];
  for (const d of PREVIEW_DIRS) {
    const top = path.join(b.dir, ...d.split("/"));
    const realTop = realOrNull(top);
    if (!realTop || !inside(realTop, realBase)) continue;
    walk(top, realBase, 0, { n: ENTRY_BUDGET }, found);
  }
  if (!found.length) return [];
  const g = await checkoutGit(b.dir, `${found.length}:${Math.max(...found.map((f) => f.st.mtimeMs))}:${found.reduce((n, f) => n + f.st.size, 0)}`);
  const changed = new Set(g?.changed);
  const changedDirs = g?.changed.filter((c) => c.endsWith("/")) ?? [];
  const branch = projectOf(b.dir)?.branch ?? null;
  const wtCard = b.worktree ? worktreeCard(b.worktree, branch) : null;
  const out: Cand[] = [];
  for (const f of found) {
    // The real file must sit inside the root too (a linked folder above passed, a hard path never leaves).
    const real = realOrNull(f.abs);
    if (!real || !inside(real, realBase)) continue;
    const sub = path.relative(b.dir, f.abs).split(path.sep).join("/");
    const dirty = !g || changed.has(sub) || changedDirs.some((d) => sub.startsWith(d));
    const commitAt = !g || dirty ? undefined : (g.times.get(sub) ?? (g.truncated ? g.oldest : undefined));
    let card = cardOf(sub);
    if (wtCard != null) {
      // A card worktree carries the whole repo: other cards' images and tracked unassigned ones belong elsewhere.
      if (card != null && card !== wtCard) continue;
      if (card == null) {
        if (commitAt !== undefined) continue;
        card = wtCard;
      }
    }
    out.push({
      key: `${sub}|${f.st.size}`,
      target: { kind: "file", abs: f.abs, type: typeOf(f.abs) },
      item: {
        id: previewId(f.abs),
        project: p.name,
        root: p.root,
        rel: path.relative(p.root, f.abs).split(path.sep).join("/"),
        worktree: b.worktree,
        branch,
        ref: null,
        card,
        at: commitAt ?? Math.round(f.st.mtimeMs),
        timeFrom: commitAt !== undefined ? "commit" : "file",
        size: f.st.size,
      },
    });
  }
  return out;
}

type Scan = { at: number; items: PreviewItem[]; main: MainHead | null; targets: Map<string, Target> };
const scans = new Map<string, Scan>();

async function scan(p: { root: string; name: string }): Promise<Scan> {
  const empty: Scan = { at: Date.now(), items: [], main: null, targets: new Map() };
  const realRoot = realOrNull(p.root);
  if (!realRoot) return empty;
  const [perBase, main] = await Promise.all([Promise.all(bases(p.root).map((b) => scanBase(p, b, realRoot))), mainTree(p.root)]);
  const cands = perBase.flat();
  for (const f of main?.files ?? []) {
    cands.push({
      key: `${f.sub}|${f.size}`,
      target: { kind: "blob", root: p.root, oid: f.oid, type: typeOf(f.sub) },
      item: {
        id: previewId(`git:${realRoot}:${f.sub}:${f.oid}`), // same bytes under two names: two items, two ids
        project: p.name,
        root: p.root,
        rel: f.sub,
        worktree: null,
        branch: null,
        ref: main!.head.ref,
        card: cardOf(f.sub),
        at: main!.times.get(f.sub) ?? (main!.truncated ? main!.oldest : main!.head.at),
        timeFrom: "commit",
        size: f.size,
      },
    });
  }
  // One image across checkouts (same path in the checkout and size): keep its truest, newest copy.
  // Ties keep the first seen: the root, then worktrees, then the main tree.
  const best = new Map<string, Cand>();
  for (const c of cands) {
    const had = best.get(c.key);
    best.set(c.key, had ? better(had, c) : c);
  }
  const kept = [...best.values()].sort((a, b) => b.item.at - a.item.at).slice(0, PREVIEW_CAP);
  const s: Scan = { at: Date.now(), items: kept.map((c) => c.item), main: main?.head ?? null, targets: new Map(kept.map((c) => [c.item.id, c.target])) };
  scans.set(rootKey(p.root), s);
  return s;
}

/** One project's images, newest true time first, at most PREVIEW_CAP. Never throws. */
export async function scanProject(p: { root: string; name: string }): Promise<PreviewItem[]> {
  return (await scan(p)).items;
}

/** Live projects folded onto their repo root (a room in a worktree shows under its repo), once each. */
export function previewRoots(projects: ProjectInfo[]): { root: string; name: string }[] {
  const seen = new Map<string, { root: string; name: string }>();
  for (const p of projects) {
    const root = mainRoot(p.root);
    const k = root.toLowerCase();
    if (!seen.has(k)) seen.set(k, { root, name: path.basename(root) || p.name });
  }
  return [...seen.values()];
}

export async function listPreviews(projects: ProjectInfo[]): Promise<ProjectPreviews[]> {
  return Promise.all(
    previewRoots(projects).map(async (p) => {
      const s = await scan(p);
      return { ...p, main: s.main, items: s.items };
    }),
  );
}

/** What an id from a live project's current list points at, else null (unknown ids and raw paths alike). */
async function targetOf(id: string, projects: ProjectInfo[]): Promise<Target | null> {
  for (const p of previewRoots(projects)) {
    const cached = scans.get(rootKey(p.root));
    // A fresh scan of another project that lacks the id is trusted: rescanning it per image request
    // walked every checkout of every earlier project.
    if (cached && Date.now() - cached.at < SCAN_TTL_MS) {
      const hit = cached.targets.get(id);
      if (hit) return hit;
      continue;
    }
    const fresh = (await scan(p)).targets.get(id);
    if (fresh) return fresh;
  }
  return null;
}

/** The bytes behind an id from the current list, else null. A file deleted since the list is null too. */
export async function openPreview(id: string | null, projects: ProjectInfo[]): Promise<{ type: string; body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer> } | null> {
  if (!isPreviewId(id)) return null;
  const t = await targetOf(id, projects);
  if (!t) return null;
  if (t.kind === "file") {
    try {
      await fs.promises.access(t.abs, fs.constants.R_OK);
    } catch {
      return null;
    }
    return { type: t.type, body: Readable.toWeb(fs.createReadStream(t.abs)) as ReadableStream<Uint8Array> };
  }
  const { promise, resolve } = Promise.withResolvers<Buffer | null>();
  execFile("git", ["-C", t.root, "cat-file", "blob", t.oid], { encoding: "buffer", timeout: GIT_TIMEOUT_MS, maxBuffer: PREVIEW_VIDEO_MAX_BYTES + 1024, windowsHide: true, env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0" } }, (err, stdout) =>
    resolve(err ? null : stdout),
  );
  const buf = await promise;
  if (!buf) return null;
  return { type: t.type, body: new Uint8Array(buf) };
}
