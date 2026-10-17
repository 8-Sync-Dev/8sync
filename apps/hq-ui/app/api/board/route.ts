import { projectBoards } from "@/lib/server/board";
import { json, open } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** The lanes of every project with a live room (`8sync ccc auto board --json` in its root). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  // Every live root, then one row per board 8sync reports (worktrees share; nested repos do not).
  const boards = await projectBoards(liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)));
  return json({ boards });
}
