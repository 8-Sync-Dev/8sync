import { afterParam, bad, limitParam, json, open, readBody } from "@/lib/server/http";
import { deliverWatched, SessionWaiting } from "@/lib/server/channel";
import { capturePlain, sendKeys } from "@/lib/server/proc";
import { messagesAfter } from "@/lib/server/queries";
import { clampText, isTmuxName } from "@/lib/server/validate";

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
  if (!isTmuxName(body.session)) return bad("messages can only go to hq-* sessions started here", 422);
  const text = clampText(body.text);
  if (!text.ok) return bad(text.error, 422);
  try {
    const r = await deliverWatched(o.db, body.session, text.value, { sendKeys, capture: capturePlain });
    return json({ message: r.message, delivery: r.delivery, error: r.error }, 201);
  } catch (e) {
    if (e instanceof SessionWaiting) return json({ error: "session-waiting", dialog: e.dialog }, 409);
    throw e;
  }
}
