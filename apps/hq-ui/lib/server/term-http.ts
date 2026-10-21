// The HTTP face of a web terminal (lib/server/term.ts), shared by a room's terminal and the shell.
import { json } from "./http";
import { poll, watch, type Term } from "./term";

const HEARTBEAT_MS = 15_000;

/**
 * GET of a terminal. Default: a stream, `event: out` = base64 terminal bytes, `event: end` when the
 * bridge exits (`{"elsewhere":true}` when an omp room's session is open in another terminal),
 * `event: ping` at once (so the page knows the stream reaches it) and every 15 s. Read with fetch() +
 * a stream reader (EventSource cannot send the HQ token). With `?gen=&since=` (a link whose proxy
 * holds a stream back, like a Cloudflare quick tunnel) it answers once with JSON
 * `{gen, cursor, out, reset, ended, elsewhere}`: the bytes after `since`, `out` in base64.
 */
export function termResponse(req: Request, key: string, term: Term): Response {
  const url = new URL(req.url);
  if (url.searchParams.has("since")) {
    const p = poll(key, term, Number(url.searchParams.get("gen")), Number(url.searchParams.get("since")));
    return json({ gen: p.gen, cursor: p.cursor, out: p.out.toString("base64"), reset: p.reset, answered: p.answered, ended: p.ended, elsewhere: p.elsewhere });
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
          push("end", term.elsewhere ? '{"elsewhere":true}' : "{}");
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
