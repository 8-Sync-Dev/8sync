import { recordBeat } from "@/lib/server/channel";
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
  // A poll proves the channel is alive as much as a heartbeat does.
  recordBeat(o.db, session);
  for (;;) {
    // Only rows queued for the channel: terminal-delivered ones were already typed.
    const messages = messagesAfter(o.db, { after, session, kind: "owner_message", delivery: "channel", limit: 100 });
    if (messages.length || Date.now() >= deadline || req.signal.aborted) {
      if (messages.length) {
        // The poller has the rows now: never retype them into the terminal.
        const mark = o.db.prepare("UPDATE messages SET picked_up_at = ? WHERE id = ? AND picked_up_at IS NULL");
        const at = Date.now();
        for (const m of messages) mark.run(at, m.id);
      }
      // `max` lets the channel notice a recreated DB (its saved id is ahead of every row).
      const max = (o.db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM messages").get() as { m: number }).m;
      return json({ messages, last: messages.at(-1)?.id ?? after, max });
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
    try {
      ingest(o.db);
    } catch {
      /* next tick */
    }
  }
}
