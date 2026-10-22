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
