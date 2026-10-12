import { stamp } from "@/lib/server/db";
import { bad, json, open, readBody } from "@/lib/server/http";
import { insertMessage } from "@/lib/server/queries";
import { clampText, isTmuxName } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const o = open(req, { allowMissingOrigin: true });
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  if (!isTmuxName(body.session)) return bad("session must be an hq-* name", 422);
  const text = clampText(body.text);
  if (!text.ok) return bad(text.error, 422);
  const message = insertMessage(o.db, {
    ts: Date.now(),
    session: body.session,
    team: null,
    kind: "session_reply",
    from_: body.session,
    to_: "owner",
    text: text.value,
  });
  o.db
    .prepare("UPDATE sessions SET status = 'running', updated_at = ? WHERE name = ? AND status != 'ended'")
    .run(stamp(), body.session);
  return json({ message }, 201);
}
