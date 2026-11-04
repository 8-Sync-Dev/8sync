// The sidebar's session tree (owner 2026-11-02: "theo cấu trúc Claude Code Desktop"): project folder →
// session → sub-session. HQ rooms (ccc/omp) and every omp session of a folder are one row type; omp `task`
// subagents (and a Claude Code room's running agents) nest under their session. Grouping, sorting, the
// local archive and the prefs live here, pure. Tested in tests/session-tree.test.ts.
import type { FloorState } from "./floor";
import { isOmpSessionName } from "./omp-workspace";
import { groupKey, repoOf } from "./sidebar";

/** One state vocabulary for sessions and sub-sessions (words, never colour alone). */
export type TreeState = "needs" | "working" | "done" | "error" | "idle";
export const TREE_STATES: TreeState[] = ["needs", "working", "done", "error", "idle"];
export const TREE_WORD: Record<TreeState, string> = { needs: "Chờ anh", working: "Đang làm", done: "Xong", error: "Lỗi", idle: "Nghỉ" };

/** An `8sync ls` desk state as a tree state: kẹt is an error the owner has to look at. */
export function treeStateOfFloor(s: FloorState | string | null | undefined): TreeState {
  if (s === "waiting") return "needs";
  if (s === "stalled") return "error";
  if (s === "done") return "done";
  if (s === "typing" || s === "running" || s === "reading" || s === "meeting") return "working";
  return "idle";
}

export type TreeChild = { key: string; title: string; state: TreeState; /** ms */ at: number | null; detail: string | null };

/** One omp session as `GET /api/omp/sessions?all=1` returns it (docs/hq-ui-contract.md). */
export type OmpTreeRow = {
  id: string;
  name: string;
  title: string | null;
  /** The session's folder (a registry key already resolved), null when unknown. */
  cwd: string | null;
  state: TreeState;
  doing: string | null;
  /** ms */
  last_active: number | null;
  /** ms */
  created: number | null;
  children: TreeChild[];
};

/** The office room fields the tree reads. */
export type TreeRoomIn = {
  key: string;
  name: string;
  session_id: string | null;
  label: string;
  status: "running" | "idle" | "needs_input" | "ended";
  waiting: string | null;
  cwd: string | null;
  project: { root: string; name: string } | null;
  state: string | null;
  doing: string | null;
  last_active: number | null;
  /** "omp" or the Claude Code engine (anything else). */
  engine: string;
  seats: { key: string; active: string[] }[];
};

export type TreeSession = {
  /** Stable across polls: the omp room id, or the office room key. */
  key: string;
  kind: "omp" | "ccc";
  title: string;
  /** omp session name / room name (the tooltip). */
  name: string;
  /** The project group: the repo root (a worktree folds under its repo), else the folder; null = unknown. */
  root: string | null;
  folder: string;
  worktree: string | null;
  state: TreeState;
  /** Last activity, ms. */
  at: number | null;
  /** ms; falls back to `at` for sorting when unknown. */
  created: number | null;
  doing: string | null;
  /** Openable as a Không gian pane (omp only). */
  ompId: string | null;
  cwd: string | null;
  /** The office room key (chat), when the session is a live room. */
  room: string | null;
  children: TreeChild[];
};

const NO_FOLDER = "Không rõ thư mục";

function placeOf(dir: string | null): { root: string | null; folder: string; worktree: string | null } {
  if (!dir) return { root: null, folder: NO_FOLDER, worktree: null };
  const r = repoOf(dir);
  return { root: r.root, folder: r.name || r.root, worktree: r.worktree };
}

function roomState(r: TreeRoomIn): TreeState {
  if (r.status === "needs_input" || r.waiting) return "needs";
  const s = treeStateOfFloor(r.state);
  if (s !== "idle") return s;
  return r.status === "running" ? "working" : "idle";
}

/**
 * Live office rooms plus every omp session: an omp room shows once (the omp row, with the room's
 * "chờ anh" and key); a Claude Code room's running agents become its sub-sessions.
 */
