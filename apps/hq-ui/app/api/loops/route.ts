import { json, open } from "@/lib/server/http";
import { listLoops } from "@/lib/server/loops";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** `/ship-loop` runs per live project: slug, iterations, last evidence line of LOOP.md. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ projects: listLoops(liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd))) });
}
