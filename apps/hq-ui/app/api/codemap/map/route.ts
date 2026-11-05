import { parseMap } from "@/lib/codemap";
import { bad, json, open } from "@/lib/server/http";
import { indexStatus, mapArgs, projectFor, trailJson, trailRead } from "@/lib/server/trail";

export const runtime = "nodejs";

/** `trail map --json` of a registered project: modules → folders/files → symbol counts, hotspots. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const p = projectFor(o.db, new URL(req.url).searchParams.get("project"));
  if (!p.ok) return bad(p.error, p.status);
  if (!indexStatus(p.project.root).indexed) return bad("dự án chưa có code map: bấm Index ngay", 409);
  const r = trailJson(await trailRead(p.project.root, mapArgs(p.project.root)), parseMap);
  return r.ok ? json({ map: r.value }) : bad(r.error, r.status);
}
