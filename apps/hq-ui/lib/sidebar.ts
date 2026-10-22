// The sidebar's room list: every live room under its repo, worktrees (`<repo>/.claude/worktrees/<x>`)
// folded under the repo they belong to, attention first. Pure, no I/O. Tested in tests/sidebar.test.ts.
import { claimMatches, roomNow, type BoardRef, type NowRoom, type NowState, type RoomNow } from "./now";
import { LANES } from "./lanes";
import { groupByProject, type ProjectInfo } from "./office";

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

/**
 * Rooms by repo for the office and Tổng quan: a room in `<repo>/.claude/worktrees/<x>` goes under
 * `<repo>` (one header, one set of team buttons, one meeting), keeping its own `project` (branch) on
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

/** The worktree a room runs in (`card-14-bakeoff`), null for a room in the repo itself. */
export const worktreeOf = (r: { project: ProjectInfo | null }): string | null => (r.project ? repoOf(r.project.root).worktree : null);

/** The meeting room needs someone to meet: two or more rooms of the same repo. */
export const meetingShown = (roomsInRepo: number): boolean => roomsInRepo >= 2;

export type SidebarRoom<T> = { room: T; now: RoomNow; worktree: string | null; branch: string | null };
export type SidebarGroup<T> = { key: string; name: string; root: string; needs: number; rooms: SidebarRoom<T>[] };

const ORDER: Record<NowState, number> = { needs: 0, blocked: 1, working: 2, holding: 3, waiting: 4, idle: 5 };
/** The key a sidebar group (and a closed project) goes by: forward slashes, no `\\?\` prefix, no trailing slash, lower case. */
export const groupKey = (p: string) => p.replace(/\\/g, "/").replace(/^\/\/\?\//, "").replace(/\/+$/, "").toLowerCase();

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
    const key = groupKey(repo.root) || "~other";
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

/** A project the owner closed in the sidebar (HQ state: lib/server/db.ts `hidden_projects`). */
export type HiddenProject = { key: string; root: string; name: string; hidden_at: number };

/**
 * Shown and closed groups. A closed project comes back by itself on new activity: a room that waits
 * on the owner or is stuck, or anything a room did after it was closed.
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
    const back = since == null || g.rooms.some((x) => x.now.state === "needs" || x.now.state === "blocked") || active > since;
    (back ? shown : closed).push(g);
  }
  return { shown, closed };
}

/** A project the owner pinned (`8sync ccc auto pin`, HQ's pin button); `at` = unix seconds. */
export type Pin = { root: string; at: number };

/** `pinned-roots.json` (`{ "<root>": <at> }`) → pins, oldest first; anything else → none. */
export function parsePins(v: unknown): Pin[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v)
    .filter(([root, at]) => root.length > 0 && root.length <= 4096 && typeof at === "number" && Number.isFinite(at))
    .map(([root, at]) => ({ root, at: at as number }))
    .sort((a, b) => a.at - b.at || a.root.localeCompare(b.root));
}

/** One pinned project in the sidebar: its live group, else its added folder, else just the root (0 rooms). */
export type PinnedEntry<T, F> = { key: string; root: string; name: string; group: SidebarGroup<T> | null; folder: F | null };

/**
 * Pinned projects first, under their own header, in pin order: each takes its live group (closed or
 * not: a pinned project stays visible) or its added folder, or stands alone with 0 rooms. The rest
 * keep their order; `closed` loses the pinned ones too.
 */
export function pinSidebar<T, F extends { path: string; name: string }>(
  pins: Pin[],
  shown: SidebarGroup<T>[],
  closed: SidebarGroup<T>[],
  folders: F[],
): { pinned: PinnedEntry<T, F>[]; shown: SidebarGroup<T>[]; closed: SidebarGroup<T>[]; folders: F[] } {
  const keys = new Set<string>();
  const pinned: PinnedEntry<T, F>[] = [];
  for (const p of pins) {
    const key = groupKey(p.root);
    if (!key || keys.has(key)) continue;
    keys.add(key);
    const group = shown.find((g) => g.key === key) ?? closed.find((g) => g.key === key) ?? null;
    const folder = folders.find((f) => groupKey(f.path) === key) ?? null;
    pinned.push({ key, root: group?.root ?? folder?.path ?? p.root, name: group?.name ?? folder?.name ?? repoOf(p.root).name, group, folder });
  }
  return {
    pinned,
    shown: shown.filter((g) => !keys.has(g.key)),
    closed: closed.filter((g) => !keys.has(g.key)),
    folders: folders.filter((f) => !keys.has(groupKey(f.path))),
  };
}


/**
 * The sidebar's projects heading. Company mode (`auto company on`, owner 2026-10-22: "1 cty rooms/roles agent
 * nhận nhiều dự án"): one team serves every listed project, so the heading says so instead of "Dự án".
 */
