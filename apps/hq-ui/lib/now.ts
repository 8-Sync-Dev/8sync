// "Đang làm gì": what every room is doing right now, from data HQ already has (the office rooms of
// `8sync ls` + `claude agents`). Pure, no I/O. Tested in tests/now.test.ts.
import type { SeatKey } from "./office";
import type { RoleId } from "./roles";

/** needs: Claude waits for the owner · working: the session is running · idle: any other quiet room. */
export const NOW_STATES = ["needs", "working", "idle"] as const;
export type NowState = (typeof NOW_STATES)[number];

export const NOW_LABEL: Record<NowState, string> = {
  needs: "Chờ anh",
  working: "Đang làm",
  idle: "Rảnh",
};

/** A quiet room counts as "idle too long" (highlighted) after this. */
export const IDLE_FLAG_MS = 60_000;

/**
 * The role a room name stands for (first name token; trailing digits dropped, so `dev2` is a second
 * builder; keys of ≥4 chars match as a prefix). `role` feeds RoleIcon (lib/roles ids), `seat` the desk
 * props of its sprite.
 */
const ROOM_ROLES: { keys: string[]; role: RoleId; seat: SeatKey }[] = [
  { keys: ["pm", "lead", "plan", "boss", "main", "ba", "analyst", "spec", "req", "po"], role: "plan", seat: "lead" },
  { keys: ["arch", "architect", "architecture", "sa", "solution"], role: "architect", seat: "rd" },
  { keys: ["rd", "r&d", "rnd", "research", "explore"], role: "rd", seat: "rd" },
  { keys: ["dev", "build", "builder", "code", "coder", "impl", "ui", "ux", "fe", "frontend", "web", "design", "hq", "api", "be", "backend", "server", "encore", "db", "core", "cli", "rust", "crate", "kit", "ccc"], role: "fullstack", seat: "dev" },
  { keys: ["qa", "qc", "test", "tester", "e2e", "uat"], role: "tester", seat: "qa" },
  { keys: ["review", "reviewer", "critic"], role: "reviewer", seat: "review" },
];

export function roomRole(name: string | null | undefined): { role: RoleId; seat: SeatKey } | null {
  for (const raw of (name ?? "").toLowerCase().split(/[^\p{L}\p{N}&]+/u)) {
    const tok = raw.replace(/\d+$/, "");
    if (!tok) continue;
    const row = ROOM_ROLES.find((r) => r.keys.some((k) => tok === k || (k.length >= 4 && tok.startsWith(k))));
    if (row) return { role: row.role, seat: row.seat };
  }
  return null;
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
  /** The newest thing the room did: its `8sync ls` line, with when (ms; null = unknown). */
  last: { text: string; at: number | null } | null;
  /** Quiet for this long (ms), when known and not working. */
  quietMs: number | null;
  /** Idle past IDLE_FLAG_MS: the owner may want to give it work. */
  flagged: boolean;
};

export function roomNow(room: NowRoom, now: number): RoomNow {
  const named = roomRole(room.label) ?? roomRole(room.name);
  const role = named?.role ?? ((room.role as RoleId | null) || null);
  const state: NowState = room.status === "needs_input" || room.waiting ? "needs" : room.status === "running" ? "working" : "idle";
  const lsAt = room.last_active ?? null;
  const last = room.doing ? { text: room.doing, at: lsAt } : null;
  const quietMs = state === "working" || lsAt == null ? null : Math.max(0, now - lsAt);
  const flagged = state === "idle" && quietMs != null && quietMs >= IDLE_FLAG_MS;
  return { state, label: room.label, role, seat: named?.seat ?? "lead", last, quietMs, flagged };
}

const ORDER: Record<NowState, number> = { needs: 0, working: 1, idle: 2 };

/** Attention order: what needs the owner first, then work in progress, then the free rooms. */
export function roster<T extends NowRoom & { key: string }>(rooms: T[], now: number): (RoomNow & { key: string; room: T })[] {
  return rooms
    .filter((r) => r.status !== "ended")
    .map((r) => ({ ...roomNow(r, now), key: r.key, room: r }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || Number(b.flagged) - Number(a.flagged) || a.label.localeCompare(b.label));
}

/** Counts per state for the one-line office summary (only states that occur, in attention order). */
export function rosterSummary(rows: { state: NowState }[]): string {
  const n = (s: NowState) => rows.filter((r) => r.state === s).length;
  return NOW_STATES.filter((s) => n(s) > 0)
    .map((s) => `${n(s)} ${NOW_LABEL[s].toLowerCase()}`)
    .join(" · ");
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
 * The clip of the room's own desk, from real state only: a raised hand while Claude waits for the
 * owner, the work clip `8sync ls` reports while running, else sitting still.
 */
export function deskClip(n: Pick<RoomNow, "state">, floor: string | null): "waiting" | "typing" | "running" | "reading" | "idle" {
  if (n.state === "needs") return "waiting";
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
