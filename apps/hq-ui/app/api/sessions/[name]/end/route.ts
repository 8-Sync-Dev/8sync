import { bad, json, open, readBody } from "@/lib/server/http";
import { endRoom, isRoomAction } from "@/lib/server/room-end";

export const runtime = "nodejs";

/**
 * {action: "close" | "delete"}: the sidebar's "Đóng phòng" / "Xóa phòng" (lib/server/room-end.ts).
 * The room must be one HQ lists; nothing in the request reaches a command line except through it.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/end">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  const body = await readBody(req);
  const action = body?.action;
  if (!isRoomAction(action)) return bad("cần {action: close | delete}", 422);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(name)) return bad("tên phòng không hợp lệ", 422);
  const r = await endRoom(o.db, name, action);
  return json(r.body, r.status);
}
