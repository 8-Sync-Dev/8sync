// The projects HQ shows: the ones with a live room, plus the folders the owner added in the sidebar.
import type { DatabaseSync } from "node:sqlite";
import { groupByProject, type ProjectInfo } from "../office";
import { repoOf } from "../sidebar";
import { withMissing, type ProjectRow } from "./db";
import { projectOf } from "./office";
import { mergedSessions } from "./proc";

/** Projects with a live room, keyed like the office (git root, else the session's cwd). */
export function liveProjects(sessions: { name: string; cwd: string | null; status: string }[], projectOf: (cwd: string | null) => ProjectInfo | null): ProjectInfo[] {
  const rooms = sessions
    .filter((s) => s.status !== "ended" && s.cwd)
    .map((s) => ({ key: s.name, cwd: s.cwd, project: projectOf(s.cwd) }));
  return groupByProject(rooms).map((g) => g.project);
}

/** Projects with worktrees folded into their repo (lib/sidebar.ts repoOf), one entry per repo. */
export function repoProjects(projects: ProjectInfo[]): ProjectInfo[] {
  const out = new Map<string, ProjectInfo>();
  for (const p of projects) {
    const r = repoOf(p.root);
    const q = r.worktree ? { root: r.root, name: r.name, branch: null } : p;
    const k = q.root.toLowerCase();
    // The repo's own row (with its branch) wins over one made up from a worktree.
    if (!out.has(k) || !r.worktree) out.set(k, q);
  }
  return [...out.values()];
}

/** Projects with a live room, one per root. */
export async function projectsInView(db: DatabaseSync): Promise<ProjectInfo[]> {
  return liveProjects(await mergedSessions(db).catch(() => []), (cwd) => projectOf(cwd));
}

/** Every root HQ shows or the owner added in the sidebar, each in its own spelling. */
export async function knownRoots(db: DatabaseSync): Promise<string[]> {
  const added = withMissing(db.prepare("SELECT id, path, name, added_at FROM projects").all() as ProjectRow[])
    .filter((p) => !p.missing)
    .map((p) => p.path);
  return [...(await projectsInView(db)).map((p) => p.root), ...added];
}
