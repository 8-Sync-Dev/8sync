import fs from "node:fs";
import { Readable } from "node:stream";
import { bad, open } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { cachedPreview, findPreview } from "@/lib/server/preview";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** One image by the id `/api/preview` listed; anything else (a path, a stale id) is 404. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  // The grid's own listing answers in O(1); only a stale or unknown id pays for a rescan.
  const hit = cachedPreview(id) ?? findPreview(id, liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)));
  if (!hit) return bad("not found", 404);
  try {
    // Open before answering: a file deleted since the list is a 404, not a broken 200.
    await fs.promises.access(hit.abs, fs.constants.R_OK);
  } catch {
    return bad("not found", 404);
  }
  const stream = Readable.toWeb(fs.createReadStream(hit.abs)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "content-type": hit.type,
      // `v` is the file's mtime: a new screenshot gets a new URL, so the old one may be kept a day.
      "cache-control": /^\d{1,16}$/.test(url.searchParams.get("v") ?? "") ? "private, max-age=86400, immutable" : "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
