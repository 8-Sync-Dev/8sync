import { afterParam, bad, json, open } from "@/lib/server/http";
import { ingest } from "@/lib/server/ingest";
import { messagesAfter } from "@/lib/server/queries";
import { isTmuxName } from "@/lib/server/validate";

export const runtime = "nodejs";

const HOLD_MS = 25_000;
const TICK_MS = 500;

/** Long-poll: returns owner messages for one session as soon as any exist. */
export async function GET(req: Request) {
  const o = open(req, { allowMissingOrigin: true });
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const session = url.searchParams.get("session");
  if (!isTmuxName(session)) return bad("session must be an hq-* name", 422);
  const after = afterParam(url);
  const deadline = Date.now() + HOLD_MS;
  for (;;) {
    const messages = messagesAfter(o.db, { after, session, kind: "owner_message", limit: 100 });
    if (messages.length || Date.now() >= deadline || req.signal.aborted) {
      return json({ messages, last: messages.at(-1)?.id ?? after });
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
    try {
      ingest(o.db);
    } catch {
      /* next tick */
    }
  }
}
