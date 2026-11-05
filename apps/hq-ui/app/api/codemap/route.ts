import type { CodemapStatus } from "@/lib/codemap";
import { bad, json, open } from "@/lib/server/http";
import { buildState, graphInfo, indexStatus, projectFor, trailCommand } from "@/lib/server/trail";

export const runtime = "nodejs";

/** "Bản đồ code" of one registered project (`?project=<id>`): index state, the running build, graphify. No `trail` run. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const p = projectFor(o.db, new URL(req.url).searchParams.get("project"));
  if (!p.ok) return bad(p.error, p.status);
  const g = graphInfo(p.project.root);
  const status: CodemapStatus = {
    project: p.project,
    trail: trailCommand() !== null,
    index: indexStatus(p.project.root),
    build: buildState(p.project.id),
    graph: { dir: g.dir, html: g.html && { size: g.html.size, mtime: g.html.mtime } },
  };
  return json(status);
}
