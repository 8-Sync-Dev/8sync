import { bad, cookieAccess, open } from "@/lib/server/http";
import { getDb } from "@/lib/server/db";
import { artifactSigValid, isArtifactId, resolveArtifact } from "@/lib/server/artifacts";
import { sendFile } from "@/lib/server/send-file";

export const runtime = "nodejs";

/**
 * The bytes of one artifact by id (no path from the request), streamed: `Range: bytes=` answers 206 so a
 * video or song seeks through the tunnel without pulling the file. `?download=1` = attachment.
 *
 * Auth: the `x-hq-token` header, or the signed URL the list hands out (`?e=<expiry>&sig=`,
 * lib/server/artifacts.ts artifactSrc) for `<video src>`, `<audio src>`, `<img src>` and the "Tải về"
 * link; a signed URL still needs the owner's own login in this browser (loopback or `hq_pub`): a guest
 * gets nothing, artifacts are the owner's.
 *
 * Everything but a PDF (the browser's viewer refuses a sandbox) comes with a CSP sandbox: an HTML page or
 * an SVG opened straight from this route runs in an opaque origin, never as HQ.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/artifacts/[id]/file">) {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const sig = q.get("sig");
  let db;
  if (sig !== null) {
    if (!isArtifactId(id) || !artifactSigValid(sig, id, Number(q.get("e")))) return bad("link hết hạn, mở lại kết quả này", 401);
    const who = cookieAccess(req.headers);
    if (!who || !("role" in who)) return bad(who && "error" in who ? who.error : "chưa đăng nhập", 401);
    if (who.role !== "owner") return bad("chỉ chủ HQ xem được kết quả", 403);
    db = getDb();
  } else {
    const o = open(req);
    if ("res" in o) return o.res;
    if (!isArtifactId(id)) return bad("id must be 32 hex characters", 422);
    db = o.db;
  }
  const hit = resolveArtifact(db, id);
  if (!hit) return bad("not found", 404);
  const headers: Record<string, string> = { "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(hit.file.name)}` };
  if (hit.artifact.kind === "html") headers["content-security-policy"] = "sandbox allow-scripts allow-popups";
  else if (hit.file.type === "image/svg+xml") headers["content-security-policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  else if (hit.artifact.kind !== "pdf") headers["content-security-policy"] = "sandbox";
  // A room may rewrite the file under the same id: always ask again.
  return sendFile(req, hit.file, { download: q.get("download") === "1", cache: "private, no-cache", headers });
}
