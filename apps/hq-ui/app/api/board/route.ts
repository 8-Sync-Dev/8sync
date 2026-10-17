import { readBoard, type ProjectBoard } from "@/lib/server/board";
import { json, open } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects, outermost } from "@/lib/server/targets";

export const runtime = "nodejs";

/** The lanes of every project with a live room (`8sync ccc auto board --json` in its root). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const projects = outermost(liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)));
  const boards: ProjectBoard[] = await Promise.all(projects.map((p) => readBoard(p)));
  return json({ boards });
}
