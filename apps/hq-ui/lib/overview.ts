// Tổng quan tab: the small, pure summaries each project block shows (mini board, latest moves).
import { LANES, rankOf, type Board, type Card, type LaneKey } from "./lanes";

/** Lanes with cards, each with its count and the first `per` cards in claim order (priority, then queue). */
export function topCards(b: Board, per = 2): { lane: LaneKey; n: number; cards: Card[] }[] {
  return LANES.filter((l) => b.lanes[l.key].length > 0).map((l) => ({
    lane: l.key,
    n: b.lanes[l.key].length,
    cards: [...b.lanes[l.key]].sort((a, z) => rankOf(a) - rankOf(z)).slice(0, per),
  }));
}

export type RecentMove = { id: number; text: string; from: LaneKey; to: LaneKey | "done" | "dropped"; room: string | null; at: number };

/** The latest lane change of each card (open or closed), newest first: what the team just moved. */
export function recentMoves(b: Board, n = 5): RecentMove[] {
  const out: RecentMove[] = [];
  for (const c of LANES.flatMap((l) => b.lanes[l.key])) {
    const m = [...(c.history ?? [])].reverse().find((s) => s.from && s.to);
    if (m) out.push({ id: c.id, text: c.text, from: m.from!, to: m.to!, room: m.room, at: m.at });
  }
  for (const c of b.closed) {
    // A closed card's last move is its close: from the lane it was in.
    if (c.lane && c.at) out.push({ id: c.id, text: c.text, from: c.lane, to: c.state, room: c.by, at: c.at });
  }
  return out.sort((a, z) => z.at - a.at).slice(0, n);
}
