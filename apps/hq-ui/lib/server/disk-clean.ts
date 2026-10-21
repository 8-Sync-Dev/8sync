// HQ's own disk cleanup (owner 2026-10-21: "tình trạng cao chú ý là phải auto xử lý gấp luôn không
// đợi gửi"). Right after a project is measured, flagged build output (`target`, `.next` over
// LIMITS.dir) of an agent's card worktree is removed when nothing uses that worktree and no build
// wrote to it for AUTO_IDLE_MS: what `cargo clean` does, the next build makes it again. Then the card
// worktrees nothing uses whose work is merged or whose card is closed go too ([pruneWorktrees]:
// platform had 74, ide 21 on 2026-10-21, mailed to a room each day and never removed). Anything that
// needs judgment (node_modules, .git, committed files) still goes to a room.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTO_DIR, AUTO_IDLE_MS, autoCandidates, diskKey, PRUNE_IDLE_MS, type Cleaned, type ProjectDisk, type Pruned, type Sized, type WtKept } from "../disk";
import { readBoard } from "./board";

/** Moved build dirs wait here for deletion (git-ignored); what a stopped HQ left goes on the next pass. */
export const trashDir = (root: string) => path.join(root, ".claude", "hq-trash");

/** Newest change in a build dir: itself, its folders and theirs (cargo adds to deps/, incremental/, .fingerprint/ on every build). */
export async function lastWrite(dir: string): Promise<number> {
  const at = async (p: string) => (await fsp.stat(p).catch(() => null))?.mtimeMs ?? 0;
  const dirs = async (p: string) => (await fsp.readdir(p, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => path.join(p, d.name));
  let t = await at(dir);
  for (const a of await dirs(dir)) {
    t = Math.max(t, await at(a));
    for (const b of await dirs(a)) t = Math.max(t, await at(b));
  }
  return t;
}

const run = (cmd: string, args: string[]) =>
  new Promise<string | null>((resolve) => execFile(cmd, args, { timeout: 30_000, windowsHide: true, maxBuffer: 32 << 20 }, (err, out) => resolve(err ? null : String(out))));

/**
 * What running processes point at: every command line, and on Linux every working folder. A dev or
 * preview server left from an ended room names its worktree there. Null when they cannot be read.
 */
export async function processPaths(platform: NodeJS.Platform = process.platform): Promise<string[] | null> {
  if (platform === "win32") {
    const out = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"]);
    return out == null ? null : out.split(/\r?\n/).filter(Boolean);
  }
  if (platform === "linux") {
    const ids = (await fsp.readdir("/proc").catch(() => null))?.filter((n) => /^\d+$/.test(n));
    if (!ids) return null;
    const out: string[] = [];
    for (const id of ids) {
      const cwd = await fsp.readlink(`/proc/${id}/cwd`).catch(() => null);
      const cmd = await fsp.readFile(`/proc/${id}/cmdline`, "utf8").catch(() => null);
      if (cwd) out.push(cwd);
      if (cmd) out.push(cmd.replace(/\0/g, " "));
    }
    return out;
  }
  const out = await run("ps", ["-axo", "args="]);
  return out == null ? null : out.split("\n").filter(Boolean);
}

/** Whether a folder or command line names `dir` (or something in it): `card-1` is not `card-13`. */
export function names(line: string, dir: string): boolean {
  const l = line.replace(/\\/g, "/").toLowerCase();
  const k = diskKey(dir);
  for (let i = l.indexOf(k); i >= 0; i = l.indexOf(k, i + 1)) if (!/[\w.-]/.test(l[i + k.length] ?? "")) return true;
  return false;
}

/** Delete `dir` in a child process at below-normal priority: a big `target` holds a million files. */
function removeTree(dir: string): Promise<void> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["-e", "require('fs').rmSync(process.argv[1],{recursive:true,force:true,maxRetries:3})", dir], { stdio: "ignore", windowsHide: true });
    try {
      if (c.pid) os.setPriority(c.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // already exited
    }
    c.on("error", () => resolve());
    c.on("exit", () => resolve());
  });
}

// On globalThis: the loop (instrumentation bundle) and the routes share one purge per project.
const g = globalThis as unknown as { __hqTrash?: Map<string, Promise<void>> };
const purges = () => (g.__hqTrash ??= new Map());

/** Delete what waits in `root`'s trash, in the background; a purge already running is returned, not doubled. */
export function purgeTrash(root: string): Promise<void> {
  const k = diskKey(root);
  const running = purges().get(k);
  if (running) return running;
  const trash = trashDir(root);
  const p = fsp
    .readdir(trash)
    .catch(() => [] as string[])
    .then((left) => Promise.all(left.filter((n) => n !== ".gitignore").map((n) => removeTree(path.join(trash, n)))))
    .then(() => undefined)
    .finally(() => purges().delete(k));
  purges().set(k, p);
  return p;
}

