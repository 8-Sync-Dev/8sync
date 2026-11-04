import { once } from "node:events";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getContent, openContent } from "@/lib/server/content";
import { MEDIA_SERVE_MAX } from "@/lib/content";
import { mediaFiles } from "@/lib/server/content-media";
import { bad, open } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * One media file of a content item, for the sheet's preview (fetched with the token, shown as a
 * blob URL). `?id=<item>&i=<index>&n=<name>`: the path is the item's `media_path` in the DB; nothing
 * in the request names a file. `n` must match the file now at `i` (a folder that gained a file since
 * the list shifts the indexes: 409 instead of the wrong picture). Streamed, never held whole.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const q = new URL(req.url).searchParams;
  const id = Number(q.get("id"));
  const i = Number(q.get("i") ?? "0");
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(i) || i < 0) return bad("id, i: số", 400);
  const c = openContent();
  if ("configured" in c || "error" in c) return bad("chưa có DB nội dung", 404);
  const item = getContent(c.db, id);
  const file = item ? mediaFiles(item.media_path)[i] : undefined;
  if (!file) return bad("not found", 404);
  const name = q.get("n");
  if (name !== null && name !== file.name) return bad("thư mục media vừa đổi, tải lại", 409);
  if (file.size > MEDIA_SERVE_MAX) return bad(`file quá ${MEDIA_SERVE_MAX / 1024 / 1024} MB để xem trên HQ`, 413);
  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(file.path);
    await once(stream, "open");
  } catch {
    return bad("not found", 404);
  }
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": file.type,
      "content-length": String(file.size),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
