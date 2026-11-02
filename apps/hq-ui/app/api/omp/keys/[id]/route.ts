import { KEY_ID_RE, revokeKey } from "@/lib/server/api-keys";
import { bad, json, localOnly, open } from "@/lib/server/http";

export const runtime = "nodejs";

/** Revoke a key: the next call with it gets 401. Its logged calls stay. Only from this machine. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/omp/keys/[id]">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const no = localOnly(req);
  if (no) return no;
  const { id } = await ctx.params;
  if (!KEY_ID_RE.test(id) || !revokeKey(o.db, id)) return bad("Không có key này (hoặc đã thu hồi).", 404);
  return json({ ok: true });
}
