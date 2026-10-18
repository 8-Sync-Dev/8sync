import { afterParam, bad, limitParam, json, open, readBody } from "@/lib/server/http";
import { deliverWatched, SessionWaiting } from "@/lib/server/channel";
import { capturePlain, sendKeys } from "@/lib/server/proc";
import { inboxLive, isSessionId, queueInbox } from "@/lib/server/inbox";
import { messagesAfter, ownerMessage } from "@/lib/server/queries";
import { clampText, isTmuxName } from "@/lib/server/validate";
import { expandMentions } from "@/lib/server/fs-list";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const q = url.searchParams;
  const project = q.get("project");
  const limit = limitParam(url);
  if (limit === null) return bad("limit must be a positive integer", 400);
  return json({
    messages: messagesAfter(o.db, {
      after: afterParam(url),
      session: q.get("session"),
      team: q.get("team"),
      project: project && /^\d+$/.test(project) ? Number(project) : null,
      limit,
    }),
  });
}

export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  // "@path" from the composer's picker → absolute, against the room's folder (`base`).
  const raw = typeof body.text === "string" && typeof body.base === "string" ? expandMentions(body.text, body.base) : body.text;
  const text = clampText(raw);
  if (!text.ok) return bad(text.error, 422);
  // Any other live Claude Code session: queue in its inbox. `live`: the 8sync-inbox mod is polling
  // (enters as soon as the session is idle); otherwise the Stop hook delivers at its next turn end.
  if (isSessionId(body.session)) {
    queueInbox(body.session, text.value);
    const message = ownerMessage(o.db, body.session, text.value, "inbox");
    return json({ message, delivery: "inbox", live: inboxLive(body.session), error: null }, 201);
  }
  if (!isTmuxName(body.session)) return bad("session must be an hq-* session or a Claude session id", 422);
  try {
    const r = await deliverWatched(o.db, body.session, text.value, { sendKeys, capture: capturePlain });
    return json({ message: r.message, delivery: r.delivery, error: r.error }, 201);
  } catch (e) {
    if (e instanceof SessionWaiting) return json({ error: "session-waiting", dialog: e.dialog }, 409);
    throw e;
  }
}
