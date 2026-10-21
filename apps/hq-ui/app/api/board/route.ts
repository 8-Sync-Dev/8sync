import { projectBoards } from "@/lib/server/board";
import { json, open } from "@/lib/server/http";
import { projectsInView } from "@/lib/server/in-view";

export const runtime = "nodejs";

/** The lanes of every project with a live room or a team (`8sync ccc auto board --json` in its root). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  // Every root in view, then one row per board 8sync reports (worktrees share; nested repos do not).
  const boards = await projectBoards(await projectsInView(o.db));
  return json({ boards });
}
