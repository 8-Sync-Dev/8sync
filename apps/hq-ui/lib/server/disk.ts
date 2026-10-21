// "Dung lượng dự án" (Máy tab): how big each HQ project has grown. One bounded walk per project
// (entry and time caps, symlinks and junctions skipped, never into another repo: a folder with its
// own `.git` is left out, except the worktrees under `.claude/worktrees`), plus the big git-tracked
// files from `git ls-tree -r -l HEAD`. On demand, cached ≤ 6 h in memory and in disk.json, so a
// restarted HQ still has the last result. The rules on what is abnormal live in lib/disk.ts.
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { coreCall } from "./core";
import { diskKey, findings, LIMITS, withoutDirs, type Finding, type ProjectDisk, type Sized } from "../disk";
import { cleanIdleBuild, processPaths, pruneWorktrees } from "./disk-clean";
import { loadFloor, ompSessions } from "./floor";
import { mergedSessions } from "./proc";
import type { ProjectInfo } from "../office";
import { getDb, withMissing } from "./db";
import { loadOffice, projectOf } from "./office";
import { projectBoards } from "./board";
import { heldCard, type BoardRef } from "../now";
import { sessionLabel } from "../labels";
import { stateDir } from "./paths";
import { PREVIEW_DIRS } from "./preview";
import { repoProjects } from "./targets";

/** Per project: stop after this many directory entries or this long; sizes are then lower bounds. */
export const WALK_ENTRIES = 400_000;
export const WALK_MS = 45_000;
/** A result older than this is scanned again the next time anyone asks. */
export const DISK_MAX_AGE_MS = 6 * 3600_000;
/** Build output folder names (outside node_modules and other build output). */
export const BUILD_DIRS: Record<string, true> = {
  target: true,
  ".next": true,
  dist: true,
  build: true,
  out: true,
  ".turbo": true,
  coverage: true,
  ".vite": true,
  ".svelte-kit": true,
  ".parcel-cache": true,
  ".nuxt": true,
  ".output": true,
};
const WORKTREES = ".claude/worktrees";
const UPLOADS = ".claude/hq-uploads";
const TOP = 12;

type Budget = { left: number; end: number; cut: boolean };
type Acc = { sizes: Record<string, number>; rootFiles: Sized[]; nodeModules: Sized[]; build: Sized[] };
/** `inside`: already under node_modules or build output (not reported again); `modules`: under node_modules. `own`: a repo or worktree root. */
type Where = { inside: boolean; modules: boolean; own: boolean };

/**
 * What deleting one name of a file frees (crates/cli/src/verbs/hq_core/disk.rs `reclaim`): under
 * node_modules a hard-linked file is a pnpm/bun store link (nothing), elsewhere (cargo's target)
 * each name counts its share.
 */
export const reclaim = (size: number, nlink: number, modules: boolean) => (modules && nlink > 1 ? 0 : Math.floor(size / Math.max(1, nlink)));

const WATCH: Record<string, true> = Object.fromEntries([".git", WORKTREES, UPLOADS, ...PREVIEW_DIRS].map((p) => [p, true]));

/** Reclaimable bytes under `abs` (files only, [`reclaim`]; Node's lstat reads the link count on Windows too). */
async function du(abs: string, rel: string, b: Budget, acc: Acc, at: Where): Promise<number> {
  if (b.cut) return 0;
  let ents: fs.Dirent[];
  try {
    ents = await fsp.readdir(abs, { withFileTypes: true });
  } catch {
    return 0;
  }
  if (!at.own && ents.some((e) => e.name === ".git")) return 0; // another repo: not this project's bytes
  const files: string[] = [];
  const dirs: string[] = [];
  for (const e of ents) {
    if (--b.left < 0 || Date.now() > b.end) {
      b.cut = true;
      break;
    }
    // Symlinks (and Windows junctions, which Node reports as links) are never followed.
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) dirs.push(e.name);
    else if (e.isFile()) files.push(e.name);
  }
  let total = 0;
  for (let i = 0; i < files.length; i += 64) {
    const sizes = await Promise.all(files.slice(i, i + 64).map((f) => fsp.lstat(path.join(abs, f)).then((s) => reclaim(s.size, s.nlink, at.modules), () => 0)));
    sizes.forEach((n, j) => {
      total += n;
      if (rel === "") acc.rootFiles.push({ path: files[i + j], bytes: n });
    });
  }
  for (const d of dirs) {
    const r = rel ? `${rel}/${d}` : d;
    const nm = d === "node_modules";
    const out = !at.inside && !nm && BUILD_DIRS[d] === true;
    const n = await du(path.join(abs, d), r, b, acc, { inside: at.inside || nm || out, modules: at.modules || nm, own: rel === WORKTREES });
    total += n;
    if (rel === "" || WATCH[r]) acc.sizes[r] = n;
    if (!at.inside && nm) acc.nodeModules.push({ path: r, bytes: n });
    else if (out) acc.build.push({ path: r, bytes: n });
  }
  return total;
}

