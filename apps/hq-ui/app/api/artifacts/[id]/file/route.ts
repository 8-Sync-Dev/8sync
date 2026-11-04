import { bad, open } from "@/lib/server/http";
import { isArtifactId, openArtifact } from "@/lib/server/artifacts";
import { baseName } from "@/lib/artifacts";

export const runtime = "nodejs";

/**
 * The bytes of one artifact by id (no path from the request). HTML and SVG come with a CSP sandbox:
 * opened straight from this route they run in an opaque origin, never as HQ. `?download=1` = attachment.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/artifacts/[id]/file">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { id } = await ctx.params;
  if (!isArtifactId(id)) return bad("id must be 32 hex characters", 422);
  const hit = openArtifact(o.db, id);
  if (!hit) return bad("not found", 404);
  const name = baseName(hit.artifact.path);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "content-type": hit.type,
    "content-length": String(hit.size),
    // A room may rewrite the file under the same id: always ask again.
    "cache-control": "private, no-cache",
    "x-content-type-options": "nosniff",
    "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  };
  if (hit.artifact.kind === "html" || hit.type.startsWith("image/svg")) headers["content-security-policy"] = "sandbox allow-scripts allow-popups";
  return new Response(hit.body, { headers });
}
