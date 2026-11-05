// The one path from "Hỏi về đoạn này" to a room's composer: whoever has the quote (the room's Kết quả, the
// Kết quả tab) puts it here; the room composer (team-view Composer) takes it, adds it to its text and
// takes focus. Module state, so the quote survives the switch to Chat phòng while that view loads.

export type PendingAsk = { quote: string; seq: number };

let pending: PendingAsk | null = null;
let seq = 0;
const listeners = new Set<() => void>();

/** Hand `quote` (lib/ask-quote quoteForAsk) to the room composer that is open or opens next. */
export function askAbout(quote: string): void {
  if (!quote) return;
  pending = { quote, seq: ++seq };
  for (const l of listeners) l();
}

/** The quote waiting for a composer, taken: a second call returns null. */
export function takeAsk(): PendingAsk | null {
  const p = pending;
  pending = null;
  return p;
}

/** Calls `cb` whenever a quote is put; returns the unsubscribe. */
export function onAsk(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
