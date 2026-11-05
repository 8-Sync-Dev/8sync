import { checkQuery, isSearchMode, parseAsk, parseGrep } from "@/lib/codemap";
import { bad, json, open } from "@/lib/server/http";
import { askArgs, grepArgs, indexStatus, projectFor, trailJson, trailRead } from "@/lib/server/trail";

export const runtime = "nodejs";

/** `?mode=ask|grep&q=`: `trail ask "<q>"` or `trail grep <pattern>` in a registered project, hits with file:line. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  if (!isSearchMode(mode)) return bad("mode: ask hoặc grep", 422);
  const q = checkQuery(mode, url.searchParams.get("q"));
  if (!q.ok) return bad(q.error, 422);
  const p = projectFor(o.db, url.searchParams.get("project"));
  if (!p.ok) return bad(p.error, p.status);
  if (!indexStatus(p.project.root).indexed) return bad("dự án chưa có code map: bấm Index ngay", 409);
  const root = p.project.root;
  const r = trailJson(await trailRead(root, mode === "ask" ? askArgs(q.value, root) : grepArgs(q.value, root)), mode === "ask" ? parseAsk : parseGrep);
  return r.ok ? json(r.value) : bad(r.error, r.status);
}
