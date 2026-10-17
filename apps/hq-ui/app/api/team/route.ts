import { withMissing, type ProjectRow } from "@/lib/server/db";
import { bad, json, open, readBody } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";
import { isTeamAction, runTeam } from "@/lib/server/team";

export const runtime = "nodejs";

/**
 * {root, action: "up" | "clean" | "down"}: the team of one project (`8sync ccc auto up|down`).
 * Only a root HQ shows (a project with a live room, or a folder added in the sidebar), never an arbitrary path.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const root = typeof body?.root === "string" ? body.root : "";
  const action = body?.action;
  if (!root || !isTeamAction(action)) return bad("cần {root, action: up | clean | down}", 422);
  const live = liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)).map((p) => p.root);
  const added = withMissing(o.db.prepare("SELECT id, path, name, added_at FROM projects").all() as ProjectRow[])
    .filter((p) => !p.missing)
    .map((p) => p.path);
  const want = root.toLowerCase();
  const known = [...live, ...added].find((r) => r.toLowerCase() === want);
  if (!known) return bad("thư mục này không có trong HQ: thêm nó ở mục Projects trước", 409);
  const r = await runTeam(known, action);
  return json(r, r.ok ? 200 : r.busy ? 409 : 502);
}
