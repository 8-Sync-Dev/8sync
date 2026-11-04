import { bad, json, open } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { findUpload, isUploadId, uploadLink } from "@/lib/server/uploads";

export const runtime = "nodejs";

/**
 * What the chat needs to show one attachment: {id, name, kind, type, size, url}. `url` is the signed
 * file URL (no token needed) the inline player and the "Tải" buttons use; no local path goes out.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { id } = await ctx.params;
  if (!isUploadId(id)) return bad("id must be 32 hex characters", 422);
  const hit = findUpload(id, await knownRoots(o.db));
  if (!hit) return bad("not found", 404);
  return json({ id, name: hit.name, kind: hit.kind, type: hit.type, size: hit.size, url: uploadLink(id) });
}
