import { deniedText } from "@/lib/access";
import { bad, json, open, readBody } from "@/lib/server/http";
import { projectFor, startBuild, trailCommand } from "@/lib/server/trail";

export const runtime = "nodejs";

/** `{ project }`: start `trail build` in a registered project (owner only; progress on GET /api/codemap). */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  // The route table already keeps guests out; a build writes to the repo, so say it here too.
  if (o.access.role !== "owner") return bad(deniedText(o.access.role), 403);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const p = projectFor(o.db, body.project);
  if (!p.ok) return bad(p.error, p.status);
  if (!trailCommand()) return bad("không tìm thấy lệnh trail trên máy này (PATH của HQ)", 503);
  const b = startBuild(p.project);
  return "status" in b ? bad(b.error, b.status) : json({ build: b }, 202);
}
