import fs from "node:fs";
import { bad, open } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { findUpload, isUploadId } from "@/lib/server/uploads";

export const runtime = "nodejs";

/**
 * The image an attachment id names, for the chat thumbnails and the lightbox: the staged copy or the
 * one placed in a known project's `.claude/hq-uploads/<id>/`. The id (32 hex) is the only client input;
 * no path is taken from the request. Anything else, and any non-image, is 404.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/uploads/[id]/file">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { id } = await ctx.params;
  if (!isUploadId(id)) return bad("id must be 32 hex characters", 422);
  const hit = findUpload(id, await knownRoots(o.db));
  if (!hit) return bad("not found", 404);
  // The id is random and its file never changes: the browser may keep it for the session.
  return new Response(new Uint8Array(fs.readFileSync(hit.path)), {
    headers: {
      "content-type": hit.type,
      "content-length": String(hit.size),
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
