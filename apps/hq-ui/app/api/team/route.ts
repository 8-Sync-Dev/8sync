import { withMissing, type ProjectRow } from "@/lib/server/db";
import { bad, json, open, readBody } from "@/lib/server/http";
import { lastAutoStatus } from "@/lib/server/auto";
import { projectOf, readPins } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { runBlocked } from "@/lib/server/power";
import { liveProjects } from "@/lib/server/targets";
import { isTeamAction, runTeam, TASK_MAX } from "@/lib/server/team";

export const runtime = "nodejs";

/**
 * {root, action: "up" | "full" | "boost" | "unboost" | "clean" | "down"}: the team of one project
 * (`8sync ccc auto up|down`; unboost = `auto down --only <boost-only rooms>`).
 * Only a root HQ shows (a project with a live room, or a folder added in the sidebar), never an arbitrary path.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const root = typeof body?.root === "string" ? body.root : "";
  const action = body?.action;
  if (!root || !isTeamAction(action)) return bad("cần {root, action: up | full | boost | unboost | clean | down}", 422);
  // Optional first task (the new project's spec): a card on the board before the rooms start.
  const task = body?.task;
  if (task != null && (typeof task !== "string" || Array.from(task).length > TASK_MAX)) return bad(`task: chuỗi, tối đa ${TASK_MAX} ký tự`, 422);
  // Boost renews the owner lease like Run: over today's electricity budget it stays off (lib/server/power.ts).
  const blocked = action === "boost" ? runBlocked() : null;
  if (blocked) return bad(blocked, 409);
  const live = liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)).map((p) => p.root);
  const added = withMissing(o.db.prepare("SELECT id, path, name, added_at FROM projects").all() as ProjectRow[])
    .filter((p) => !p.missing)
    .map((p) => p.path);
  // Also a pinned project and one in auto's scope or team roots: the sidebar shows them with 0 rooms,
  // and "Mở team" there must work (owner 2026-10-22: ide pinned, team gone, no button).
  const st = lastAutoStatus();
  const listed = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const extraRoots = [...readPins().map((p) => p.root), ...listed(st?.repos), ...listed(st?.team_roots)].map((r) => r.replace(/^\\\\\?\\/, ""));
  const norm = (r: string) => r.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const want = norm(root);
  const known = [...live, ...added, ...extraRoots].find((r) => norm(r) === want);
  if (!known) return bad("thư mục này không có trong HQ: thêm nó ở mục Projects trước", 409);
  const r = await runTeam(known, action, typeof task === "string" ? task : null);
  return json(r, r.ok ? 200 : r.busy ? 409 : 502);
}
