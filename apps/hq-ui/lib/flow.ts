// Flow tab: each card's path through the lanes, rebuilt from its notes ("ready → building",
// "qa → ready: [qa] …"). Pure, so the view and the tests share it. The CLI keeps the last 12 notes
// per card (target.rs NOTES_KEEP): an old card's path starts at the oldest move still kept.
import { LANES, type Board, type Card, type LaneKey, type Step } from "./lanes";

export const laneIndex = (k: LaneKey): number => LANES.findIndex((l) => l.key === k);

/** fwd: on to a later lane · back: returned to an earlier lane (a bounce) · side: into or out of Blocked. */
export type MoveKind = "fwd" | "back" | "side";

export function moveKind(from: LaneKey, to: LaneKey): MoveKind {
  if (from === "blocked" || to === "blocked") return "side";
  return laneIndex(to) < laneIndex(from) ? "back" : "fwd";
}

/** One stop on the path: the lane, when the card got there, who moved it, and the notes written while it sat there. */
export type Visit = {
  lane: LaneKey;
  at: number;
  room: string | null;
  /** The move note that brought it here (null for the first stop). */
  text: string | null;
  kind: MoveKind | null;
  notes: Step[];
};

/**
 * The lanes a card went through, in order. `lane` is where it is now (open) or was when closed;
 * a move whose `from` is not the previous stop (notes trimmed, a hand edit) adds that stop first.
 */
export function cardPath(lane: LaneKey | null, history: Step[], added: number): Visit[] {
  const moves = history.filter((s) => s.from && s.to);
  const first = moves[0]?.from ?? lane;
  if (!first) return [];
  const visits: Visit[] = [{ lane: first, at: added, room: null, text: null, kind: null, notes: [] }];
  for (const s of history) {
    const cur = visits[visits.length - 1];
    if (!s.from || !s.to) {
      cur.notes.push(s);
      continue;
    }
    if (s.from !== cur.lane) visits.push({ lane: s.from, at: s.at, room: null, text: null, kind: moveKind(cur.lane, s.from), notes: [] });
    const prev = visits[visits.length - 1];
    visits.push({ lane: s.to, at: s.at, room: s.room, text: s.text, kind: moveKind(prev.lane, s.to), notes: [] });
  }
  const last = visits[visits.length - 1];
  if (lane && last.lane !== lane) visits.push({ lane, at: last.at, room: null, text: null, kind: moveKind(last.lane, lane), notes: [] });
  return visits;
}

export type FlowRow = {
  id: number;
  text: string;
  /** Where it is (open) or ended (closed). */
  lane: LaneKey | null;
  state: "open" | "done" | "dropped";
  visits: Visit[];
  bounces: number;
  /** Room holding it now (open cards only). */
  room: string | null;
  /** Latest thing that happened to it (ms). */
  at: number;
  prio: number | null;
  /** The open card itself, for the sheet. */
  card: Card | null;
  /** Closed cards: who closed it, when (ms) and the evidence `auto done` took. */
  by: string | null;
  closedAt: number | null;
  evidence: string | null;
};

const latest = (h: Step[] | undefined, ...xs: (number | null | undefined)[]) => Math.max(0, ...(h ?? []).map((s) => s.at), ...xs.map((x) => x ?? 0));

/** Open cards first, most recently active first; then the closed ones, newest close first. */
export function flowRows(b: Board): FlowRow[] {
  const open: FlowRow[] = LANES.flatMap((l) => b.lanes[l.key]).map((c) => ({
    id: c.id,
    text: c.text,
    lane: c.lane,
    state: "open",
    visits: cardPath(c.lane, c.history ?? [], c.added),
    bounces: c.bounces,
    room: c.claim?.room ?? null,
    at: latest(c.history, c.claim?.at, c.added),
    prio: c.prio ?? null,
    card: c,
    by: null,
    closedAt: null,
    evidence: null,
  }));
  const closed: FlowRow[] = b.closed.map((c) => {
    const visits = cardPath(c.lane ?? null, c.history ?? [], c.added ?? 0);
    return {
      id: c.id,
      text: c.text,
      lane: c.lane ?? visits[visits.length - 1]?.lane ?? null,
      state: c.state,
      visits,
      bounces: visits.filter((v) => v.kind === "back").length,
      room: null,
      at: latest(c.history, c.at, c.added),
      prio: null,
      card: null,
      by: c.by,
      closedAt: c.at,
      evidence: c.evidence ?? null,
    };
  });
  return [...open.sort((a, b) => b.at - a.at), ...closed.sort((a, b) => b.at - a.at)];
}

/** Per lane: how many open cards sit there and the rooms holding them. */
export function laneNow(b: Board): Record<LaneKey, { n: number; rooms: string[] }> {
  return Object.fromEntries(
    LANES.map((l) => {
      const cards = b.lanes[l.key];
      return [l.key, { n: cards.length, rooms: [...new Set(cards.flatMap((c) => (c.claim ? [c.claim.room] : [])))] }];
    }),
  ) as Record<LaneKey, { n: number; rooms: string[] }>;
}

/** The moves of a path as drawable edges between lane columns (consecutive stops in different lanes). */
export function edges(visits: Visit[]): { from: LaneKey; to: LaneKey; kind: MoveKind; i: number }[] {
  const out: { from: LaneKey; to: LaneKey; kind: MoveKind; i: number }[] = [];
  for (let i = 1; i < visits.length; i++) {
    const a = visits[i - 1].lane;
    const b = visits[i].lane;
    if (a !== b) out.push({ from: a, to: b, kind: visits[i].kind ?? moveKind(a, b), i });
  }
  return out;
}
