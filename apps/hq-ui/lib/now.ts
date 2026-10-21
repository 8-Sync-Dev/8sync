// "Đang làm gì": what every room is doing right now, from data HQ already has (the office rooms of
// `8sync ls` + `claude agents`, and the board of `8sync ccc auto board --json`). Pure, no I/O.
// Tested in tests/now.test.ts.
import { LANES, claimStale, type Board, type Card, type LaneKey } from "./lanes";
import type { SeatKey } from "./office";
import type { RoleId } from "./roles";

/** needs: Claude waits for the owner · blocked: a quiet room whose card is in Blocked, or any room whose claim went stale ·
 * working: the session is running · holding: idle between loop ticks with a card in hand ·
 * waiting: an auto room with nothing to claim (`auto wait`) · idle: any other quiet room. */
export const NOW_STATES = ["needs", "blocked", "working", "holding", "waiting", "idle"] as const;
export type NowState = (typeof NOW_STATES)[number];

export const NOW_LABEL: Record<NowState, string> = {
  needs: "Chờ anh",
  blocked: "Kẹt",
  working: "Đang làm",
  holding: "Giữ card, nghỉ giữa vòng",
  waiting: "Chờ card",
  idle: "Rảnh",
};

/** A quiet room counts as "idle too long" (highlighted) after this. */
export const IDLE_FLAG_MS = 60_000;

/**
 * The role a room name stands for, mirroring crates/cli/src/verbs/ccc/room.rs `find` (first name
 * token; trailing digits dropped, so `dev2` is a second builder; keys of ≥4 chars match as a prefix).
 * `role` feeds RoleIcon (lib/roles ids), `seat` the desk props of its sprite.
 */
const ROOM_ROLES: { keys: string[]; role: RoleId; seat: SeatKey; lane: LaneKey | null }[] = [
  { keys: ["pm", "lead", "plan", "boss", "main", "ba", "analyst", "spec", "req", "po"], role: "plan", seat: "lead", lane: "backlog" },
  { keys: ["arch", "architect", "architecture", "sa", "solution"], role: "architect", seat: "rd", lane: null },
  { keys: ["rd", "r&d", "rnd", "research", "explore"], role: "rd", seat: "rd", lane: null },
  { keys: ["dev", "build", "builder", "code", "coder", "impl", "ui", "ux", "fe", "frontend", "web", "design", "hq", "api", "be", "backend", "server", "encore", "db", "core", "cli", "rust", "crate", "kit", "ccc"], role: "fullstack", seat: "dev", lane: "ready" },
  { keys: ["qa", "qc", "test", "tester", "e2e", "uat"], role: "tester", seat: "qa", lane: "qa" },
  { keys: ["review", "reviewer", "critic"], role: "reviewer", seat: "review", lane: "review" },
];

export function roomRole(name: string | null | undefined): { role: RoleId; seat: SeatKey; lane: LaneKey | null } | null {
  for (const raw of (name ?? "").toLowerCase().split(/[^\p{L}\p{N}&]+/u)) {
    const tok = raw.replace(/\d+$/, "");
    if (!tok) continue;
    const row = ROOM_ROLES.find((r) => r.keys.some((k) => tok === k || (k.length >= 4 && tok.startsWith(k))));
    if (row) return { role: row.role, seat: row.seat, lane: row.lane };
  }
  return null;
}