export function mergeSessions(rooms: TreeRoomIn[], omp: OmpTreeRow[]): TreeSession[] {
  const byOmp = new Map<string, TreeRoomIn>();
  const out: TreeSession[] = [];
  for (const r of rooms) {
    if (r.status === "ended") continue;
    if (r.engine === "omp" && r.session_id && omp.some((o) => o.id === r.session_id)) {
      byOmp.set(r.session_id, r);
      continue;
    }
    const dir = r.project?.root ?? r.cwd;
    out.push({
      key: r.key,
      kind: r.engine === "omp" ? "omp" : "ccc",
      title: r.label || r.name,
      name: r.name,
      ...placeOf(dir),
      state: roomState(r),
      at: r.last_active,
      created: null,
      doing: r.doing,
      ompId: r.engine === "omp" && r.session_id ? r.session_id : null,
      cwd: r.cwd,
      room: r.key,
      children: r.seats.flatMap((s) =>
        s.key === "lead" ? [] : s.active.map((a, i): TreeChild => ({ key: `${r.key}/${s.key}/${i}`, title: a, state: "working", at: r.last_active, detail: null })),
      ),
    });
  }
  for (const o of omp) {
    const room = byOmp.get(o.id) ?? null;
    const own = room ? roomState(room) : null;
    out.push({
      key: o.id,
      kind: "omp",
      title: o.title?.trim() || o.name,
      name: o.name,
      ...placeOf(o.cwd),
      state: own === "needs" ? "needs" : o.state,
      at: Math.max(o.last_active ?? 0, room?.last_active ?? 0) || null,
      created: o.created,
      doing: o.doing ?? room?.doing ?? null,
      ompId: o.id,
      cwd: o.cwd,
      room: room?.key ?? null,
      children: o.children,
    });
  }
  return out;
}

// ── group & sort ─────────────────────────────────────────────────────────────

export type GroupBy = "project" | "state" | "none";
export type SortBy = "manual" | "recent" | "created" | "name";
export const GROUP_WORD: Record<GroupBy, string> = { project: "Dự án", state: "Trạng thái", none: "Không nhóm" };
export const SORT_WORD: Record<SortBy, string> = { manual: "Tự sắp (kéo thả)", recent: "Gần đây", created: "Ngày tạo", name: "Tên" };

export type TreeGroup = { key: string; label: string; root: string | null; sessions: TreeSession[] };

const byName = (a: string, b: string) => a.localeCompare(b, "vi", { sensitivity: "base", numeric: true });

/**
 * The owner's drag-and-drop order (this browser): session keys and group keys, earlier = higher.
 * Only a drop changes it; activity never moves a row (owner 2026-11-04: "chỉ có thể drag drop").
 */
export type TreeOrder = { sessions: string[]; groups: string[] };
export const NO_ORDER: TreeOrder = { sessions: [], groups: [] };

/**
 * `items` in the saved order. Ones not placed yet (a new session or project) come first, ordered by
 * `fresh` (which must not read activity): they show up on top, then stay until the owner drags them.
 */
export function inOrder<T>(items: T[], keyOf: (x: T) => string, fresh: (a: T, b: T) => number, saved: readonly string[]): T[] {
  const at = new Map(saved.map((k, i) => [k, i]));
  const pos = (x: T) => at.get(keyOf(x));
  const unplaced = items.filter((x) => pos(x) === undefined).sort((a, b) => fresh(a, b) || keyOf(a).localeCompare(keyOf(b)));
  const placed = items.filter((x) => pos(x) !== undefined).sort((a, b) => pos(a)! - pos(b)!);
  return [...unplaced, ...placed];
}

const createdOf = (s: TreeSession) => s.created ?? s.at ?? 0;

export function sortSessions(list: TreeSession[], sort: SortBy, order: TreeOrder = NO_ORDER): TreeSession[] {
  // Newest created first; never `at` (it moves with every turn).
  if (sort === "manual") return inOrder(list, (s) => s.key, (a, b) => (b.created ?? 0) - (a.created ?? 0), order.sessions);
  const when = (s: TreeSession) => (sort === "created" ? createdOf(s) : (s.at ?? 0));
  return [...list].sort((a, b) => (sort === "name" ? byName(a.title, b.title) : when(b) - when(a)) || byName(a.title, b.title));
}

