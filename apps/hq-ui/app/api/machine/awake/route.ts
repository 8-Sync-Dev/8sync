import { setAwake } from "@/lib/server/awake";
import { bad, json, open, readBody } from "@/lib/server/http";

export const runtime = "nodejs";

/** `{on: boolean}`: the Máy tab switch, `8sync ccc awake on|off` (only this 8sync's own hold). */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (typeof body?.on !== "boolean") return bad("on: true hoặc false");
  const r = await setAwake(body.on);
  if (!r.ok) return bad(r.message, 409);
  return json({ ok: true, message: r.message });
}
