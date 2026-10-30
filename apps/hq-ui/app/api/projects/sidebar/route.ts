import { bad, json, open, readBody } from "@/lib/server/http";
import { hideProject, looksLikeWorktree, projectRoots, showProject } from "@/lib/server/project-ops";
import { groupKey } from "@/lib/sidebar";

export const runtime = "nodejs";

/** Which project roots HQ knows are git worktrees (their "⋯" menu gets "Xóa worktree"). Closed projects ride on /api/office. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { roots } = await projectRoots(o.db);
  return json({ worktrees: [...roots.entries()].filter(([, r]) => looksLikeWorktree(r)).map(([key]) => key) });
}

/**
 * {root, hidden: true}: hide a project HQ knows (it comes back on new activity).
 * {root, hidden: false}: show it again; only drops HQ's own row, so any string key is harmless.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const root = typeof body?.root === "string" ? body.root : "";
  if (!root || root.length > 4096 || typeof body?.hidden !== "boolean") return bad("cần {root, hidden: true | false}", 422);
  if (!body.hidden) return json({ ok: true, shown: showProject(o.db, groupKey(root)) });
  const known = (await projectRoots(o.db)).roots.get(groupKey(root));
  if (!known) return bad("dự án này không có trong HQ", 409);
  return json({ ok: true, hidden: hideProject(o.db, known) });
}