/** `git ls-tree -r -l -z HEAD`: "<mode> blob <sha> <size>\t<path>\0"; files over the limit, biggest first. */
export function parseLsTree(out: string, min: number = LIMITS.trackedFile): Sized[] {
  const big: Sized[] = [];
  for (const rec of out.split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const meta = rec.slice(0, tab).trim().split(/\s+/);
    const n = Number(meta[3]);
    if (meta[1] === "blob" && Number.isFinite(n) && n > min) big.push({ path: rec.slice(tab + 1), bytes: n });
  }
  return big.sort((a, b) => b.bytes - a.bytes).slice(0, 20);
}

function lsTree(root: string): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  execFile("git", ["-C", root, "ls-tree", "-r", "-l", "-z", "HEAD"], { timeout: 20_000, windowsHide: true, maxBuffer: 64 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
  return promise;
}

const biggest = (xs: Sized[], n = 8) => xs.sort((a, b) => b.bytes - a.bytes).slice(0, n);

/** While the core answers 409 (it is measuring another project), ask again this often. */
const CORE_BUSY_RETRY_MS = 2_000;

/**
 * One project's sizes; never throws (an unreadable root comes back with `error`). The core walks it in
 * native code (same caps and skips, crates/cli/src/verbs/hq_core/disk.rs); else this walk. A busy core
 * (409: one walk at a time) means the project is still scanning: wait for it, never walk a second time.
 */
export async function scanDisk(p: { root: string; name: string }, now = Date.now()): Promise<ProjectDisk> {
  const empty = { root: p.root, name: p.name, total: 0, entries: [], git: null, worktrees: null, evidence: [], nodeModules: [], build: [], uploads: null, tracked: [], truncated: false, at: now };
  const giveUp = Date.now() + 2 * WALK_MS;
  for (;;) {
    const r = await coreCall("/v1/disk", { body: { root: p.root, name: p.name, at: now }, timeoutMs: WALK_MS + 30_000 });
    if (r?.status === 200 && (r.body as ProjectDisk | null)?.root === p.root) return r.body as ProjectDisk;
    if (r?.status !== 409) break; // no core (or it failed): this walk
    if (Date.now() >= giveUp) return { ...empty, error: "HQ core vẫn đang đo dự án khác, thử lại sau", ms: 0 };
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, CORE_BUSY_RETRY_MS);
    await promise;
  }
  const t0 = Date.now();
  const b: Budget = { left: WALK_ENTRIES, end: t0 + WALK_MS, cut: false };
  const acc: Acc = { sizes: {}, rootFiles: [], nodeModules: [], build: [] };
  try {
    if (!(await fsp.stat(p.root)).isDirectory()) return { ...empty, error: "không phải thư mục", ms: 0 };
  } catch {
    return { ...empty, error: "không đọc được thư mục", ms: 0 };
  }
  const [total, tree] = await Promise.all([du(p.root, "", b, acc, { inside: false, modules: false, own: true }), lsTree(p.root)]);
  // Top-level folders (a nested repo measures 0 and drops out) and files, biggest first.
  const entries = [...Object.entries(acc.sizes).filter(([k]) => !k.includes("/")).map(([k, n]) => ({ path: k, bytes: n, dir: true })), ...acc.rootFiles.map((f) => ({ ...f, dir: false }))]
    .filter((e) => e.bytes > 0)
    .sort((a, c) => c.bytes - a.bytes)
    .slice(0, TOP);
  const wtDirs = await fsp.readdir(path.join(p.root, WORKTREES), { withFileTypes: true }).then((es) => es.filter((e) => e.isDirectory()).length, () => null);
  const up = await fsp.readdir(path.join(p.root, UPLOADS), { withFileTypes: true }).catch(() => null);
  let uploads: ProjectDisk["uploads"] = null;
  if (up) {
    const ids = up.filter((e) => e.isDirectory());
    const mt = await Promise.all(ids.map((e) => fsp.stat(path.join(p.root, UPLOADS, e.name)).then((s) => s.mtimeMs, () => null)));
    const ok = mt.filter((m): m is number => m != null);
    uploads = { n: ids.length, bytes: acc.sizes[UPLOADS] ?? 0, oldest: ok.length ? Math.min(...ok) : null };
  }
  return {
    root: p.root,
    name: p.name,
    total,
    entries,
    git: acc.sizes[".git"] ?? null,
    worktrees: wtDirs == null ? null : { n: wtDirs, bytes: acc.sizes[WORKTREES] ?? 0 },
    evidence: PREVIEW_DIRS.filter((d) => acc.sizes[d] != null).map((d) => ({ path: d, bytes: acc.sizes[d] })),
    nodeModules: biggest(acc.nodeModules),
    build: biggest(acc.build),
    uploads,
    tracked: tree == null ? [] : parseLsTree(tree),
    truncated: b.cut,
    error: null,
    at: now,
    ms: Date.now() - t0,
  };
}

