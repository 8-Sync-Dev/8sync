import { json, open } from "@/lib/server/http";
import { projectsInView } from "@/lib/server/in-view";
import { listPreviews } from "@/lib/server/preview";

export const runtime = "nodejs";

/** Screenshots of every live project (root, worktrees, main tree) by true time, plus its main tip. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const projects = await listPreviews(await projectsInView(o.db));
  return json({ projects, at: Date.now() });
}
