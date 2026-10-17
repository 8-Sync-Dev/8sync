import { parsePrioBody, setCardPrio } from "@/lib/server/board";
import { bad, json, open, readBody } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** {root, id, prio: 0..3 | null}: how urgent a card is (`8sync ccc auto prio`), only on a board HQ shows. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const p = parsePrioBody(await readBody(req));
  if (!p.ok) return bad(p.error, 422);
  const want = p.value.root.toLowerCase();
  const root = liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)).find((x) => x.root.toLowerCase() === want)?.root;
  if (!root) return bad("dự án này không có phòng nào đang chạy", 409);
  const r = await setCardPrio(root, p.value);
  return json(r, r.ok ? 200 : 502);
}
