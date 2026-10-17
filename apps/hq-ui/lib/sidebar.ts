// The sidebar's room list: every live room under its repo, worktrees (`<repo>/.claude/worktrees/<x>`)
// folded under the repo they belong to, attention first. Pure, no I/O. Tested in tests/sidebar.test.ts.
import { roomNow, type BoardRef, type NowRoom, type NowState, type RoomNow } from "./now";
import type { ProjectInfo } from "./office";

/** Short state words for a narrow row (NOW_LABEL's "holding" is a sentence). */
export const SIDEBAR_WORD: Record<NowState, string> = {
  needs: "Chờ anh",
  blocked: "Kẹt",
  working: "Đang làm",
  holding: "Giữ card",
  waiting: "Chờ card",
  idle: "Rảnh",
};

const WT = /^(.*?)[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)[/\\]?$/i;

/** The repo a folder belongs to: a Claude Code worktree folds under its repo; anything else is itself. */
export function repoOf(root: string): { root: string; name: string; worktree: string | null } {
  const m = WT.exec(root);
  const base = (p: string) => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;
  return m ? { root: m[1], name: base(m[1]), worktree: m[2] } : { root, name: base(root), worktree: null };
}

export type SidebarRoom<T> = { room: T; now: RoomNow; worktree: string | null; branch: string | null };
export type SidebarGroup<T> = { key: string; name: string; root: string; needs: number; rooms: SidebarRoom<T>[] };

const ORDER: Record<NowState, number> = { needs: 0, blocked: 1, working: 2, holding: 3, waiting: 4, idle: 5 };
const keyOf = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Live rooms by repo. Inside a group: the repo's own rooms before worktree rooms, then attention order.
 * Groups that wait on the owner come first, then by name. Rooms without a git root group by cwd.
 */
export function sidebarGroups<T extends NowRoom & { key: string; project: ProjectInfo | null }>(
  rooms: T[],
  boards: BoardRef[],
  now: number,
): SidebarGroup<T>[] {
  const map = new Map<string, SidebarGroup<T>>();
  for (const r of rooms) {
    if (r.status === "ended") continue;
    const at = r.project?.root ?? r.cwd;
    const repo = at ? repoOf(at) : { root: "", name: "Không rõ thư mục", worktree: null };
    const key = keyOf(repo.root) || "~other";
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, name: repo.name, root: repo.root, needs: 0, rooms: [] }));
    const n = roomNow(r, boards, now);
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

