import { getContent, openContent } from "@/lib/server/content";
import { mediaFiles, mediaSigValid } from "@/lib/server/content-media";
import { bad, cookieAccess, open } from "@/lib/server/http";
import { sendFile } from "@/lib/server/send-file";

export const runtime = "nodejs";

/**
 * One media file of a content item. `?id=<item>&i=<index>&n=<name>`: the path is the item's
 * `media_path` in the DB; nothing in the request names a file. `n` must match the file now at `i` (a
 * folder that gained a file since the list shifts the indexes: 409 instead of the wrong picture).
 *
 * Auth: the `x-hq-token` header, or the signed URL the list hands out (`&s=<size>&e=<expiry>&sig=`,
 * lib/server/content-media.ts publicMedia) so `<video src>`, `<img src>` and the "Tải" link work as
 * plain browser requests. A signed URL still needs the browser's own login (loopback, `hq_pub`, or a
 * live `hq_guest`): a revoked guest loses the media it already had links to at the next request.
 * Streamed from disk, never held whole, any size: `Range: bytes=` answers 206
 * (the player seeks without pulling the file), `&dl=1` adds `Content-Disposition: attachment`.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = Number(q.get("id"));
  const i = Number(q.get("i") ?? "0");
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(i) || i < 0) return bad("id, i: số", 400);
  const name = q.get("n");
  const sig = q.get("sig");
  const size = Number(q.get("s"));
  if (sig !== null) {
    if (name === null || !mediaSigValid(sig, id, i, name, size, Number(q.get("e")))) return bad("link hết hạn, mở lại mục này", 401);
    const who = cookieAccess(req.headers);
    if (!who || !("role" in who)) return bad(who && "error" in who ? who.error : "chưa đăng nhập", 401);
  } else {
    const o = open(req);
    if ("res" in o) return o.res;
  }
  const c = openContent();
  if ("configured" in c || "error" in c) return bad("chưa có DB nội dung", 404);
  const item = getContent(c.db, id);
  const file = item ? mediaFiles(item.media_path)[i] : undefined;
  if (!file) return bad("not found", 404);
  if ((name !== null && name !== file.name) || (sig !== null && size !== file.size)) return bad("thư mục media vừa đổi, tải lại", 409);
  return sendFile(req, file, { download: q.get("dl") === "1", cache: "private, no-store" });
}
