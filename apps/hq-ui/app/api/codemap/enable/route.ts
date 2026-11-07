import { addProject } from "@/lib/server/db";
import { checkRoot, graphifyCommand, startUpdate, updateState } from "@/lib/server/graphify";
import { bad, json, open, readBody } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { senderOf } from "@/lib/server/sender";
import { buildState, indexStatus, projectFor, startBuild, trailCommand } from "@/lib/server/trail";
import { validateProjectPath } from "@/lib/server/validate";

export const runtime = "nodejs";

/**
 * "Tạo bản đồ code cho repo này" on a bot's Bản đồ code tab. `{ path }`: a repo root HQ already knows
 * (a live or ended room's, or a registered project's; never any other folder) is registered as a
 * project the way POST /api/projects does, then `graphify update . --no-cluster` starts in the
 * background, and `trail build` too when the repo has no trail index yet. `{ project }`: the same
 * for a registered project. Progress on GET /api/codemap and /api/codemap/graphify. 202.
 * The owner's page only: a room (hq.mjs with the UI token) or a guest gets 403.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (senderOf(req, o.access).by !== "owner") return bad("Chỉ chủ HQ tạo bản đồ code, từ trang HQ", 403);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const known = await knownRoots(o.db, { ended: true });
  let id = body.project;
  if (id == null) {
    const v = validateProjectPath(body.path);
    if (!v.ok) return bad(v.error, 422);
    const no = checkRoot(v.value, known);
    if (no) return bad(no.error, no.status);
    id = addProject(o.db, v.value).project.id;
  }
  const p = projectFor(o.db, id);
  if (!p.ok) return bad(p.error, p.status);
  const no = checkRoot(p.project.root, known);
  if (no) return bad(no.error, no.status);

  const notes: string[] = [];
  let update = updateState(p.project.root);
  if (!graphifyCommand()) notes.push("chưa cài graphify trên máy chạy HQ: chạy `8sync setup` để có Giải thích và Đường đi");
  else if (update?.state !== "running") {
    const u = startUpdate(p.project);
    if ("status" in u) notes.push(`graphify: ${u.error}`);
    else update = u;
  }
  let build = buildState(p.project.id);
  if (!trailCommand()) notes.push("không tìm thấy lệnh trail trên máy chạy HQ, nên chưa index được");
  else if (!indexStatus(p.project.root).indexed && build?.state !== "running") {
    const b = startBuild(p.project);
    if ("status" in b) notes.push(`trail: ${b.error}`);
    else build = b;
  }
  return json({ project: p.project, update, build, notes }, 202);
}
