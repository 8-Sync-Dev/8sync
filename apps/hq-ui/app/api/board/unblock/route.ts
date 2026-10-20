import { parsePrioBody, unblockCard } from "@/lib/server/board";
import { bad, json, open, readBody } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** {root, id}: "⚡ Gỡ block ngay", Blocked → Backlog with the owner's note, then P0 (lib/server/board.ts unblockCard). */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const p = parsePrioBody(body && { ...body, prio: 0 });
  if (!p.ok) return bad(p.error, 422);
  const want = p.value.root.toLowerCase();
  const root = liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)).find((x) => x.root.toLowerCase() === want)?.root;
  if (!root) return bad("dự án này không có phòng nào đang chạy", 409);
  const r = await unblockCard(root, p.value.id);
  return json(r, r.ok ? 200 : 502);
}
