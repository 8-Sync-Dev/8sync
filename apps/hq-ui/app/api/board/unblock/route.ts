import { parsePrioBody, unblockCard } from "@/lib/server/board";
import { bad, json, open, readBody } from "@/lib/server/http";
import { knownRoot } from "@/lib/server/in-view";

export const runtime = "nodejs";

/** {root, id}: "⚡ Gỡ block ngay", Blocked → Backlog with the owner's note, then P0 (lib/server/board.ts unblockCard). */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const p = parsePrioBody(body && { ...body, prio: 0 });
  if (!p.ok) return bad(p.error, 422);
  const root = await knownRoot(o.db, p.value.root);
  if (!root) return bad("dự án này không có trong HQ (không có phòng chạy, team hay thư mục đã thêm)", 409);
  const r = await unblockCard(root, p.value.id);
  return json(r, r.ok ? 200 : 502);
}