/**
 * The same projects the sidebar lists: every repo with a live room (worktrees folded into their
 * repo) and every folder added in HQ that still exists.
 */
export async function diskProjects(db: DatabaseSync): Promise<ProjectInfo[]> {
  const office = await loadOffice(db).catch(() => null);
  const live = repoProjects((office?.rooms ?? []).flatMap((r) => (r.project ? [r.project] : [])));
  const rows = withMissing(db.prepare("SELECT path, name FROM projects ORDER BY added_at").all() as { path: string; name: string }[]).filter((r) => !r.missing);
  const out = new Map(live.map((p) => [diskKey(p.root), p] as const));
  for (const r of rows) if (!out.has(diskKey(r.path))) out.set(diskKey(r.path), { root: r.path, name: r.name, branch: null });
  return [...out.values()];
}

export type DiskProject = ProjectDisk & { findings: Finding[] };
/** `at`: when the oldest listed result was measured (each project carries its own `at`). */
export type DiskState = { projects: DiskProject[]; at: number | null; scanning: boolean };
/** `queued`: folders (diskKey) a running or waiting scan will measure. */
type Store = { projects: ProjectDisk[]; scanning: Promise<void> | null; queued: Set<string>; loaded: boolean };

// On globalThis: the cleanup loop (instrumentation bundle) and the routes share one cache and one scan.
const g = globalThis as unknown as { __hqDisk?: Store };
const store = (): Store => (g.__hqDisk ??= { projects: [], scanning: null, queued: new Set(), loaded: false });
const diskFile = () => path.join(stateDir(), "disk.json");

function load(s: Store) {
  if (s.loaded) return;
  s.loaded = true;
  try {
    const v = JSON.parse(fs.readFileSync(diskFile(), "utf8"));
    if (v && Array.isArray(v.projects)) s.projects = v.projects.filter((p: ProjectDisk) => p && typeof p.root === "string" && typeof p.at === "number");
  } catch {
    // no earlier scan
  }
}

function save(projects: ProjectDisk[]) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(diskFile(), JSON.stringify({ projects }), { mode: 0o600 });
  } catch (e) {
    console.error("[hq] disk.json not written", e);
  }
}

/**
 * What is in use (disk-clean.ts): the folders of rooms in a turn, waiting on the owner, or holding a
 * card (between ticks, its next build would start cold), and every process's command line. A room with
 * no card builds nothing: dev-ide (2026-10-21) stood "Chờ card" in card-15's worktree for 13 h and kept
 * its 44 GB target out of every pass. Throws when the sessions or processes cannot be read, so nothing
 * is removed (loadOffice would read a failed session list as none); unreadable boards count as no card.
 */
