// The projects HQ shows: the ones with a live room, plus the folders the owner added in the sidebar.
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { groupByProject, type ProjectInfo } from "../office";
import { repoOf } from "../sidebar";
import { inside } from "./artifacts";
import { withMissing, type ProjectRow } from "./db";
import { loadFloor, ompSessions } from "./floor";
import { projectOf } from "./office";
import { mergedSessions } from "./proc";

type RoomRow = { name: string; cwd: string | null; status: string };

/** Projects with a live room, keyed like the office (git root, else the session's cwd). */
export function liveProjects(sessions: RoomRow[], projectOf: (cwd: string | null) => ProjectInfo | null): ProjectInfo[] {
  const rooms = sessions
    .filter((s) => s.status !== "ended" && s.cwd)
    .map((s) => ({ key: s.name, cwd: s.cwd, project: projectOf(s.cwd) }));
  return groupByProject(rooms).map((g) => g.project);
}

/**
 * The roots of rooms that ended (git root, else the cwd): a finished room's results still name its files.
 * A drive or file-system root and the home folder or one above it are left out: an ended room run there
 * would open the whole disk to the viewer. A cwd that is not absolute on this OS (`C:\` on Linux) is no
 * folder here: resolving it against the server's own cwd would make one up.
 */
export function endedRoots(sessions: RoomRow[], projectOf: (cwd: string | null) => ProjectInfo | null, home = os.homedir()): string[] {
  const out = new Map<string, string>();
  for (const s of sessions) {
    if (s.status !== "ended" || !s.cwd || !path.isAbsolute(s.cwd)) continue;
    const root = path.resolve(projectOf(s.cwd)?.root ?? s.cwd);
    if (path.parse(root).root === root || inside(home, root)) continue;
    out.set(root.toLowerCase(), root);
  }
  return [...out.values()];
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

/** Every room HQ lists (Claude Code and omp, as the office counts them), ended ones included. */
async function allRooms(db: DatabaseSync): Promise<RoomRow[]> {
  const [merged, floor] = await Promise.all([mergedSessions(db).catch(() => []), loadFloor(db)]);
  return [...merged, ...ompSessions(db, floor)];
}

/** Projects with a live room, one per root. */
export async function projectsInView(db: DatabaseSync): Promise<ProjectInfo[]> {
  return liveProjects(await allRooms(db), (cwd) => projectOf(cwd));
}

/**
 * Every root HQ shows or the owner added in the sidebar, each in its own spelling. `ended`: also the
 * roots of rooms that ended (endedRoots), for the file viewer that opens what a past result names.
 */
export async function knownRoots(db: DatabaseSync, { ended = false }: { ended?: boolean } = {}): Promise<string[]> {
  const added = withMissing(db.prepare("SELECT id, path, name, added_at FROM projects").all() as ProjectRow[])
    .filter((p) => !p.missing)
    .map((p) => p.path);
  const rooms = await allRooms(db);
  const live = liveProjects(rooms, (cwd) => projectOf(cwd)).map((p) => p.root);
  return [...live, ...(ended ? endedRoots(rooms, (cwd) => projectOf(cwd)) : []), ...added];
}
