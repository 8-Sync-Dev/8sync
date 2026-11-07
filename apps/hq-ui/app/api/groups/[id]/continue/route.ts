import { appendGroupLog, groupGuard, readGroups } from "@/lib/server/groups";
import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";

export const runtime = "nodejs";

/**
 * `{turn, extra?}`: the owner lets a turn the loop guard holds go on ("Cho thêm"): its bot→bot count starts
 * over and `extra` (1–10, default the group's maxHops) more hops are allowed. Owner's page only: a bot can
 * never lift its own limit. 404 no such group / turn (an HQ restart forgets turns).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/continue">) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (senderOf(req, o.access).by !== "owner") return bad("Chỉ chủ HQ cho thêm lượt, từ trang HQ", 403);
  const { id } = await ctx.params;
  const g = readGroups().find((x) => x.id === id);
  if (!g) return bad("Không có nhóm này", 404);
  const body = await readBody(req);
  if (!body || typeof body.turn !== "string") return bad("Cần JSON {turn, extra?}", 400);
  const extra = body.extra === undefined ? g.maxHops : body.extra;
  if (typeof extra !== "number" || !Number.isInteger(extra) || extra < 1 || extra > 10) return bad("extra: số nguyên 1–10", 422);
  const now = Date.now();
  const t = groupGuard().continueTurn(body.turn, g.id, extra, now);
  if (!t) return bad("Lượt này không còn (HQ vừa khởi động lại hoặc đã quá 30 phút): nhắn nhóm lượt mới", 404);
  appendGroupLog(g.id, { ts: now, turn: t.turn, kind: "note", from: "owner", to: [], text: `Owner cho thêm ${extra} hop`, hop: 0 });
  return json(t);
}