async function inUse(): Promise<string[]> {
  const db = getDb();
  const [merged, floor, procs] = await Promise.all([mergedSessions(db), loadFloor(db), processPaths()]);
  if (!procs) throw new Error("process list unreadable");
  const rooms = [...merged, ...ompSessions(db, floor)].filter((s) => s.status !== "ended");
  const projects = new Map<string, ProjectInfo>();
  for (const r of rooms) {
    const p = projectOf(r.cwd);
    if (p) projects.set(p.root, p);
  }
  const boards = await projectBoards([...projects.values()]).catch(() => [] as BoardRef[]);
  const busy = rooms.filter((r) => r.status === "running" || r.status === "needs_input" || heldCard({ ...r, label: sessionLabel(r) }, boards) != null);
  return [...busy.flatMap((r) => (r.cwd ? [r.cwd] : [])), ...procs];
}

/**
 * Measure `projects` (one at a time: the disk, not the CPU, is the limit). Each result replaces
 * only that project's earlier one, so a scan of a few projects (the loop) keeps everyone else's.
 * Projects already queued are not measured twice; the rest wait for the running scan.
 */
export function startScan(projects: ProjectInfo[]): Promise<void> {
  const s = store();
  load(s);
  const want = projects.filter((p, i) => !s.queued.has(diskKey(p.root)) && projects.findIndex((q) => diskKey(q.root) === diskKey(p.root)) === i);
  if (!want.length) return s.scanning ?? Promise.resolve();
  for (const p of want) s.queued.add(diskKey(p.root));
  const run = (s.scanning ?? Promise.resolve()).then(async () => {
    for (const p of want) {
      let d = await scanDisk(p);
      const prev = s.projects.find((o) => diskKey(o.root) === diskKey(d.root));
      // Idle worktree build output goes right away, then the worktrees that are merged or closed and
      // unused (disk-clean.ts); the rest waits for a room.
      const c = d.error ? null : await cleanIdleBuild(d, inUse).catch(() => null);
      d = c ? { ...withoutDirs(d, c.gone), cleaned: c.cleaned ?? prev?.cleaned ?? null, inUse: c.kept } : { ...d, cleaned: prev?.cleaned ?? null };
      const w = d.error ? null : await pruneWorktrees(d, inUse).catch(() => null);
      d = { ...d, pruned: w?.pruned ?? prev?.pruned ?? null, wtKept: w?.kept ?? null };
      if (w?.pruned && d.worktrees) d.worktrees = { ...d.worktrees, n: Math.max(0, d.worktrees.n - w.pruned.n) };
      s.projects = [d, ...s.projects.filter((o) => diskKey(o.root) !== diskKey(d.root))];
      s.queued.delete(diskKey(p.root));
    }
    save(s.projects);
  });
  const tracked: Promise<void> = run.finally(() => {
    for (const p of want) s.queued.delete(diskKey(p.root));
    if (s.scanning === tracked) s.scanning = null;
  });
  s.scanning = tracked;
  return tracked;
}

/** The cached results for these projects, findings included; `stale`: one is missing or older than 6 h. */
export function diskState(projects: ProjectInfo[], now = Date.now()): DiskState & { stale: boolean } {
  const s = store();
  load(s);
  const byKey = new Map(s.projects.map((p) => [diskKey(p.root), p] as const));
  const list = projects.flatMap((p) => {
    const d = byKey.get(diskKey(p.root));
    return d ? [{ ...d, name: p.name, findings: findings(d, now) }] : [];
  });
  const stale = list.length < projects.length || list.some((p) => now - p.at > DISK_MAX_AGE_MS);
  return {
    projects: list,
    at: list.length ? Math.min(...list.map((p) => p.at)) : null,
    scanning: projects.some((p) => s.queued.has(diskKey(p.root))),
    stale,
  };
}

/** Test seam: forget the cache (and whether disk.json was read). */
export function resetDisk() {
  delete g.__hqDisk;
}
