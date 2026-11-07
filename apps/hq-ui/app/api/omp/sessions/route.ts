import { isOmpModel } from "@/lib/omp-workspace";
import { bad, json, open, readBody } from "@/lib/server/http";
import { existingDir, forgetOmpSessions, listOmpSessions } from "@/lib/server/omp-sessions";
import { createOmpSession } from "@/lib/server/omp-create";
import { allOmpSessions, forgetOmpTree } from "@/lib/server/omp-tree";
import { ompRoom, resetFloorCache } from "@/lib/server/floor";
import { isOmpRoomId } from "@/lib/labels";
import { run } from "@/lib/server/proc";

export const runtime = "nodejs";

/**
 * ?cwd=<absolute folder>: its omp sessions, rows of `8sync . ls --json` run there.
 * ?all=1: every omp session on the machine for the sidebar tree (folder, state, sub-sessions).
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const q = new URL(req.url).searchParams;
  if (q.get("all") === "1") return json({ sessions: await allOmpSessions(o.db) });
  const cwd = existingDir(q.get("cwd"));
  if (!cwd) return bad("cwd phải là một thư mục có thật", 422);
  return json({ cwd, sessions: await listOmpSessions(cwd) });
}

/**
 * `{cwd, name, model?, worktree?, prompt?, files?}`: a new (or existing) omp session `name` of folder `cwd`
 * (lib/server/omp-create.ts). `model`: any `<provider>/<model>[:level]` the workspace composer typed.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("body must be a JSON object", 422);
  const model = body.model === undefined || body.model === null || body.model === "" ? null : body.model;
  if (model !== null && !isOmpModel(model)) return bad("model không hợp lệ (vd zai/glm-5.3)", 422);
  return createOmpSession(req, o, body, model);
}

/**
 * ?id=<omp room id>: "Xóa phiên" — `8sync . rm <name> --purge` in the session's repo: transcript
 * deleted, a clean worktree removed. Refused (409, the CLI's reason) when its worktree has
 * uncommitted changes or an omp in another terminal has it open; HQ's own host for it is ended.
 * The name and folder come from `8sync ls`, never from the client.
 */
export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !isOmpRoomId(id)) return bad("id phải là id phiên omp", 422);
  const cwd = (await ompRoom(o.db, id))?.cwd;
  if (!cwd) return bad("không thấy phiên này", 404);
  const row = (await listOmpSessions(cwd)).find((r) => r.inbox_id === id);
  if (!row) return bad("không thấy phiên này", 404);
  const r = await run("8sync", [".", "rm", row.name, "--purge"], 30_000, cwd);
  forgetOmpSessions(cwd);
  resetFloorCache();
  forgetOmpTree();
  if (!r.ok) return bad((r.stderr || r.stdout).trim().split("\n").pop()?.replace(/^Error:\s*/, "") || "8sync . rm lỗi", 409);
  return json({ ok: true, name: row.name });
}
