import { roster } from "@/lib/server/brief";
import { SessionWaiting } from "@/lib/server/channel";
import { chiefAsk, readChief } from "@/lib/server/chief";
import { deliverText } from "@/lib/server/deliver";
import { groupGuard } from "@/lib/server/groups";
import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";
import { clampText } from "@/lib/server/validate";

export const runtime = "nodejs";

/**
 * `{text}` → the Chief of Staff room, with the live rooms and the routing rule (lib/server/chief.ts),
 * through the same delivery as /api/messages, under the same sender rule (the owner's page = owner).
 * 201 `{room, message, delivery, live?, error}`; 409 off / not live / dialog open; 422 bad text.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const text = clampText(body.text);
  if (!text.ok) return bad(text.error, 422);
  const sender = senderOf(req, o.access);
  try {
    const r = await chiefAsk(text.value, { cfg: readChief(), roster: () => roster(o.db), send: (room, t) => deliverText(o.db, room, t, sender) });
    if (r.status !== 201) return bad(r.error, r.status);
    // The owner's own words to the chief: it no longer answers a group turn (lib/server/groups.ts).
    if (sender.by === "owner") groupGuard().leave(r.room);
    return json({ room: r.room, ...(r.result as object) }, 201);
  } catch (e) {
    if (e instanceof SessionWaiting) return json({ error: "session-waiting", dialog: e.dialog }, 409);
    throw e;
  }
}
