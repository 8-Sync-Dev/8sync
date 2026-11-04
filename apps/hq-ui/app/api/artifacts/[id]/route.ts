import { bad, json, open } from "@/lib/server/http";
import { forgetArtifact, isArtifactId } from "@/lib/server/artifacts";

export const runtime = "nodejs";

/** Take one artifact off the list. The file on disk stays: it is the room's. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/artifacts/[id]">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { id } = await ctx.params;
  if (!isArtifactId(id)) return bad("id must be 32 hex characters", 422);
  if (!forgetArtifact(o.db, id)) return bad("not found", 404);
  return json({ ok: true });
}
