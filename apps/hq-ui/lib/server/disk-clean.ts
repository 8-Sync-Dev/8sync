// HQ's own disk cleanup (owner 2026-10-21: "tình trạng cao chú ý là phải auto xử lý gấp luôn không
// đợi gửi"). Right after a project is measured, flagged build output (`target`, `.next` over
// LIMITS.dir) of an agent's card worktree is removed when nothing uses that worktree and no build
// wrote to it for AUTO_IDLE_MS: what `cargo clean` does, the next build makes it again. Anything that
// needs judgment (worktrees, node_modules, .git, committed files) still goes to a room.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTO_IDLE_MS, autoCandidates, diskKey, type Cleaned, type ProjectDisk, type Sized } from "../disk";

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
    const out = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"]);
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
 * Remove the idle flagged build dirs of `p` ([autoCandidates]). A dir stays when `busy` (room folders
 * and process paths, asked only when there is a candidate) names its worktree, a build wrote to it
 * within AUTO_IDLE_MS, or it cannot be moved: Windows refuses to rename a folder while a process has
 * a file in it open. `busy` failing removes nothing. Moved into `.claude/hq-trash`, deleted in the
 * background ([purgeTrash]). `gone`: what went, for [withoutDirs]; null when nothing did.
 */
export async function cleanIdleBuild(
  p: Pick<ProjectDisk, "root" | "build">,
  busy: () => Promise<string[]>,
  now = Date.now(),
): Promise<{ cleaned: Cleaned; gone: Sized[] } | null> {
  const trash = trashDir(p.root);
  const gone: Sized[] = [];
  const cands = autoCandidates(p);
  const used = cands.length ? await busy().catch(() => null) : [];
  for (const b of used ? cands : []) {
    const abs = path.join(p.root, ...b.path.split("/"));
    const wt = path.dirname(abs);
    if (used!.some((l) => names(l, wt))) continue;
    if (now - (await lastWrite(abs)) < AUTO_IDLE_MS) continue;
    try {
      await fsp.mkdir(trash, { recursive: true });
      // Before the first move: a room's `git add -A` must never stage gigabytes of build output.
      const ignore = path.join(trash, ".gitignore");
      if (!fs.existsSync(ignore)) await fsp.writeFile(ignore, "# HQ: build output waiting for deletion\n*\n");
      await fsp.rename(abs, path.join(trash, `${now}-${path.basename(wt)}-${path.basename(abs)}`));
      gone.push(b);
    } catch {
      // in use (or already gone): the next pass looks again
    }
  }
  void purgeTrash(p.root);
  return gone.length ? { cleaned: { at: now, bytes: gone.reduce((n, g) => n + g.bytes, 0), dirs: gone.map((g) => g.path) }, gone } : null;
}