/** Groups in the saved order (manual sort; ones not placed yet by name), the "Không rõ thư mục" group last. */
export function orderGroups(groups: TreeGroup[], order: TreeOrder): TreeGroup[] {
  return inOrder(groups, (g) => g.key, (a, b) => byName(a.label, b.label), order.groups).sort((a, b) => Number(!a.root) - Number(!b.root));
}

/**
 * The order after dragging key `from` onto key `to` (it takes `to`'s place) inside `shown` (the
 * list as it is on screen now, which becomes the saved order: `from` === `to` just pins it). Keys
 * saved before that are not on screen (archived, filtered) keep their order after the shown ones.
 * A key not on screen: no change.
 */
export function moveKey(saved: readonly string[], shown: readonly string[], from: string, to: string): string[] {
  const i = shown.indexOf(from);
  const j = shown.indexOf(to);
  if (i < 0 || j < 0) return [...saved];
  const next = shown.filter((k) => k !== from);
  next.splice(j, 0, from);
  const on = new Set(shown);
  return [...next, ...saved.filter((k) => !on.has(k))];
}

/**
 * Groups in display order. By project: the group with the newest activity first (by name when sorting
 * by name); by state: Chờ anh, Đang làm, Xong, Lỗi, Nghỉ (empty states skipped); none: one group.
 */
export function groupSessions(list: TreeSession[], by: GroupBy, sort: SortBy, order: TreeOrder = NO_ORDER): TreeGroup[] {
  if (by === "none") return list.length ? [{ key: "all", label: "Phiên", root: null, sessions: sortSessions(list, sort, order) }] : [];
  if (by === "state") {
    return TREE_STATES.flatMap((st) => {
      const xs = list.filter((s) => s.state === st);
      return xs.length ? [{ key: `state:${st}`, label: TREE_WORD[st], root: null, sessions: sortSessions(xs, sort, order) }] : [];
    });
  }
  const groups = new Map<string, TreeGroup>();
  for (const s of list) {
    const key = s.root ? groupKey(s.root) : "";
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key: key || "none", label: s.folder, root: s.root, sessions: [] }));
    g.sessions.push(s);
  }
  const sorted = [...groups.values()].map((g) => ({ ...g, sessions: sortSessions(g.sessions, sort, order) }));
  if (sort === "manual") return orderGroups(sorted, order);
  const newest = (g: TreeGroup) => Math.max(0, ...g.sessions.map((s) => (sort === "created" ? createdOf(s) : (s.at ?? 0))));
  return sorted
    .sort((a, b) => Number(!a.root) - Number(!b.root) || (sort === "name" ? byName(a.label, b.label) : newest(b) - newest(a)) || byName(a.label, b.label));
}

// ── sub-sessions ─────────────────────────────────────────────────────────────

/** Sub-sessions shown without asking: running ones and those active within this window. */
export const CHILD_RECENT_MS = 30 * 60_000;

/**
 * Running and recent sub-sessions and the older rest ("+N cũ hơn"), both in a fixed order (by name, then
 * key): a sub-session that starts or finishes never moves past its siblings (owner 2026-11-04: nothing
 * in the sidebar jumps). Only which list it sits in follows its state and time.
 */
