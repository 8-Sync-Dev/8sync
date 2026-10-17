// The project board of `8sync ccc auto board --json` (crates/cli/src/verbs/ccc/target.rs, lanes after
// super-board, MIT): what each room is doing on which card. Pure, so the route and the view share it.

export const LANES = [
  { key: "backlog", label: "Backlog", hint: "lead/ba viết AC + lệnh check" },
  { key: "ready", label: "Ready", hint: "chờ dev nhận" },
  { key: "building", label: "Building", hint: "dev đang làm trong worktree" },
  { key: "qa", label: "QA", hint: "qa chạy check + UAT" },
  { key: "review", label: "Review", hint: "review đối kháng diff" },
  { key: "approved", label: "Approved", hint: "chờ anh trả lời Ship" },
  { key: "blocked", label: "Blocked", hint: "lead hoặc anh gỡ" },
] as const;

export type LaneKey = (typeof LANES)[number]["key"];

export type Card = {
  id: number;
  text: string;
  lane: LaneKey;
  check: string | null;
  label: string | null;
  /** Room holding the card, and since when (ms). */
  claim: { room: string; at: number } | null;
  pr: string | null;
  sha: string | null;
  bounces: number;
  /** Latest note: what happened last. */
  note: { room: string | null; text: string; at: number } | null;
  added: number;
};

export type Closed = { id: number; text: string; state: "done" | "dropped"; by: string | null; at: number | null };
export type Board = { lanes: Record<LaneKey, Card[]>; closed: Closed[] };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ms = (v: unknown): number | null => {
  const s = num(v);
  return s === null ? null : s * 1000;
};
const isLane = (v: unknown): v is LaneKey => LANES.some((l) => l.key === v);

function card(v: unknown, lane: LaneKey): Card | null {
  const o = v as Record<string, unknown> | null;
  const id = num(o?.id);
  const text = str(o?.text);
  if (!o || id === null || !text) return null;
  const c = o.claim as Record<string, unknown> | null;
  const claim = c && str(c.room) ? { room: str(c.room)!, at: ms(c.at) ?? 0 } : null;
  const notes = Array.isArray(o.notes) ? (o.notes as Record<string, unknown>[]) : [];
  const last = notes.length ? notes[notes.length - 1] : null;
  return {
    id,
    text,
    lane,
    check: str(o.check),
    label: str(o.label),
    claim,
    pr: str(o.pr),
    sha: str(o.sha),
    bounces: num(o.bounces) ?? 0,
    note: last && str(last.text) ? { room: str(last.room), text: str(last.text)!, at: ms(last.at) ?? 0 } : null,
    added: ms(o.added) ?? 0,
  };
}

/** `auto board --json` (schema 1) → Board; null when the shape is not that. */
export function parseBoard(v: unknown): Board | null {
  const o = v as { schema?: unknown; lanes?: unknown; closed?: unknown } | null;
  if (!o || o.schema !== 1 || !Array.isArray(o.lanes)) return null;
  const lanes = Object.fromEntries(LANES.map((l) => [l.key, [] as Card[]])) as Record<LaneKey, Card[]>;
  for (const l of o.lanes as { lane?: unknown; cards?: unknown }[]) {
    if (!isLane(l?.lane) || !Array.isArray(l.cards)) continue;
    const key = l.lane;
    lanes[key] = l.cards.flatMap((c) => card(c, key) ?? []);
  }
  const closed = (Array.isArray(o.closed) ? o.closed : []).flatMap((c): Closed[] => {
    const x = c as Record<string, unknown>;
    const id = num(x?.id);
    const text = str(x?.text);
    if (id === null || !text || (x.state !== "done" && x.state !== "dropped")) return [];
    return [{ id, text, state: x.state, by: str(x.by), at: ms(x.closed) }];
  });
  return { lanes, closed };
}

export const openCount = (b: Board): number => LANES.reduce((n, l) => n + b.lanes[l.key].length, 0);

/** One line for the project header: where the cards are and what waits for the owner. */
export function boardSummary(b: Board): string {
  const open = openCount(b);
  if (open === 0) return b.closed.length ? `hết card mở · ${b.closed.length} đã xong/bỏ gần đây` : "chưa có card";
  const busy = LANES.filter((l) => b.lanes[l.key].length > 0).map((l) => `${l.label} ${b.lanes[l.key].length}`);
  const ship = b.lanes.approved.length;
  return `${open} card mở · ${busy.join(" · ")}${ship ? ` · ${ship} chờ Ship` : ""}`;
}

/** A claim the CLI takes back after 2 h without a note (target.rs CLAIM_SECS). */
export const CLAIM_STALE_MS = 2 * 3600 * 1000;
export const claimStale = (c: Card, now = Date.now()): boolean => !!c.claim && now - c.claim.at >= CLAIM_STALE_MS;
