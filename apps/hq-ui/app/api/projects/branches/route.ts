import { json, open } from "@/lib/server/http";
import { repoWorktrees } from "@/lib/server/branches";
import { allOmpSessions } from "@/lib/server/omp-tree";
import { projectRoots } from "@/lib/server/project-ops";
import { groupKey } from "@/lib/sidebar";

export const runtime = "nodejs";

/**
 * Every git worktree of the projects HQ knows (the sidebar's branches): `{repos: [{main, worktrees:
 * [{path, branch, head, bare, locked}]}]}`, main worktree first. `?fresh=1` skips the 20 s cache.
 * Roots = HQ's project roots plus every omp session folder of the sidebar tree (`8sync ls --all`),
 * which HQ's own session list does not hold.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const [{ roots }, omp] = await Promise.all([projectRoots(o.db), allOmpSessions(o.db).catch(() => [])]);
  for (const s of omp) if (s.cwd && !roots.has(groupKey(s.cwd))) roots.set(groupKey(s.cwd), s.cwd);
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return json({ repos: await repoWorktrees([...roots.values()], { fresh }) });
}
