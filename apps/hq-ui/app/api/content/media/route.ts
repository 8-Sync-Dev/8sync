import { once } from "node:events";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getContent, openContent } from "@/lib/server/content";
import { byteRange, mediaFiles, mediaSigValid } from "@/lib/server/content-media";
import { bad, open } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * One media file of a content item. `?id=<item>&i=<index>&n=<name>`: the path is the item's
 * `media_path` in the DB; nothing in the request names a file. `n` must match the file now at `i` (a
 * folder that gained a file since the list shifts the indexes: 409 instead of the wrong picture).
 *
 * Auth: the `x-hq-token` header, or the signed URL the list hands out (`&s=<size>&e=<expiry>&sig=`,
 * lib/server/content-media.ts publicMedia) so `<video src>`, `<img src>` and the "Tải" link work as
 * plain browser requests. Streamed from disk, never held whole, any size: `Range: bytes=` answers 206
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
  const headers: Record<string, string> = {
    "content-type": file.type,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  if (q.get("dl") === "1") headers["content-disposition"] = attachment(file.name);
  const range = byteRange(req.headers.get("range"), file.size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${file.size}` } });
  let stream: fs.ReadStream;
  try {
    stream = range ? fs.createReadStream(file.path, { start: range.start, end: range.end }) : fs.createReadStream(file.path);
    await once(stream, "open");
  } catch {
    return bad("not found", 404);
  }
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  if (!range) return new Response(body, { headers: { ...headers, "content-length": String(file.size) } });
  return new Response(body, {
    status: 206,
    headers: { ...headers, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${file.size}` },
  });
}

/** `attachment` with an ASCII fallback name and the real UTF-8 one (RFC 6266 / 5987). */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
