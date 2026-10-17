import { json, open } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { listPreviews } from "@/lib/server/preview";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** Screenshots under the preview folders of every live project and its worktrees, newest first. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const projects = listPreviews(liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)));
  return json({ projects, at: Date.now() });
}
