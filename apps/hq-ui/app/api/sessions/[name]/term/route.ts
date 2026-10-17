import { bad, json, open, readBody } from "@/lib/server/http";
import { mergedSessions } from "@/lib/server/proc";
import { TERM_ID, clampSize, closeTerm, input, openTerm, watch } from "@/lib/server/term";

export const runtime = "nodejs";

const HEARTBEAT_MS = 15_000;

/** The live background room for this id, or null (tmux rooms keep their own drawer). */
async function room(db: Parameters<typeof mergedSessions>[0], id: string) {
  return (await mergedSessions(db)).find((s) => s.session_id === id && !s.tmux && s.status !== "ended") ?? null;
}

/**
 * The room's terminal as a stream: `event: out` carries base64 terminal bytes, `event: end` when the
 * attach client exits. Read with fetch() + a stream reader (EventSource cannot send the HQ token).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("terminal is opened by a Claude Code session id", 422);
  const s = await room(o.db, name);
  if (!s) return bad("phòng này không chạy nền (hoặc đã dừng)", 404);
  const url = new URL(req.url);
  const size = clampSize(Number(url.searchParams.get("cols")), Number(url.searchParams.get("rows")));
  let t;
  try {
    t = openTerm(name, s.cwd, size);
  } catch (e) {
    return bad((e as Error).message, 422);
  }
  const term = t;
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
      stop = watch(name, term, (b) => {
        if (b) push("out", b.toString("base64"));
        else {
          push("end", "{}");
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

/** `{data}` keys typed in the browser and/or `{cols, rows}`. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("bad session id", 422);
  const body = await readBody(req);
  if (!body) return bad("body must be a JSON object", 422);
  return input(name, body) ? json({ ok: true }) : bad("terminal chưa mở", 409);
}

/** Close the terminal now (the room keeps running). */
export async function DELETE(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("bad session id", 422);
  closeTerm(name);
  return json({ ok: true });
}
