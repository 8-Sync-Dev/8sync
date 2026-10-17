import { bad, json, open, readBody } from "@/lib/server/http";
import { answerPermit } from "@/lib/server/permit";

export const runtime = "nodejs";

/** {id, decision: "allow" | "deny"}: the owner's answer to a room's open permission request. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/permit">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  const body = await readBody(req);
  const id = typeof body?.id === "string" ? body.id : "";
  const decision = body?.decision;
  if (!id || (decision !== "allow" && decision !== "deny")) return bad("cần {id, decision: allow | deny}", 422);
  const r = answerPermit(name, id, decision);
  return r.ok ? json({ ok: true }) : bad(r.error ?? "không ghi được", 409);
}
