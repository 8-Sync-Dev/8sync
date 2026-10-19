import { bad, json, open, readBody } from "@/lib/server/http";
import { projectRoots, removeWorktree, showProject, worktreeFacts } from "@/lib/server/project-ops";
import { groupKey } from "@/lib/sidebar";
import { worktreeVerdict } from "@/lib/worktree";

export const runtime = "nodejs";

/** `?root=`: what removing this worktree would hit (the confirm dialog). Read-only git. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const root = new URL(req.url).searchParams.get("root") ?? "";
  if (!root || root.length > 4096) return bad("cần ?root=", 422);
  const { roots, live } = await projectRoots(o.db);
  const known = roots.get(groupKey(root));
  if (!known) return bad("dự án này không có trong HQ", 409);
  const facts = await worktreeFacts(known, live);
  return json({ facts, verdict: worktreeVerdict(facts) });
}

/** {root}: `git worktree remove` a project HQ knows, after every guard passes again. Never `--force`. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const root = typeof body?.root === "string" ? body.root : "";
  if (!root || root.length > 4096) return bad("cần {root}", 422);
  const { roots, live } = await projectRoots(o.db);
  const known = roots.get(groupKey(root));
  if (!known) return bad("dự án này không có trong HQ", 409);
  const r = await removeWorktree(known, live);
  if (r.ok) {
    showProject(o.db, groupKey(known));
    return json(r);
  }
  return json({ error: r.error, verdict: r.verdict ?? null }, r.verdict || r.busy ? 409 : 502);
}
