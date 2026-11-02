import { json, open } from "@/lib/server/http";
import { cachedEccx } from "@/lib/server/eccx";
import { listLoops } from "@/lib/server/loops";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/in-view";

export const runtime = "nodejs";

/** `/ship-loop` runs per live project (slug, iterations, last evidence line of LOOP.md) and the installed `/eccx-loop-*`, `/eccx-*` commands. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ projects: listLoops(liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd))), commands: cachedEccx() });
}
