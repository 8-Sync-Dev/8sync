import { bad, json, open, readBody } from "@/lib/server/http";
import { closeProject, hideProject, looksLikeWorktree, projectRoots, showProject } from "@/lib/server/project-ops";
import { groupKey } from "@/lib/sidebar";

export const runtime = "nodejs";

/**
 * No query: which project roots HQ knows are git worktrees (their "⋯" menu gets "Xóa worktree").
 * `?root=`: what "Đóng dự án" would stop there (`8sync ccc auto close --dry-run --json`, read-only).
 * Closed projects ride on /api/office.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { roots } = await projectRoots(o.db);
  const root = new URL(req.url).searchParams.get("root");
  if (root == null) return json({ worktrees: [...roots.entries()].filter(([, r]) => looksLikeWorktree(r)).map(([key]) => key) });
  if (!root || root.length > 4096) return bad("cần ?root=", 422);
  const known = roots.get(groupKey(root));
  if (!known) return bad("dự án này không có trong HQ", 409);
  const r = await closeProject(known, true);
  return r.ok ? json({ plan: r.plan }) : json({ error: r.error }, 502);
}

/**
 * {root, hidden: true, kill: true}: close a project HQ knows for real — `8sync ccc auto close` in its
 * root stops every room, session and leftover process — then hide it (it comes back on new
 * activity). A close that fails hides nothing: the error goes back with what did stop.
 * {root, hidden: true}: hide only (the dialog's way out when the close failed).
 * {root, hidden: false}: show it again; only drops HQ's own row, so any string key is harmless.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const root = typeof body?.root === "string" ? body.root : "";
  const kill = body?.kill ?? false;
  if (!root || root.length > 4096 || typeof body?.hidden !== "boolean" || typeof kill !== "boolean" || (kill && !body.hidden)) {
    return bad("cần {root, hidden: true | false, kill?: boolean} (kill chỉ đi cùng hidden: true)", 422);
  }
  if (!body.hidden) return json({ ok: true, shown: showProject(o.db, groupKey(root)) });
  const known = (await projectRoots(o.db)).roots.get(groupKey(root));
  if (!known) return bad("dự án này không có trong HQ", 409);
  if (!kill) return json({ ok: true, hidden: hideProject(o.db, known) });
  const r = await closeProject(known, false);
  if (!r.ok) return json({ error: r.error, close: r.plan }, r.busy ? 409 : 502);
  return json({ ok: true, hidden: hideProject(o.db, known), close: r.plan });
}
