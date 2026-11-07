// FLIP (First, Last, Invert, Play) for a list whose rows re-sort, Messenger style: the pure part. From
// each row's layout box before and after a commit it says how far to scroll so the row the reader looks
// at stays put, how far each row must be pushed back to look where it was, which rows are new and which
// rose (jumped up past others: the one that just got busy). No DOM: hooks/use-flip.ts measures and plays.
// Tested in tests/flip.test.ts.

/** A row's layout box inside the list, from `offsetTop`/`offsetHeight` (transforms and scroll left out). */
export type FlipBox = { key: string; top: number; height: number };

export type FlipMove = { key: string; /** px to push the row back by (translateY) so it starts where it was on screen. */ dy: number; rose: boolean };

/**
 * The scroll shift that keeps the reader's view still: the first row on screen before (its box reaches
 * below `scrollTop`) that is still listed and kept its place give or take one slot. A row that jumped is
 * no anchor (following it would carry the view off). 0 at the top of the list: there the new top row
 * slides in where the reader is already looking.
 */
export function flipAnchor(prev: readonly FlipBox[], next: readonly FlipBox[], scrollTop: number): number {
  if (scrollTop <= 0) return 0;
  const was = new Map(prev.map((b, i) => [b.key, i]));
  const now = new Map(next.map((b, i) => [b.key, i]));
  for (const b of prev) {
    if (b.top + b.height <= scrollTop) continue;
    const j = now.get(b.key);
    if (j == null || Math.abs(j - was.get(b.key)!) > 1) continue;
    return next[j].top - b.top;
  }
  return 0;
}

/**
 * Each moved row's push-back after the list scrolled by `scrolled` px, the rows that are new, and which
 * moved rows rose by more than one slot (the row that went to the top; the others it passed only shift
 * down by one). A row whose box did not move on screen is left out: an animation it runs carries on.
 */
export function flipMoves(prev: readonly FlipBox[], next: readonly FlipBox[], scrolled = 0): { moves: FlipMove[]; entered: string[] } {
  const was = new Map(prev.map((b, i) => [b.key, { top: b.top, i }]));
  const moves: FlipMove[] = [];
  const entered: string[] = [];
  next.forEach((b, j) => {
    const a = was.get(b.key);
    if (!a) return void entered.push(b.key);
    const dy = a.top - b.top + scrolled;
    if (dy !== 0) moves.push({ key: b.key, dy, rose: a.i - j > 1 });
  });
  return { moves, entered };
}
