import { json, open } from "@/lib/server/http";
import { cachedEccx } from "@/lib/server/eccx";
import { listLoops } from "@/lib/server/loops";
import { projectsInView } from "@/lib/server/in-view";

export const runtime = "nodejs";

/** `/ship-loop` runs per live project (slug, iterations, last evidence line of LOOP.md) and the installed `/eccx-loop-*`, `/eccx-*` commands. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ projects: listLoops(await projectsInView(o.db)), commands: cachedEccx() });
}
