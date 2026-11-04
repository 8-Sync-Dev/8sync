import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/server/db";
import { bad, cookieAccess, open } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { sendFile } from "@/lib/server/send-file";
import { findUpload, isUploadId, uploadSigValid } from "@/lib/server/uploads";

export const runtime = "nodejs";

/**
 * The bytes of an attachment id, for the chat thumbnails, the lightbox, the inline player and the
 * "Tải" buttons: the staged copy or the one placed in a known project's `.claude/hq-uploads/<id>/`.
 * The id (32 hex) is the only client input; no path is taken from the request.
 *
 * Auth: the `x-hq-token` header, or the signed URL `GET /api/uploads/<id>` hands out (`?e=&sig=`,
 * lib/server/uploads.ts uploadLink) so `<video src>` and a download link work as plain browser requests.
 * A signed URL still needs the owner's own login (loopback or `hq_pub`): chat attachments are owner-only,
 * so a link copied out of the chat is no use to a guest or to anyone without the cookie.
 * Streamed from disk: `Range: bytes=` answers 206, `&dl=1` adds `Content-Disposition: attachment` with
 * the file's name. Images, video and audio go out with their type; any other file only as a download.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/uploads/[id]/file">) {
  const q = new URL(req.url).searchParams;
  const sig = q.get("sig");
  const { id } = await ctx.params;
  let db: DatabaseSync;
  if (sig !== null) {
    if (!isUploadId(id) || !uploadSigValid(sig, id, Number(q.get("e")))) return bad("link hết hạn, tải lại trang", 401);
    const who = cookieAccess(req.headers);
    if (!who || !("role" in who) || who.role !== "owner") return bad(who && "error" in who ? who.error : "chưa đăng nhập", who && "role" in who ? 403 : 401);
    db = getDb();
  } else {
    const o = open(req);
    if ("res" in o) return o.res;
    if (!isUploadId(id)) return bad("id must be 32 hex characters", 422);
    db = o.db;
  }
  const hit = findUpload(id, await knownRoots(db));
  if (!hit) return bad("not found", 404);
  // The id is random and its file never changes: the browser may keep it for the session.
  return sendFile(req, hit, { download: q.get("dl") === "1" || hit.kind === "file", cache: "private, max-age=86400, immutable" });
}
