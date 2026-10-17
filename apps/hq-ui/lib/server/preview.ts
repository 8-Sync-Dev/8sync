// Preview tab: the screenshots rooms save while they work (qa/ui put UAT shots in
// `qa/evidence/card-<id>-<slug>.png`, crates/cli/src/verbs/ccc/room.rs). Read-only, a few known
// folders per project root and its worktrees, never a path the client sends: the file route serves
// an image only by the opaque id this list gave it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProjectInfo } from "../office";
import { cardOf, mainRoot, type PreviewItem, type ProjectPreviews } from "../preview";
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
};
/** Levels of sub-folders walked inside a preview folder. */
export const PREVIEW_DEPTH = 3;
export const PREVIEW_MAX_BYTES = 15 * 1024 * 1024;
export const PREVIEW_CAP = 120;
/** Directory entries looked at per preview folder: a huge evidence tree never stalls a poll. */
const ENTRY_BUDGET = 4_000;
const WORKTREES_MAX = 60;

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

/** Image files under one preview folder, depth-limited; every entry's real path stays inside `realBase`. */
function walk(dir: string, realBase: string, depth: number, budget: { n: number }, out: { abs: string; st: fs.Stats }[]) {
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
      if (st.size > 0 && st.size <= PREVIEW_MAX_BYTES) out.push({ abs, st });
    } catch {
      /* gone between readdir and stat */
    }
  }
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

/** One project's images, newest first, at most PREVIEW_CAP. Never throws. */
export function scanProject(p: { root: string; name: string }): PreviewItem[] {
  const realRoot = realOrNull(p.root);
  if (!realRoot) return [];
  const items: PreviewItem[] = [];
  for (const b of bases(p.root)) {
    const realBase = realOrNull(b.dir);
    // A worktree folder that is itself a link out of the repo is skipped whole.
    if (!realBase || !inside(realBase, realRoot)) continue;
    const found: { abs: string; st: fs.Stats }[] = [];
    for (const d of PREVIEW_DIRS) {
      const top = path.join(b.dir, ...d.split("/"));
      const realTop = realOrNull(top);
      if (!realTop || !inside(realTop, realBase)) continue;
      walk(top, realBase, 0, { n: ENTRY_BUDGET }, found);
    }
    if (!found.length) continue;
    const branch = projectOf(b.dir)?.branch ?? null;
    for (const f of found) {
      // The real file must sit inside the root too (a linked folder above passed, a hard path never leaves).
      const real = realOrNull(f.abs);
      if (!real || !inside(real, realBase)) continue;
      const rel = path.relative(p.root, f.abs).split(path.sep).join("/");
      items.push({
        id: previewId(f.abs),
        project: p.name,
        root: p.root,
        rel,
        worktree: b.worktree,
        branch,
        card: cardOf(rel),
        mtime: Math.round(f.st.mtimeMs),
        size: f.st.size,
      });
    }
  }
  return items.sort((a, b) => b.mtime - a.mtime).slice(0, PREVIEW_CAP);
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

export function listPreviews(projects: ProjectInfo[]): ProjectPreviews[] {
  return previewRoots(projects).map((p) => ({ ...p, items: scanProject(p) }));
}

/** The file behind an id from the current list, else null (unknown ids and raw paths alike). */
export function findPreview(id: string | null, projects: ProjectInfo[]): { abs: string; type: string; size: number } | null {
  if (!isPreviewId(id)) return null;
  for (const p of listPreviews(projects)) {
    const hit = p.items.find((i) => i.id === id);
    if (hit) {
      const abs = path.join(hit.root, ...hit.rel.split("/"));
      return { abs, type: PREVIEW_TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream", size: hit.size };
    }
  }
  return null;
}
