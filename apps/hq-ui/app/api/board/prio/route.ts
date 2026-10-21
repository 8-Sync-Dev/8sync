import { parsePrioBody, setCardPrio } from "@/lib/server/board";
import { bad, json, open, readBody } from "@/lib/server/http";
import { knownRoot } from "@/lib/server/in-view";

export const runtime = "nodejs";

/** {root, id, prio: 0..3 | null}: how urgent a card is (`8sync ccc auto prio`), only on a board HQ shows. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const p = parsePrioBody(await readBody(req));
  if (!p.ok) return bad(p.error, 422);
  const root = await knownRoot(o.db, p.value.root);
  if (!root) return bad("dự án này không có trong HQ (không có phòng chạy, team hay thư mục đã thêm)", 409);
  const r = await setCardPrio(root, p.value);
  return json(r, r.ok ? 200 : 502);
}