/**
 * Whether `abs` is a tool's build output, not a source folder that happens to be called `target`:
 * cargo's `target` has its CACHEDIR.TAG or a Cargo.toml beside it; a `.next` has a package.json beside it.
 */
function isBuildOutput(abs: string): boolean {
  const beside = (f: string) => fs.existsSync(path.join(path.dirname(abs), f));
  return path.basename(abs) === "target" ? fs.existsSync(path.join(abs, "CACHEDIR.TAG")) || beside("Cargo.toml") : beside("package.json");
}

/**
 * Remove the idle flagged build dirs of `p` ([autoCandidates]). A dir stays when `busy` (room folders
 * and process paths, asked only when there is a candidate) names its worktree, a build wrote to it
 * within AUTO_IDLE_MS, or it cannot be moved: Windows refuses to rename a folder while a process has
 * a file in it open. `busy` failing removes nothing. Moved into `.claude/hq-trash`, deleted in the
 * background ([purgeTrash]). `gone`: what went, for [withoutDirs]; `kept`: the dirs left because
 * they are (or may be) in use, which the cleanup mail must not hand to a room either.
 */
export async function cleanIdleBuild(
  p: Pick<ProjectDisk, "root" | "build">,
  busy: () => Promise<string[]>,
  now = Date.now(),
): Promise<{ cleaned: Cleaned | null; gone: Sized[]; kept: string[] }> {
  const trash = trashDir(p.root);
  const gone: Sized[] = [];
  const kept: string[] = [];
  const cands = autoCandidates(p);
  const used = cands.length ? await busy().catch(() => null) : [];
  for (const [i, b] of cands.entries()) {
    const abs = path.join(p.root, ...b.path.split("/"));
    if (!isBuildOutput(abs)) continue;
    // The whole worktree: a dev server at its root uses `src-tauri/target` and `apps/web/.next` too.
    const wt = path.join(p.root, ...AUTO_DIR.exec(b.path)![1].split("/"));
    if (!used || used.some((l) => names(l, wt)) || now - (await lastWrite(abs)) < AUTO_IDLE_MS) {
      kept.push(b.path);
      continue;
    }
    try {
      await fsp.mkdir(trash, { recursive: true });
      // Before the first move: a room's `git add -A` must never stage gigabytes of build output.
      const ignore = path.join(trash, ".gitignore");
      if (!fs.existsSync(ignore)) await fsp.writeFile(ignore, "# HQ: build output waiting for deletion\n*\n");
      await fsp.rename(abs, path.join(trash, `${now}-${i}-${path.basename(wt)}-${path.basename(abs)}`));
      gone.push(b);
    } catch {
      // a file in it is open (a build running right now), or it is gone already
      if (fs.existsSync(abs)) kept.push(b.path);
    }
  }
  void purgeTrash(p.root);
  return { cleaned: gone.length ? { at: now, bytes: gone.reduce((n, g) => n + g.bytes, 0), dirs: gone.map((g) => g.path) } : null, gone, kept };
}

/** `git` with argv only, no shell, 20 s unless told otherwise; null when it fails, times out or exits non-zero. */
const git = (args: string[], timeout = 20_000) =>
  new Promise<string | null>((resolve) => execFile("git", args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? null : String(out))));

export type Worktree = { path: string; head: string; branch: string | null };

/** `git worktree list --porcelain`: every linked worktree with its HEAD and branch (null: detached). */
export function parseWorktrees(out: string): Worktree[] {
  return out
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const line = (k: string) => block.split(/\r?\n/).find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? null;
      const p = line("worktree");
      return p ? { path: p, head: line("HEAD") ?? "", branch: line("branch")?.replace(/^refs\/heads\//, "") ?? null } : null;
    })
    .filter((w): w is Worktree => w != null);
}

/** The branch merged work lands on: origin's HEAD, else a local `main`/`master`; null when there is none to compare with. */
async function defaultBranch(root: string): Promise<string | null> {
  const remote = (await git(["-C", root, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]))?.trim();
  if (remote) return remote;
  for (const b of ["main", "master"]) if ((await git(["-C", root, "rev-parse", "-q", "--verify", `refs/heads/${b}`])) != null) return b;
  return null;
}

/** Ids of the cards the board closed (done or dropped): their worktree has nothing left to do. Unreadable board: none. */
async function closedCards(root: string): Promise<Set<number>> {
  const b = await readBoard({ root, name: path.basename(root), branch: null });
  return new Set(b.board?.closed.map((c) => c.id) ?? []);
}

