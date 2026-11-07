import { mentionBots } from "@/lib/bot-mention";
import { liveRooms, roster } from "@/lib/server/brief";
import { chiefAsk, readChief } from "@/lib/server/chief";
import { deliverOrWaiting } from "@/lib/server/deliver";
import { groupSend, type Delivered } from "@/lib/server/group-send";
import { appendGroupLog, GROUP_TEXT_MAX, groupGuard, readGroups } from "@/lib/server/groups";
import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";
import { clampText } from "@/lib/server/validate";

export const runtime = "nodejs";

/**
 * `{text}` from the owner to a group (lib/server/group-send.ts groupSend): the @-named members get it, or
 * the Chief of Staff in "chief" mode. Owner's page only: a room never speaks for the owner to a group.
 * 201 `{turn, delivered, held, notMembers, unknown, chief}`; 404 no such group; 422 bad text.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/send">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const sender = senderOf(req, o.access);
  if (sender.by !== "owner") return bad("Chỉ chủ HQ nhắn nhóm, từ trang HQ", 403);
  const { id } = await ctx.params;
  const g = readGroups().find((x) => x.id === id);
  if (!g) return bad("Không có nhóm này", 404);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  // GROUP_TEXT_MAX: under the Chief of Staff's 2 500 (it adds the group line and the room list).
  const text = clampText(body.text, GROUP_TEXT_MAX);
  if (!text.ok) return bad(text.error, 422);
  const rooms = await liveRooms(o.db).catch(() => []);
  const cfg = readChief();
  const r = await groupSend(g, text.value, {
    guard: groupGuard(),
    bots: mentionBots(rooms),
    deliver: (room, t) => deliverOrWaiting(o.db, room, t, sender),
    chief:
      cfg.on && cfg.room
        ? async (t, members) => {
            const a = await chiefAsk(t, {
              cfg,
              roster: async () => (await roster(o.db)).filter((b) => b.id === cfg.room || b.session_id === cfg.room || members.includes(b.id)),
              send: (room, m) => deliverOrWaiting(o.db, room, m, sender),
            });
            return a.status === 201 ? { room: a.room, result: a.result as Delivered } : { error: a.error };
          }
        : null,
    log: (e) => appendGroupLog(g.id, e),
  });
  return json(r, 201);
}
