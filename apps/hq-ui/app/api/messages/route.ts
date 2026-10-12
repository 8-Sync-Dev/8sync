import { afterParam, bad, json, open, readBody } from "@/lib/server/http";
import { messagesAfter, ownerMessage } from "@/lib/server/queries";
import { clampText, isTmuxName } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const q = url.searchParams;
  const project = q.get("project");
  return json({
    messages: messagesAfter(o.db, {
      after: afterParam(url),
      session: q.get("session"),
      team: q.get("team"),
      project: project && /^\d+$/.test(project) ? Number(project) : null,
      limit: Number(q.get("limit")) || 500,
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
  return json({ message: ownerMessage(o.db, body.session, text.value) }, 201);
}
