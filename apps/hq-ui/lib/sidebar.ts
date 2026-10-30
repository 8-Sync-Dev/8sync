// The sidebar's room list: every live room under its repo, worktrees (`<repo>/.claude/worktrees/<x>`)
// folded under the repo they belong to, attention first. Pure, no I/O. Tested in tests/sidebar.test.ts.
import { roomNow, type NowRoom, type NowState, type RoomNow } from "./now";
import { groupByProject, type ProjectInfo } from "./office";

/** Short state words for a narrow row. */
export const SIDEBAR_WORD: Record<NowState, string> = {
  needs: "Chờ anh",
  working: "Đang làm",
  idle: "Rảnh",
};

const WT = /^(.*?)[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)[/\\]?$/i;

/** The repo a folder belongs to: a Claude Code worktree folds under its repo; anything else is itself. */
export function repoOf(root: string): { root: string; name: string; worktree: string | null } {
  const m = WT.exec(root);
  const base = (p: string) => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;
  return m ? { root: m[1], name: base(m[1]), worktree: m[2] } : { root, name: base(root), worktree: null };
}

/**
 * Rooms by repo for the office and Tổng quan: a room in `<repo>/.claude/worktrees/<x>` goes under
 * `<repo>` (one header), keeping its own `project` (branch) on
 * the room. The group's branch is the repo room's own, when one runs there.
 */
export function groupByRepo<T extends { key: string; project: ProjectInfo | null; cwd: string | null }>(rooms: T[]): { project: ProjectInfo; rooms: T[] }[] {
  const byKey = new Map(rooms.map((r) => [r.key, r]));
  const folded = rooms.map((r) => {
    if (!r.project) return r;
    const repo = repoOf(r.project.root);
    if (!repo.worktree) return r;
    const main = rooms.find((x) => x.project && groupKey(x.project.root) === groupKey(repo.root));
    return { ...r, project: { root: main?.project?.root ?? repo.root, name: main?.project?.name ?? repo.name, branch: main?.project?.branch ?? null } };
  });
  return groupByProject(folded).map((g) => ({ project: g.project, rooms: g.rooms.map((r) => byKey.get(r.key)!) }));
}

/** The worktree a room runs in (`fix-login`), null for a room in the repo itself. */
export const worktreeOf = (r: { project: ProjectInfo | null }): string | null => (r.project ? repoOf(r.project.root).worktree : null);

export type SidebarRoom<T> = { room: T; now: RoomNow; worktree: string | null; branch: string | null };
export type SidebarGroup<T> = { key: string; name: string; root: string; needs: number; rooms: SidebarRoom<T>[] };

const ORDER: Record<NowState, number> = { needs: 0, working: 1, idle: 2 };
/** The key a sidebar group (and a closed project) goes by: forward slashes, no `\\?\` prefix, no trailing slash, lower case. */
export const groupKey = (p: string) => p.replace(/\\/g, "/").replace(/^\/\/\?\//, "").replace(/\/+$/, "").toLowerCase();

/**
 * Live rooms by repo. Inside a group: the repo's own rooms before worktree rooms, then attention order.
 * Groups that wait on the owner come first, then by name. Rooms without a git root group by cwd.
 */
export function sidebarGroups<T extends NowRoom & { key: string; project: ProjectInfo | null }>(
  rooms: T[],
  now: number,
): SidebarGroup<T>[] {
  const map = new Map<string, SidebarGroup<T>>();
  for (const r of rooms) {
    if (r.status === "ended") continue;
    const at = r.project?.root ?? r.cwd;
    const repo = at ? repoOf(at) : { root: "", name: "Không rõ thư mục", worktree: null };
    const key = groupKey(repo.root) || "~other";
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, name: repo.name, root: repo.root, needs: 0, rooms: [] }));
    const n = roomNow(r, now);
    if (n.state === "needs") g.needs++;
    g.rooms.push({ room: r, now: n, worktree: repo.worktree, branch: r.project?.branch ?? null });
  }
  for (const g of map.values()) {
    g.rooms.sort(
      (a, b) =>
        Number(a.worktree != null) - Number(b.worktree != null) ||
        (a.worktree ?? "").localeCompare(b.worktree ?? "") ||
        ORDER[a.now.state] - ORDER[b.now.state] ||
        a.now.label.localeCompare(b.now.label),
    );
  }
  return [...map.values()].sort(
    (a, b) => Number(b.needs > 0) - Number(a.needs > 0) || Number(a.key === "~other") - Number(b.key === "~other") || a.name.localeCompare(b.name),
  );
}

/** A project the owner closed in the sidebar (HQ state: lib/server/db.ts `hidden_projects`). */
export type HiddenProject = { key: string; root: string; name: string; hidden_at: number };

/**
 * Shown and closed groups. A closed project comes back by itself on new activity: a room that waits
 * on the owner, or anything a room did after it was closed.
 */
export function splitClosed<T extends { last_active?: number | null }>(
  groups: SidebarGroup<T>[],
  hidden: HiddenProject[],
): { shown: SidebarGroup<T>[]; closed: SidebarGroup<T>[] } {
  const at = new Map(hidden.map((h) => [h.key, h.hidden_at]));
  const shown: SidebarGroup<T>[] = [];
  const closed: SidebarGroup<T>[] = [];
  for (const g of groups) {
    const since = at.get(g.key);
    const active = g.rooms.reduce((m, x) => Math.max(m, x.room.last_active ?? 0, x.now.last?.at ?? 0), 0);
    const back = since == null || g.rooms.some((x) => x.now.state === "needs") || active > since;
    (back ? shown : closed).push(g);
  }
  return { shown, closed };
}
