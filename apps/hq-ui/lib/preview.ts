// Shared by the Preview route (lib/server/preview.ts) and the views: item shape and pure helpers.

export type PreviewItem = {
  id: string;
  project: string;
  root: string;
  /** Path relative to the project root, `/`-separated; for an image read from `ref`, its path in that tree. */
  rel: string;
  /** Worktree folder name under `.claude/worktrees`, null for the root itself and for a ref. */
  worktree: string | null;
  branch: string | null;
  /** Set when no checkout has the image and HQ reads it from this ref (`origin/main`). */
  ref: string | null;
  /** True time (ms): its last commit when tracked and unmodified, else the file's mtime. */
  at: number;
  /** "commit": `at` is a commit time; "file": an untracked or modified file's mtime. */
  timeFrom: "commit" | "file";
  size: number;
};

/** The newest main branch tip the repo knows (local or `origin`). */
export type MainHead = { ref: string; sha: string; at: number; subject: string };

export type ProjectPreviews = { root: string; name: string; main: MainHead | null; items: PreviewItem[] };

/** A worktree path (`<root>/.claude/worktrees/<name>/…`) belongs to its repo root. */
export function mainRoot(root: string): string {
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+/.exec(root);
  return m ? m[1] : root;
}

/** Same folder across `\` vs `/`, case and the `\\?\` prefix Rust adds on Windows. */
export function rootKey(p: string): string {
  return mainRoot(p)
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** "home.png" from "qa/evidence/home.png". */
export const fileName = (rel: string) => rel.split("/").pop() ?? rel;

/** A demo video the rooms recorded (owner 2026-10-22: "xem ảnh, xem video demo"). */
export const isVideo = (rel: string): boolean => /\.(mp4|webm)$/i.test(rel);
