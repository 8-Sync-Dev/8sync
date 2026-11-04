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
 * A stream that a proxy passes in batches (owner 2026-11-04: "terminal không hiển gì, lúc hiện lúc
 * không" through the quick tunnel link): Cloudflare's quick tunnel releases a stream ~130 KB at a time
 * and never on a timer. A room's replay (up to 256 KB kept, one event) crosses that at once, so the first
 * batch (the opening ping and part of the replay) arrived inside FIRST_BYTE_MS: the page said live and
 * stayed on the stream, but the rest of the replay sat in the tunnel until the room printed another
 * ~130 KB, i.e. never while it idles: a blank box under a green dot. HQ pings every PING_MS with its
 * clock; off loopback the page polls instead once the stream is quiet for STALE_MS or a ping comes
 * HELD_MS later than the quickest one did.
 */
export const PING_MS = 2000;
export const STALE_MS = 6000;
export const HELD_MS = 3000;
/**
 * `(sentAt, now)` of each ping → true once it arrived HELD_MS later than the quickest ping so far.
 * Relative to that quickest lag, so the PC's and the phone's clocks need not agree.
 */
export function heldBack(): (sentAt: number, now: number) => boolean {
  let quickest = Infinity;
  return (sentAt, now) => {
    const lag = now - sentAt;
    if (lag < quickest) quickest = lag;
    return lag - quickest > HELD_MS;
  };
}

/** HQ's clock in a ping's data (`{"t":<ms>}`); null for an old HQ's `{}` or anything else. */
export function pingTime(data: string): number | null {
  try {
    const v: unknown = JSON.parse(data);
    return v && typeof v === "object" && "t" in v && typeof v.t === "number" && Number.isFinite(v.t) ? v.t : null;
  } catch {
    return null;
  }
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

/** Longest `{data}` the terminal POST takes (MAX_INPUT in lib/server/term.ts). */
export const MAX_KEYS = 4096;
/**
 * Keys to the terminal in the order they were typed (owner 2026-11-03: through the link, typing "the
 * quick brown fox" reached omp as "t eqk rnbhowo…"): one POST at a time, since parallel POSTs through a
 * tunnel land in any order, and the keys typed while one is in flight go together in the next. `send`
 * resolves false when the keys did not reach the terminal: the rest is dropped and `onFail` told once.
 */
export function keyQueue(send: (data: string) => Promise<boolean>, onFail: () => void): (data: string) => void {
  let pending = "";
  let busy = false;
  const pump = async () => {
    busy = true;
    while (pending) {
      let cut = Math.min(pending.length, MAX_KEYS);
      // Never split a surrogate pair (an emoji) across two POSTs.
      const c = pending.charCodeAt(cut - 1);
      if (cut < pending.length && c >= 0xd800 && c <= 0xdbff) cut--;
      const data = pending.slice(0, cut);
      pending = pending.slice(cut);
      if (!(await send(data))) {
        pending = "";
        onFail();
      }
    }
    busy = false;
  };
  return (data) => {
    if (!data) return;
    pending += data;
    if (!busy) void pump();
  };
}
