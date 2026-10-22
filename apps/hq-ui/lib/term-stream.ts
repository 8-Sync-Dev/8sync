// What the room terminal does when its stream stops (owner 2026-10-22: "terminal hq ui ovh web không mở được").
// Off loopback the stream rides a proxy (the VPS gate is an ssh -R socket, a quick tunnel holds streams
// back), and a drop after the first bytes used to end in "Không nối được" for good. Pure; tested in
// tests/term-stream.test.ts; used by components/hq/live-terminal.tsx.

export type StreamStop = {
  /** The page is on a remote host (not loopback). */
  remote: boolean;
  /** The user closed the terminal (the page's own abort). */
  aborted: boolean;
  /** HQ answered with a refusal (4xx: no room, bad token): polling will not fix it. */
  refused: boolean;
  /** The stream carried its `end` event (the room ended or moved elsewhere). */
  ended: boolean;
  /** The stream threw (network drop) instead of closing cleanly. */
  threw: boolean;
};

/**
 * "poll" = carry on by polling (it retries through tunnel hiccups); "fail" = show the error;
 * "done" = nothing more to do. Remote drops, clean or not, fall back to polling unless the room ended.
 */
export function afterStream(s: StreamStop): "poll" | "fail" | "done" {
  if (s.aborted || s.ended) return "done";
  if (s.refused) return "fail";
  if (s.remote) return "poll";
  return s.threw ? "fail" : "done";
}

/**
 * Polling through the VPS tunnel (owner 2026-10-22: "Fail connect terminal rất nhiều"): a phone that
 * sleeps or hops from Wi-Fi to 4G loses the tunnel for longer than five quick polls (~3 s). Keep trying
 * with backoff for a minute before saying the terminal is gone.
 */
export const POLL_GIVE_UP_MS = 60_000;
/** Gap before the next try after `fails` failures in a row: 0.6 s doubling, at most 5 s. */
export function retryDelay(fails: number): number {
  return Math.min(5000, 600 * 2 ** Math.max(0, fails - 1));
}
/** Give up only after failing without a break for POLL_GIVE_UP_MS. */
export const giveUp = (failingSince: number, now: number): boolean => now - failingSince >= POLL_GIVE_UP_MS;

/**
 * Rows the terminal asks for (owner: "options chọn trong terminal ra thiếu có 5 toàn hiện có 3 cái
 * đầu"): Claude Code draws a 5-option question in ~14 rows plus the input box, so never fewer than
 * MIN_ROWS; the box scrolls instead. While a phone keyboard is open the box gets short: keep the
 * rows it had rather than shrink and cut the list.
 */
export const MIN_ROWS = 22;
export function termRows(fitRows: number, prevRows: number | null, keyboardOpen: boolean): number {
  const rows = Math.max(MIN_ROWS, fitRows);
  return keyboardOpen && prevRows != null && rows < prevRows ? prevRows : rows;
}
/** A phone keyboard is open when the visual viewport is much shorter than the layout viewport. */
export const keyboardOpen = (visual: number | null | undefined, layout: number): boolean => visual != null && layout > 0 && visual < layout * 0.75;