export function projectsHeading(company: boolean, projects: number): { title: string; hint: string | null } {
  if (!company) return { title: "Dự án", hint: null };
  return { title: `Công ty · ${projects} dự án`, hint: "Một team làm mọi dự án: phòng hết card ở dự án mình thì lấy card gấp nhất ở dự án khác (8sync ccc auto company on|off)." };
}

/** A company room: where it works now (the project of the card it holds, else its home repo). */
export type CompanyRoom<T> = SidebarRoom<T> & { at: { key: string; root: string; name: string } };
/** A project the company serves: rooms holding a card there now, open cards on its board, rooms waiting on the owner there. */
export type CompanyProject = { key: string; root: string; name: string; people: number; open: number; needs: number };

/**
 * The sidebar in company mode (owner 2026-10-22: "1 cty cân all dự án … không phải mỗi dự án là mở full
 * rooms"): ONE list of rooms, each tagged with the project it works on now, and ONE list of projects,
 * each with how many rooms work there (a project with one person on it shows 1). A room working on another
 * project's card is found by its claim on that board: company mode has one team, so a label is unique.
 * Pure; tested in tests/sidebar.test.ts.
 */
export function companySidebar<T extends NowRoom & { key: string; project: ProjectInfo | null }>(
  rooms: T[],
  boards: BoardRef[],
  now: number,
): { rooms: CompanyRoom<T>[]; projects: CompanyProject[] } {
  const projects = new Map<string, CompanyProject>();
  const project = (at: string) => {
    const repo = repoOf(at);
    const key = groupKey(repo.root) || "~other";
    let p = projects.get(key);
    if (!p) projects.set(key, (p = { key, root: repo.root, name: repo.name || "Không rõ thư mục", people: 0, open: 0, needs: 0 }));
    return p;
  };
  for (const b of boards) {
    const p = project(b.root);
    if (b.board) p.open += LANES.reduce((n, l) => n + b.board!.lanes[l.key].length, 0);
  }
  const out: CompanyRoom<T>[] = [];
  for (const r of rooms) {
    if (r.status === "ended") continue;
    const held = heldRoot(r, boards);
    const home = r.project?.root ?? r.cwd ?? "";
    const n = roomNow(held ? { ...r, cwd: held.root } : r, boards, now);
    const p = project(held?.root ?? home);
    if (held) p.people++;
    if (n.state === "needs") p.needs++;
    out.push({ room: r, now: n, worktree: home ? repoOf(home).worktree : null, branch: r.project?.branch ?? null, at: { key: p.key, root: p.root, name: p.name } });
  }
  out.sort((a, b) => ORDER[a.now.state] - ORDER[b.now.state] || a.now.label.localeCompare(b.now.label));
  const list = [...projects.values()].sort(
    (a, b) => Number(b.needs > 0) - Number(a.needs > 0) || b.people - a.people || Number(a.key === "~other") - Number(b.key === "~other") || a.name.localeCompare(b.name),
  );
  return { rooms: out, projects: list };
}

/** "1 người", "chưa ai": how many company rooms work on a project now. */
export const peopleWord = (n: number): string => (n === 0 ? "chưa ai" : `${n} người`);

/** The board root where this room holds its newest card, any project; null = it holds none. */
export function heldRoot(r: { label: string; name: string }, boards: BoardRef[]): { root: string; at: number } | null {
  let held: { root: string; at: number } | null = null;
  for (const b of boards) {
    if (!b.board) continue;
    for (const l of LANES)
      for (const c of b.board.lanes[l.key])
        if (c.claim && claimMatches(c.claim.room, r.label, r.name) && (!held || c.claim.at > held.at)) held = { root: b.root, at: c.claim.at };
  }
  return held;
}

/**
 * Company mode for Văn phòng and Tổng quan (owner 2026-10-22: one company, many projects): a room that
 * holds a card on another project's board is shown at that project (its `project` and `cwd` become that
 * board's root), so every project block holds the rooms working on it now, and the roster finds the card.
 * Rooms with no card, or with a card in their own repo, stay as they are. Pure.
 */
export function companyRooms<T extends { label: string; name: string; cwd: string | null; project: ProjectInfo | null }>(rooms: T[], boards: BoardRef[]): T[] {
  return rooms.map((r) => {
    const held = heldRoot(r, boards);
    if (!held) return r;
    const home = r.project?.root ?? r.cwd ?? "";
    if (home && groupKey(repoOf(home).root) === groupKey(repoOf(held.root).root)) return r;
    return { ...r, cwd: held.root, project: { root: held.root, name: repoOf(held.root).name, branch: null } };
  });
}
