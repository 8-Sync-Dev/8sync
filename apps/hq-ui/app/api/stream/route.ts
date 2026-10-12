import { afterParam, open } from "@/lib/server/http";
import { ingest } from "@/lib/server/ingest";
import { messagesAfter, tasksFor } from "@/lib/server/queries";

export const runtime = "nodejs";

const TICK_MS = 1000;
const HEARTBEAT_MS = 15_000;

/**
 * SSE of new rows. Auth uses the same header as every API call, so the client
 * reads it with fetch() + a stream reader (EventSource cannot send headers).
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { db } = o;
  const url = new URL(req.url);
  let lastMsg = afterParam(url, "after");
  let lastTask = afterParam(url, "tasks_after") || Date.now();
  let sessionsSig = "";
  let projectsSig = "";
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const signature = (sql: string) => JSON.stringify(db.prepare(sql).get());

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastBeat = Date.now();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const close = () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const tick = () => {
        try {
          ingest(db);
          const messages = messagesAfter(db, { after: lastMsg, limit: 1000 });
          if (messages.length) {
            lastMsg = messages[messages.length - 1].id;
            send("messages", messages);
          }
          const tasks = tasksFor(db, null, lastTask);
          if (tasks.length) {
            lastTask = Math.max(...tasks.map((t) => t.updated_at));
            send("tasks", tasks);
          }
          const s = signature("SELECT count(*) c, max(updated_at) u FROM sessions");
          if (s !== sessionsSig) {
            if (sessionsSig) send("sessions", {});
            sessionsSig = s;
          }
          const p = signature("SELECT count(*) c, max(id) m FROM projects");
          if (p !== projectsSig) {
            if (projectsSig) send("projects", {});
            projectsSig = p;
          }
          if (Date.now() - lastBeat >= HEARTBEAT_MS) {
            controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
            lastBeat = Date.now();
          }
        } catch (e) {
          console.error("[hq] stream tick failed", e);
          close();
        }
      };
      controller.enqueue(enc.encode("retry: 2000\n\n"));
      send("hello", { at: Date.now(), after: lastMsg });
      tick();
      timer = setInterval(tick, TICK_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
