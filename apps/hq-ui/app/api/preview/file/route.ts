import fs from "node:fs";
import { Readable } from "node:stream";
import { bad, open } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { findPreview } from "@/lib/server/preview";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** One image by the id `/api/preview` listed; anything else (a path, a stale id) is 404. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = new URL(req.url).searchParams.get("id");
  const hit = findPreview(id, liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)));
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
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
