import { briefOf, liveRooms } from "@/lib/server/brief";
import { deliverOrWaiting } from "@/lib/server/deliver";
import { appendForward, forwardsFrom, forwardText } from "@/lib/server/forward";
import { groupGuard } from "@/lib/server/groups";
import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";
import { clampText } from "@/lib/server/validate";

export const runtime = "nodejs";

/** `?room=<A>`: the forwards the owner made from A's thread (newest 20), for its "Trả lời từ B" cards. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const room = new URL(req.url).searchParams.get("room");
  if (!room || room.length > 200) return bad("room: id phòng", 422);
  return json({ forwards: forwardsFrom(room) });
}

/**
 * `{from: A, to: B, text}`: the owner, in A's thread, wrote to B (lib/server/forward.ts): B gets the
 * owner's words with A's context line and brief; A gets nothing. Owner's page only (the words are the
 * owner's). 201 `{forward, delivery, error}`; 409 session-waiting / a room not live; 422 bad field.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const sender = senderOf(req, o.access);
  if (sender.by !== "owner") return bad("Chỉ chủ HQ chuyển tin giữa các bot, từ trang HQ", 403);
  const body = await readBody(req);
  if (!body || typeof body.from !== "string" || typeof body.to !== "string") return bad("Cần JSON {from, to, text}", 400);
  const text = clampText(body.text, 3000);
  if (!text.ok) return bad(text.error, 422);
  const rooms = await liveRooms(o.db);
  const pick = (id: string) => rooms.find((r) => r.status !== "ended" && (r.name === id || r.session_id === id));
  const from = pick(body.from);
  const to = pick(body.to);
  if (!from || !to) return bad("Bot này không còn mở", 409);
  if (from.name === to.name) return bad("to: một bot khác", 422);
  const r = await deliverOrWaiting(o.db, to.name, forwardText(text.value, await briefOf(from, o.db)), sender);
  if (r.waiting) return json({ error: "session-waiting", dialog: r.dialog }, 409);
  groupGuard().leave(to.name);
  const forward = { ts: Date.now(), from: from.name, to: to.name, text: text.value };
  appendForward(forward);
  return json({ forward, delivery: r.delivery, error: r.error }, 201);
}