/** A claim names the room by its registry name; `auto up` titles a clashing room `<name>-<repo>`. */
export function claimMatches(claimRoom: string, ...names: (string | null | undefined)[]): boolean {
  const c = claimRoom.trim().toLowerCase();
  if (!c) return false;
  return names.some((n) => {
    const v = (n ?? "").trim().toLowerCase();
    return v === c || v.startsWith(`${c}-`);
  });
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export type BoardRef = { root: string; board: Board | null };

/** Boards whose root contains the room's cwd (two repos may both have a `dev`). */
function boardsNear(cwd: string | null, boards: BoardRef[]): BoardRef[] {
  const c = cwd ? norm(cwd) : null;
  return c ? boards.filter((b) => c === norm(b.root) || c.startsWith(`${norm(b.root)}/`)) : [];
}

/** The card this room holds: boards whose root contains the room's cwd first (two repos may both have a `dev`). */
export function heldCard(room: { label: string; name: string; cwd: string | null }, boards: BoardRef[]): Card | null {
  const near = boardsNear(room.cwd, boards);
  for (const b of near.length ? near : boards) {
    if (!b.board) continue;
    const mine = LANES.flatMap((l) => b.board!.lanes[l.key]).filter((c) => c.claim && claimMatches(c.claim.room, room.label, room.name));
    if (mine.length) return mine.sort((a, z) => z.claim!.at - a.claim!.at)[0];
  }
  return null;
}

/** A move note into one of these lanes is the room handing its card on: its task is done. */
const HANDED_ON: readonly LaneKey[] = ["qa", "review", "approved"];

/**
 * Tasks of this session from the boards whose root holds its cwd: `done` = cards (open, or among the
 * last 10 closed the CLI keeps — target.rs take(10)) it moved on to QA / Review / Approved by a note,
 * `open` = cards it holds now. Only notes and claims at or after `started_at` (ms) count, so a reused
 * label (`dev`) never inherits an earlier session's cards; the label must match exactly (case-insensitive:
 * `dev-ide` is not `dev`). Null when the cwd is under no readable board (the caller falls back to its journal).
 */
export function boardTasks(room: { label: string; cwd: string | null; started_at: number | null }, boards: BoardRef[]): { done: number; open: number } | null {
  const label = room.label.trim().toLowerCase();
  const since = room.started_at ?? 0;
  const mine = (r: string | null, at: number) => r != null && r.trim().toLowerCase() === label && at >= since;
  let seen = false;
  let done = 0;
  let open = 0;
  for (const b of boardsNear(room.cwd, boards)) {
    if (!b.board) continue;
    seen = true;
    const cards = LANES.flatMap((l) => b.board!.lanes[l.key]);
    open += cards.filter((c) => c.claim && mine(c.claim.room, c.claim.at)).length;
    for (const c of [...cards, ...b.board.closed]) if (c.history?.some((s) => s.to != null && HANDED_ON.includes(s.to) && mine(s.room, s.at))) done++;
  }
  return seen ? { done, open } : null;
}

export type NowRoom = {
  status: "running" | "idle" | "needs_input" | "ended";
  waiting: string | null;
  label: string;
  name: string;
  cwd: string | null;
  role: string | null;
  model: string | null;
  doing: string | null;
  /** Last transcript activity (ms), from `8sync ls`. */
  last_active?: number | null;
};

export type RoomNow = {
  state: NowState;
  label: string;
  role: RoleId | null;
  seat: SeatKey;
  card: Card | null;
  /** The newest thing the room did: its card note or its `8sync ls` line, with when (ms; null = unknown). */
  last: { text: string; at: number | null } | null;
  /** Quiet for this long (ms), when known and not working. */
  quietMs: number | null;
  /** Waiting / idle past IDLE_FLAG_MS: the owner may want to give it work. */
  flagged: boolean;
};

export function roomNow(room: NowRoom, boards: BoardRef[], now: number): RoomNow {
  const named = roomRole(room.label) ?? roomRole(room.name);
  const role = named?.role ?? ((room.role as RoleId | null) || null);
  const card = heldCard(room, boards);
  let state: NowState;
  if (room.status === "needs_input" || room.waiting) state = "needs";
  // A running room is working even when its card sits in Blocked: that claim is only the board's retry
  // timer (the lead's card waiting on an owner decision), not the room being stuck.
  else if (card && (claimStale(card, now) || (card.lane === "blocked" && room.status !== "running"))) state = "blocked";
  else if (room.status === "running") state = "working";
  else if (card) state = "holding";
  else if (named?.lane) state = "waiting";
  else state = "idle";

  const note = card?.note ?? null;
  const lsAt = room.last_active ?? null;
  const fromLs = room.doing ? { text: room.doing, at: lsAt } : null;
  const last = note && (!fromLs || fromLs.at == null || note.at >= fromLs.at) ? { text: note.room ? `${note.room}: ${note.text}` : note.text, at: note.at } : fromLs;

  const quietMs = state === "working" || lsAt == null ? null : Math.max(0, now - lsAt);
  // A room holding a card is between loop ticks on purpose; only a room with nothing to do is flagged.
  const flagged = (state === "waiting" || state === "idle") && quietMs != null && quietMs >= IDLE_FLAG_MS;
  return { state, label: room.label, role, seat: named?.seat ?? "lead", card, last, quietMs, flagged };
}

const ORDER: Record<NowState, number> = { needs: 0, blocked: 1, working: 2, holding: 3, waiting: 4, idle: 5 };

/** Attention order: what needs the owner first, then work in progress, then the free rooms. */
export function roster<T extends NowRoom & { key: string }>(rooms: T[], boards: BoardRef[], now: number): (RoomNow & { key: string; room: T })[] {
  return rooms
    .filter((r) => r.status !== "ended")
    .map((r) => ({ ...roomNow(r, boards, now), key: r.key, room: r }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || Number(b.flagged) - Number(a.flagged) || a.label.localeCompare(b.label));
}

/** Counts per state for the one-line office summary (only states that occur, in attention order). */
export function rosterSummary(rows: { state: NowState }[]): string {
  const n = (s: NowState) => rows.filter((r) => r.state === s).length;
  return NOW_STATES.filter((s) => n(s) > 0)
    .map((s) => `${n(s)} ${NOW_LABEL[s].toLowerCase()}`)
    .join(" · ");
}

/** `by`: the room that held the card before it moved (null when nobody did). */
export type Move = { from: LaneKey; to: LaneKey | "done" | "dropped"; by: string | null };

/** Cards whose lane changed between two polls of the same board (closed ones included). New cards are not moves. */
export function cardMoves(prev: Board | null, next: Board | null): Map<number, Move> {
  const out = new Map<number, Move>();
  if (!prev || !next) return out;
  const where = new Map<number, { lane: LaneKey; by: string | null }>();
  for (const l of LANES) for (const c of prev.lanes[l.key]) where.set(c.id, { lane: l.key, by: c.claim?.room ?? null });
  for (const l of LANES) {
    for (const c of next.lanes[l.key]) {
      const was = where.get(c.id);
      if (was && was.lane !== l.key) out.set(c.id, { from: was.lane, to: l.key, by: was.by });
    }
  }
  for (const c of next.closed) {
    const was = where.get(c.id);
    if (was) out.set(c.id, { from: was.lane, to: c.state, by: was.by });
  }
  return out;
}

/** "vừa xong" / "45 giây" / "4 phút" / "2 giờ" / "3 ngày" before `now`; "" for an unknown time. */
export function agoVi(at: number | null | undefined, now: number): string {
  if (at == null || !Number.isFinite(at) || at <= 0) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "vừa xong";
  if (s < 60) return `${s} giây trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

/** "4 phút" for a duration (no "trước"). */
export function spanVi(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} giờ ${m % 60} phút` : `${Math.floor(h / 24)} ngày`;
}

/** Keys whose value changed between two snapshots (a key new in `next` is an arrival, not a change). */
export function stateChanges(prev: Record<string, string> | null, next: Record<string, string>): Set<string> {
  const out = new Set<string>();
  if (!prev) return out;
  for (const [k, v] of Object.entries(next)) if (k in prev && prev[k] !== v) out.add(k);
  return out;
}

/**
 * The clip of the room's own desk, from real state only: away at the sprint meeting, a one-shot cheer
 * right after it moved its card on, a raised hand while Claude waits for the owner, the alert pose when
 * blocked, the work clip `8sync ls` reports while running, else sitting still.
 */
export function deskClip(
  n: Pick<RoomNow, "state">,
  floor: string | null,
  o: { inMeeting?: boolean; cheer?: boolean } = {},
): "away" | "done" | "waiting" | "stalled" | "typing" | "running" | "reading" | "idle" {
  if (o.inMeeting) return "away";
  if (o.cheer) return "done";
  if (n.state === "needs") return "waiting";
  if (n.state === "blocked") return "stalled";
  if (n.state === "working") return floor === "running" || floor === "reading" ? floor : "typing";
  return "idle";
}

/** Compact age for tight chips: "41s" / "5 ph" / "2 giờ" / "3 ngày" ("" when unknown). */
export function agoShort(at: number | null | undefined, now: number): string {
  if (at == null || !Number.isFinite(at) || at <= 0) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ph`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} giờ` : `${Math.floor(h / 24)} ngày`;
}