/** Newest change at the top of a worktree: the folder, its entries and the `.git` file (a checkout or commit rewrites it). */
async function newestTop(dir: string): Promise<number> {
  const es = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const ts = await Promise.all([dir, ...es.map((e) => path.join(dir, e.name))].map((p) => fsp.stat(p).then((s) => s.mtimeMs, () => 0)));
  return Math.max(0, ...ts);
}

/**
 * Remove the card worktrees (`<root>/.claude/worktrees/<name>`) of `p` that are done with, in series
 * (git holds one worktree lock). One goes only when ALL hold: nothing in `busy` (room folders and
 * process paths) names it; nothing wrote at its top for PRUNE_IDLE_MS; its work landed on the default
 * branch — HEAD reachable from it, or a commit there names the card ("(card 106) (#123)": every PR of
 * platform is squash-merged, so on 2026-10-21 none of its 72 worktree HEADs was an ancestor of
 * origin/main and the board kept only the last 10 closed cards) — or the board closed its card
 * (`card-<id>`, done or dropped); and `git status --porcelain` is empty but for 8sync's own standup
 * note (a failing git keeps it).
 * `git worktree remove` without `--force`, then `branch -d` (never `-D`: a squash-merged branch stays).
 * A worktree git still lists whose folder is gone only needs `worktree prune`. `busy` failing
 * removes nothing (`kept` null: unknown).
 */
export async function pruneWorktrees(
  p: Pick<ProjectDisk, "root">,
  busy: () => Promise<string[]>,
  now = Date.now(),
  closed: (root: string) => Promise<Set<number>> = closedCards,
): Promise<{ pruned: Pruned | null; kept: WtKept | null }> {
  // Only the repo's own card worktrees: one registered anywhere else (hq-play's, the owner's) is not HQ's to remove.
  const under = `${diskKey(path.join(p.root, ".claude", "worktrees"))}/`;
  const list = await git(["-C", p.root, "worktree", "list", "--porcelain"]);
  const wts = list == null ? [] : parseWorktrees(list).filter((w) => diskKey(w.path).startsWith(under));
  const kept: WtKept = { n: wts.length, busy: 0, recent: 0, open: 0, dirty: 0, failed: 0 };
  if (!wts.length) return { pruned: null, kept };
  const used = await busy().catch(() => null);
  if (!used) return { pruned: null, kept: null };
  const [base, done] = await Promise.all([defaultBranch(p.root), closed(p.root).catch(() => new Set<number>())]);
  const names_: string[] = [];
  let stale = false;
  for (const w of wts) {
    const name = path.basename(w.path);
    if (!fs.existsSync(w.path)) {
      stale = true;
      names_.push(name);
      continue;
    }
    if (used.some((l) => names(l, w.path))) {
      kept.busy++;
      continue;
    }
    if (now - (await newestTop(w.path)) < PRUNE_IDLE_MS) {
      kept.recent++;
      continue;
    }
    const id = /^card-(\d+)/.exec(name)?.[1] ?? null;
    const merged = base != null && w.head !== "" && (await git(["-C", p.root, "merge-base", "--is-ancestor", w.head, base])) != null;
    const landed = merged || (base != null && id != null && ((await git(["-C", p.root, "log", base, "-1", "--format=%H", "-E", "-i", `--grep=card #?${id}([^0-9]|$)`])) ?? "").trim() !== "");
    if (!landed && !(id != null && done.has(Number(id)))) {
      kept.open++;
      continue;
    }
    // `8sync ccc meet` writes its daily note into the room's cwd (su-code/standup/<date>.md): 8sync's
    // own log, not the card's work. On 2026-10-21, 50 of platform's 72 worktrees differed from HEAD by
    // it alone, and `worktree remove` refuses any untracked file, so it goes first. Anything else
    // untracked (a nested .claude/worktrees, a stray file) or modified is the room's: kept.
    const status = (await git(["-C", w.path, "status", "--porcelain", "-uall"]))?.split(/\r?\n/).filter(Boolean);
    if (!status || status.some((l) => !/^\?\? su-code\/standup\//.test(l))) {
      kept.dirty++;
      continue;
    }
    if (status.length) await fsp.rm(path.join(w.path, "su-code", "standup"), { recursive: true, force: true });
    // Deleting node_modules on Windows is slow: longer than the 20 s a query gets.
    if ((await git(["-C", p.root, "worktree", "remove", w.path], 120_000)) == null) {
      kept.failed++;
      continue;
    }
    stale = true;
    names_.push(name);
    if (merged && w.branch) await git(["-C", p.root, "branch", "-d", w.branch]);
  }
  if (stale) await git(["-C", p.root, "worktree", "prune"]);
  return { pruned: names_.length ? { at: now, n: names_.length, names: names_ } : null, kept };
}