export function splitChildren(children: TreeChild[], now: number, recentMs = CHILD_RECENT_MS): { shown: TreeChild[]; older: TreeChild[] } {
  const sorted = [...children].sort((a, b) => byName(a.title, b.title) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const shown: TreeChild[] = [];
  const older: TreeChild[] = [];
  for (const c of sorted) (c.state === "working" || c.state === "needs" || (c.at != null && now - c.at <= recentMs) ? shown : older).push(c);
  return { shown, older };
}

// ── attention ────────────────────────────────────────────────────────────────

/**
 * Sessions that stopped working since the last poll (`prev`: key → state then): they get the blue
 * "xong, chưa xem" dot until the owner opens them. A session first seen now never counts.
 */
export function finishedSince(prev: Record<string, TreeState>, list: Pick<TreeSession, "key" | "state">[]): string[] {
  return list.filter((s) => prev[s.key] === "working" && (s.state === "done" || s.state === "idle")).map((s) => s.key);
}

/** The blue dot: it waits on the owner, or it finished while the owner was elsewhere. */
export const isUnread = (s: Pick<TreeSession, "key" | "state">, unread: readonly string[]): boolean => s.state === "needs" || (s.state !== "working" && unread.includes(s.key));

/** Ctrl+Tab / Ctrl+Shift+Tab: the next (or previous) key after `cur`, wrapping; the first when `cur` is not in the list. */
export function cycleKey(keys: string[], cur: string | null, dir: 1 | -1): string | null {
  if (keys.length === 0) return null;
  const i = cur ? keys.indexOf(cur) : -1;
  if (i < 0) return dir === 1 ? keys[0] : keys[keys.length - 1];
  return keys[(i + dir + keys.length) % keys.length];
}

// ── local prefs (localStorage is user-editable: keep only what is well formed) ──

export type TreePrefs = { group: GroupBy; sort: SortBy; collapsed: string[] };
export const DEFAULT_PREFS: TreePrefs = { group: "project", sort: "manual", collapsed: [] };

const strings = (x: unknown, max: number): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 300).slice(0, max) : []);

export function readPrefs(raw: string | null): TreePrefs {
  try {
    const v = JSON.parse(raw ?? "null") as (Partial<Record<keyof TreePrefs, unknown>> & { v?: unknown }) | null;
    if (!v || typeof v !== "object") return DEFAULT_PREFS;
    const group = v.group === "state" || v.group === "none" || v.group === "project" ? v.group : DEFAULT_PREFS.group;
    // Before `v: 2` "recent" was only the default (any fold saved it): those browsers start on manual.
    const sort = v.sort === "created" || v.sort === "name" || v.sort === "manual" || (v.sort === "recent" && v.v === 2) ? v.sort : DEFAULT_PREFS.sort;
    return { group, sort, collapsed: strings(v.collapsed, 500) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function readOrder(raw: string | null): TreeOrder {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Record<keyof TreeOrder, unknown>> | null;
    if (!v || typeof v !== "object") return NO_ORDER;
    return { sessions: strings(v.sessions, 3000), groups: strings(v.groups, 500) };
  } catch {
    return NO_ORDER;
  }
}

/** The archive ("Đã lưu trữ"): session keys the owner put away on this browser. Nothing on disk changes. */
export function readArchive(raw: string | null): string[] {
  try {
    return strings(JSON.parse(raw ?? "null"), 2000);
  } catch {
    return [];
  }
}

export const toggle = (list: string[], key: string): string[] => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

// ── new session from a prompt ────────────────────────────────────────────────

/**
 * A session name from what the owner typed: the first words without diacritics ("Sửa lỗi đăng nhập" →
 * `sua-loi-dang-nhap`), at most 32 chars, made unique against `taken` with -2, -3…; "phien" when nothing is left.
 */
export function sessionNameFrom(text: string, taken: string[]): string {
  const base =
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 5)
      .join("-")
      .slice(0, 32)
      .replace(/-+$/, "") || "phien";
  const safe = isOmpSessionName(base) ? base : `phien-${base}`.slice(0, 32).replace(/-+$/, "");
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(safe)) return safe;
  for (let n = 2; ; n++) {
    const next = `${safe.slice(0, 28)}-${n}`;
    if (!used.has(next)) return next;
  }
}

/** Sessions per state, for the compact Tổng quan board. */
export function byState(list: TreeSession[]): Record<TreeState, TreeSession[]> {
  const out = { needs: [], working: [], done: [], error: [], idle: [] } as Record<TreeState, TreeSession[]>;
  for (const s of sortSessions(list, "recent")) out[s.state].push(s);
  return out;
}
