import { bad, json, limitParam, localOnly, open, readBody } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { ARTIFACT_LIST_MAX, listArtifacts, registerArtifact } from "@/lib/server/artifacts";

export const runtime = "nodejs";

/** Artifacts, newest first. `?root=` one repo (worktrees folded in), `?session=` one room, `?limit=` 1..500. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const limit = limitParam(url, 200, ARTIFACT_LIST_MAX);
  if (limit === null) return bad("limit must be 1-500");
  const artifacts = listArtifacts(o.db, { root: url.searchParams.get("root"), session: url.searchParams.get("session"), limit });
  return json({ artifacts, at: Date.now() });
}

/**
 * `{path, title?, note?, session?}`: register a file a room made (same path again = update, same id).
 * Only from this machine's side: a path names a file on disk, the `--public` link never sends one.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const no = localOnly(req, "Chỉ đăng artifact từ máy chủ (không qua link --public).");
  if (no) return no;
  const b = await readBody(req);
  if (!b) return bad("body must be a JSON object", 422);
  const r = registerArtifact(o.db, b, await knownRoots(o.db));
  if (!r.ok) return bad(r.error, r.status);
  return json({ artifact: r.artifact, created: r.created }, r.created ? 201 : 200);
}
