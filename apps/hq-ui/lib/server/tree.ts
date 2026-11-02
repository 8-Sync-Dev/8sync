// The workspace's machine folder tree (GET /api/tree): folders only, one level at a time, so the page
// can browse the whole PC lazily and pick a project to open omp sessions in. Names and paths only,
// never file contents. Behind the HQ token like /api/fs (owner-equivalent on both sides).
// Tested in tests/tree.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TREE_MAX = 500;

export type TreeDir = { name: string; path: string; git: boolean };
export type TreeListing = { path: string; parent: string | null; roots: string[]; dirs: TreeDir[] };

/** Folders never worth a step: dot-dirs, dependency dumps, Windows system folders. */
export function hiddenDir(name: string, platform: NodeJS.Platform = process.platform): boolean {
  if (name.startsWith(".") || name === "node_modules") return true;
  return platform === "win32" && (name.startsWith("$") || name === "System Volume Information");
}

/** Where browsing starts: the drives that exist on Windows (`C:\` …), else `/` and home. */
export function treeRoots(platform: NodeJS.Platform = process.platform, home = os.homedir(), exists: (p: string) => boolean = fs.existsSync): string[] {
  if (platform === "win32") {
    const out: string[] = [];
    for (let c = 65; c <= 90; c++) {
      const d = `${String.fromCharCode(c)}:\\`;
      if (exists(d)) out.push(d);
    }
    return out;
  }
  return [...new Set(["/", home])];
}

let rootsCache: { at: number; v: string[] } | null = null;
const ROOTS_TTL_MS = 30_000;

/** [treeRoots], asked at most every 30 s (probing 26 drive letters is not free with a dead network drive). */
export function cachedRoots(): string[] {
  if (!rootsCache || Date.now() - rootsCache.at > ROOTS_TTL_MS) rootsCache = { at: Date.now(), v: treeRoots() };
  return rootsCache.v;
}

/** The folder `p` names when it is an absolute, readable directory; null otherwise. */
export function resolveTreeDir(p: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!p || p.length > 4096 || p.includes("\0")) return null;
  const abs = platform === "win32" ? path.win32 : path.posix;
  if (!abs.isAbsolute(p) || (platform === "win32" && !/^([a-z]:[\\/]|\\\\)/i.test(p))) return null;
  const dir = abs.resolve(p);
  try {
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/** The folder above `dir`, or null at a drive / filesystem root. */
export function treeParent(dir: string): string | null {
  const up = path.dirname(dir);
  return up === dir ? null : up;
}

/** Sub-folders of `dir` (symlinks followed), hidden ones left out, by name, at most TREE_MAX; `git` = holds a `.git`. */
export function listTree(dir: string, platform: NodeJS.Platform = process.platform): TreeDir[] {
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: TreeDir[] = [];
  for (const d of ents) {
    if (hiddenDir(d.name, platform)) continue;
    const p = path.join(dir, d.name);
    let isDir = d.isDirectory();
    if (!isDir && d.isSymbolicLink()) {
      try {
        isDir = fs.statSync(p).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir) out.push({ name: d.name, path: p, git: false });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const kept = out.slice(0, TREE_MAX);
  for (const d of kept) d.git = fs.existsSync(path.join(d.path, ".git"));
  return kept;
}

/** GET /api/tree's answer: `path` empty = the roots themselves, listed as `dirs` too (no parent). */
export function treeListing(p: string, roots: string[] = cachedRoots()): TreeListing | null {
  if (!p) return { path: "", parent: null, roots, dirs: roots.map((r) => ({ name: r, path: r, git: fs.existsSync(path.join(r, ".git")) })) };
  const dir = resolveTreeDir(p);
  if (!dir) return null;
  return { path: dir, parent: treeParent(dir), roots, dirs: listTree(dir) };
}
