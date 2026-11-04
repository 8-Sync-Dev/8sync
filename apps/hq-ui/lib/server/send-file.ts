// One file from disk as an HTTP answer, for the routes that hand media to `<video>`, `<img>` and the
// "Tải" links (content media, chat attachments). Streamed, never held whole, any size.
import { once } from "node:events";
import fs from "node:fs";
import { Readable } from "node:stream";
import { bad } from "./http";

export type SentFile = { path: string; name: string; type: string; size: number };

/**
 * One `Range: bytes=…` of a `size`-byte file as inclusive [start, end]. null = no usable range header
 * (absent, another unit, several ranges, or invalid like `5-3`): answer 200 with the whole file,
 * which RFC 9110 allows. "unsatisfiable" = a single byte range outside the file: 416.
 */
export function byteRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (m[2] !== "" && Number(m[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return { start, end };
}

/** `attachment` with an ASCII fallback name and the real UTF-8 one (RFC 6266 / 5987). */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * `file` as the answer to `req`: `Range: bytes=` gets 206 with just that slice (a player seeks without
 * pulling the file), an out-of-file range 416; `download` adds `Content-Disposition: attachment` with
 * the file's name. 404 when the file went away between the lookup and the open.
 */
export async function sendFile(req: Request, file: SentFile, { download, cache }: { download: boolean; cache: string }): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": file.type,
    "accept-ranges": "bytes",
    "cache-control": cache,
    "x-content-type-options": "nosniff",
  };
  if (download) headers["content-disposition"] = attachment(file.name);
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
