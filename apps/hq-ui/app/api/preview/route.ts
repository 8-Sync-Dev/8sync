import { json, open } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { listPreviews } from "@/lib/server/preview";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** Screenshots of every live project (root, worktrees, main tree) by true time, plus its main tip. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const projects = await listPreviews(liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)));
  return json({ projects, at: Date.now() });
}
