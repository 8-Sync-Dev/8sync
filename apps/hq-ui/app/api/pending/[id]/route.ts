import { bad, json, open, readBody } from "@/lib/server/http";
import { answerPending } from "@/lib/server/pending";

export const runtime = "nodejs";

/** The owner's answer: `{answers: {question: label}}` or `{allow: boolean}`, optional `note`. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { id } = await ctx.params;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const r = answerPending(id, body);
  if (!r.ok) return bad(r.error, r.status);
  return json({ ok: true, answer: r.answer }, 201);
}
