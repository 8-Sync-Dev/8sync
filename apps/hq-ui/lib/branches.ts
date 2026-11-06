// The sidebar's branches (owner 2026-11-06, comparing with Orca: "ra lệnh xong bên Orca thấy full branch
// do agent mở"): every git worktree of a project's repo, the branch checked out there, and the sessions
// running in it. A linked worktree, even a sibling folder like `su-code-panes` of `su-code`, is one more
// branch of its repo's project, never a project of its own. Pure; the worktree lists come from
// `GET /api/projects/branches` (lib/server/branches.ts). Tested in tests/branches.test.ts.
import type { TreeGroup, TreeSession } from "./session-tree";
import { groupKey } from "./sidebar";
import { within, type WorktreeEntry } from "./worktree";

/** One repo as `GET /api/projects/branches` returns it: `git worktree list --porcelain`, main first. */
export type RepoWorktrees = { main: string; worktrees: WorktreeEntry[] };

/** One worktree folder with the repo it belongs to. */
export type WorktreeSpot = {
  /** groupKey(path). */
  key: string;
  path: string;
  /** The folder's own name. */
  name: string;
  repo: string;
  repoKey: string;
  repoName: string;
  /** The repo's main worktree (not a linked one). */
  main: boolean;
  branch: string | null;
  /** The branch, or `HEAD @ <sha7>` when detached. */
  label: string;
  locked: boolean;
};

/** Every worktree, deepest path first (the first one containing a folder is the one it is in). */
export type BranchIndex = { spots: WorktreeSpot[]; repos: Map<string, WorktreeSpot[]> };

const base = (p: string) => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;
const byName = (a: string, b: string) => a.localeCompare(b, "vi", { sensitivity: "base", numeric: true });

/** What a worktree has checked out, in words: the branch, else the detached commit. */
export function branchLabel(e: Pick<WorktreeEntry, "branch" | "head">): string {
  if (e.branch) return e.branch;
  return e.head ? `HEAD @ ${e.head.slice(0, 7)}` : "HEAD tách rời";
}

/** The worktree lists as one index. A repo listed twice (reached from two roots) counts once; bare entries have no folder to work in. */
export function branchIndex(repos: readonly RepoWorktrees[]): BranchIndex {
  const byRepo = new Map<string, WorktreeSpot[]>();
  for (const r of repos) {
    const repoKey = groupKey(r.main);
    if (byRepo.has(repoKey)) continue;
    const repoName = base(r.main);
    byRepo.set(
      repoKey,
      r.worktrees
        .filter((e) => !e.bare)
        .map((e) => ({ key: groupKey(e.path), path: e.path, name: base(e.path), repo: r.main, repoKey, repoName, main: groupKey(e.path) === repoKey, branch: e.branch, label: branchLabel(e), locked: e.locked })),
    );
  }
  const spots = [...byRepo.values()].flat().sort((a, b) => b.key.length - a.key.length);
  return { spots, repos: byRepo };
}

/** The deepest worktree that holds `dir`, null when none does (or before the lists arrive). */
export function spotOf(dir: string | null | undefined, idx: BranchIndex | null): WorktreeSpot | null {
  if (!dir || !idx) return null;
  return idx.spots.find((s) => within(dir, s.path)) ?? null;
}

/** The folder a session works in: its cwd, else its project root. */
export const dirOf = (s: Pick<TreeSession, "cwd" | "root">): string | null => s.cwd ?? s.root;

/**
 * The project group a session goes under: the repo when it runs in a linked worktree of it (a sibling
 * folder too), else its own root as before. `key` is "" when the folder is unknown.
 */
export function homeOf(s: Pick<TreeSession, "cwd" | "root" | "folder">, idx: BranchIndex | null): { key: string; root: string | null; label: string } {
  const spot = spotOf(dirOf(s), idx);
  if (spot && !spot.main) return { key: spot.repoKey, root: spot.repo, label: spot.repoName };
  return { key: s.root ? groupKey(s.root) : "", root: s.root, label: s.folder };
}

/** The worktree's folder name, when it says something its branch does not (never for the main worktree). */
export function folderNote(spot: Pick<WorktreeSpot, "main" | "name" | "branch">): string | null {
  if (spot.main) return null;
  const b = spot.branch?.toLowerCase() ?? "";
  const n = spot.name.toLowerCase();
  return b === n || b.endsWith(`/${n}`) ? null : spot.name;
}

/** Sessions on one worktree (`spot` null: ones git places nowhere, shown without a header). */
export type BranchSection = { key: string; spot: WorktreeSpot | null; sessions: TreeSession[] };
/** `idle`: the repo's worktrees with no session, main first, then by branch. */
export type GroupBranches = { sections: BranchSection[]; idle: WorktreeSpot[] };

/**
 * A project group's sessions by worktree: unplaced ones first (no header), then the main worktree,
 * then the linked ones in the order of their first session in `g.sessions` (already sorted, so the
 * owner's drag order holds). Null when git knows nothing about the group: it renders as before.
 */
export function groupBranches(g: Pick<TreeGroup, "root" | "sessions">, idx: BranchIndex | null): GroupBranches | null {
  if (!idx || !g.root) return null;
  const repo = idx.repos.get(groupKey(g.root)) ?? null;
  const at = new Map<string, BranchSection>();
  const loose: TreeSession[] = [];
  for (const s of g.sessions) {
    const spot = spotOf(dirOf(s), idx);
    if (!spot) {
      loose.push(s);
      continue;
    }
    let sec = at.get(spot.key);
    if (!sec) at.set(spot.key, (sec = { key: spot.key, spot, sessions: [] }));
    sec.sessions.push(s);
  }
  if (!repo && at.size === 0) return null;
  // A stable sort: the linked worktrees keep the order of their first session.
  const placed = [...at.values()].sort((a, b) => Number(b.spot!.main) - Number(a.spot!.main));
  const idle = (repo ?? []).filter((s) => !at.has(s.key)).sort((a, b) => Number(b.main) - Number(a.main) || byName(a.label, b.label));
  return { sections: [...(loose.length ? [{ key: "~loose", spot: null, sessions: loose }] : []), ...placed], idle };
}

/** The sessions as they stand on screen (drag & drop pins this order). */
export const shownOrder = (g: Pick<TreeGroup, "sessions">, b: GroupBranches | null): TreeSession[] => (b ? b.sections.flatMap((x) => x.sessions) : g.sessions);
