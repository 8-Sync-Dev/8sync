// The HTTP face of a web terminal (lib/server/term.ts), shared by a room's terminal and the shell.
import { json } from "./http";
import { endedTerm, poll, waitOutput, watch, type Term } from "./term";

const HEARTBEAT_MS = 15_000;
/** Longest a poll is held open waiting for output (a Cloudflare tunnel cuts a pending reply at 100 s). */
export const LONG_POLL_MAX_MS = 20_000;

/**
 * A poll (`?gen=&since=`) still on a bridge that has since ended: that bridge, so the reply says it
 * ended and why. Routes check this before opening a bridge, or the poll would silently get a new one.
 */
export function polledEnded(req: Request, key: string): Term | undefined {
  const url = new URL(req.url);
  return url.searchParams.has("since") ? endedTerm(key, Number(url.searchParams.get("gen"))) : undefined;
}

/**
 * GET of a terminal. Default: a stream, `event: out` = base64 terminal bytes, `event: end` when the
 * bridge exits (`{"elsewhere":true}` when an omp room's session is open in another terminal,
 * `{"exited":true}` when omp itself ended on the PC), `event: ping` at once (so the page knows the
 * stream reaches it) and every 15 s. Read with fetch() + a stream reader (EventSource cannot send the
 * HQ token). With `?gen=&since=` (a link whose proxy holds a stream back, like a Cloudflare quick
 * tunnel) it answers once with JSON `{gen, cursor, out, reset, ended, elsewhere, dead, exited}`: the
 * bytes after `since`, `out` in base64; with `&wait=<ms>` (at most LONG_POLL_MAX_MS) an up-to-date
 * poll is held until output arrives or the bridge ends.
 */
export async function termResponse(req: Request, key: string, term: Term): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.has("since")) {
    const gen = Number(url.searchParams.get("gen"));
    const since = Number(url.searchParams.get("since"));
    const wait = Math.min(LONG_POLL_MAX_MS, Math.max(0, Number(url.searchParams.get("wait")) || 0));
    if (gen === term.gen && since === term.total) await waitOutput(term, since, wait, req.signal);
    const p = poll(key, term, gen, since);
    return json({ gen: p.gen, cursor: p.cursor, out: p.out.toString("base64"), reset: p.reset, answered: p.answered, ended: p.ended, elsewhere: p.elsewhere, dead: p.dead, exited: p.exited });
  }
  const enc = new TextEncoder();
  let stop: () => void = () => {};
  let beat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: string, data: string) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          /* closed */
        }
      };
      push("ping", "{}");
      // `replay`: kept output whose queries were answered already; the page writes it without answering.
      stop = watch(key, term, (b, answered) => {
        if (b) push(answered ? "replay" : "out", b.toString("base64"));
        else {
          push("end", term.dead ? '{"dead":true}' : term.elsewhere ? '{"elsewhere":true}' : term.exited ? '{"exited":true}' : "{}");
          clearInterval(beat);
          try {
            controller.close();
          } catch {
            /* closed */
          }
        }
      });
      beat = setInterval(() => push("ping", "{}"), HEARTBEAT_MS);
      req.signal.addEventListener("abort", () => {
        clearInterval(beat);
        stop();
      });
    },
    cancel() {
      clearInterval(beat);
      stop();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
