import { isOmpModel, isOmpSessionName } from "@/lib/omp-workspace";
import { bad, json, open, readBody } from "@/lib/server/http";
import { existingDir, forgetOmpSessions, listOmpSessions, ompIdFor, rememberNew } from "@/lib/server/omp-sessions";

export const runtime = "nodejs";

/** ?cwd=<absolute folder>: its omp sessions, rows of `8sync . ls --json` run there. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const cwd = existingDir(new URL(req.url).searchParams.get("cwd"));
  if (!cwd) return bad("cwd phải là một thư mục có thật", 422);
  return json({ cwd, sessions: await listOmpSessions(cwd) });
}

/**
 * `{cwd, name, model?}`: a new (or existing) omp session `name` of folder `cwd`. Nothing runs yet:
 * the answer's `id` is the session's room id, and opening its terminal (`/api/sessions/<id>/term`)
 * creates it with `8sync ccc term --omp-new` in `cwd`, like `8sync . <name>` there.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("body must be a JSON object", 422);
  const cwd = existingDir(body.cwd);
  if (!cwd) return bad("cwd phải là một thư mục có thật", 422);
  if (!isOmpSessionName(body.name)) return bad("tên phiên: chữ thường, số, '.', '_', '-' (tối đa 48), không trùng ls/rm/mv/merge/new", 422);
  const model = body.model === undefined || body.model === null || body.model === "" ? null : body.model;
  if (model !== null && !isOmpModel(model)) return bad("model không hợp lệ (vd zai/glm-5.3)", 422);
  const id = ompIdFor(cwd, body.name);
  rememberNew(id, { cwd, name: body.name, model });
  forgetOmpSessions(cwd);
  return json({ id, name: body.name, cwd });
}
