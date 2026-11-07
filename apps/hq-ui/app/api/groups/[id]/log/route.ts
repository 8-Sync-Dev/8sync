import { groupGuard, readGroupLog, readGroups } from "@/lib/server/groups";
import { afterParam, bad, json, limitParam, open } from "@/lib/server/http";

export const runtime = "nodejs";

/** `?after=<n>&limit=`: the group's thread after log line `n` (newest `limit`), and the turn the guard holds. */
export async function GET(req: Request, ctx: RouteContext<"/api/groups/[id]/log">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { id } = await ctx.params;
  if (!readGroups().some((x) => x.id === id)) return bad("Không có nhóm này", 404);
  const url = new URL(req.url);
  const limit = limitParam(url, 200, 500);
  if (limit === null) return bad("limit must be a positive integer", 400);
  return json({ entries: readGroupLog(id, afterParam(url), limit), held: groupGuard().held(id) });
}
