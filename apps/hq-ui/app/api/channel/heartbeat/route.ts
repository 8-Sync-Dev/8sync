import { recordBeat } from "@/lib/server/channel";
import { bad, json, open, readBody } from "@/lib/server/http";
import { isTmuxName } from "@/lib/server/validate";

export const runtime = "nodejs";

/** Contract §2: the channel beats every 15 s; fresh beats switch delivery to the inbox. */
export async function POST(req: Request) {
  const o = open(req, { allowMissingOrigin: true });
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  if (!isTmuxName(body.session)) return bad("session must be an hq-* name", 422);
  const at = Date.now();
  recordBeat(o.db, body.session, at);
  return json({ ok: true, at });
}
