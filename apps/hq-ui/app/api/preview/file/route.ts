import { bad, open } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { openPreview } from "@/lib/server/preview";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** One image by the id `/api/preview` listed (a file in a checkout or a blob of the main tree); anything else is 404. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = new URL(req.url).searchParams.get("id");
  const hit = await openPreview(id, liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)));
  if (!hit) return bad("not found", 404);
  return new Response(hit.body, {
    headers: {
      "content-type": hit.type,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
