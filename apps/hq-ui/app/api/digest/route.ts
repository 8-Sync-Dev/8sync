import { liveRooms, senderRoomOf } from "@/lib/server/brief";
import { currentDigest, digestEntry, digestHash, recordDigest, setDigestOptOut } from "@/lib/server/digest";
import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";

export const runtime = "nodejs";

const roomParam = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 200 ? v.trim() : null);

/**
 * `?room=<id>`: what HQ's "ai đang làm gì" digest holds for that bot (lib/server/digest.ts): `{room, last:
 * {text, at} | null, optOut, now, changed}`: the one it last got, its switch, and the one it would get now
 * (`changed`: now differs from last, so the owner's next message carries it). Read-only, for "Bot này đang biết gì".
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = roomParam(new URL(req.url).searchParams.get("room"));
  if (!id) return bad("room: id của một bot", 422);
  const d = await currentDigest(o.db, id);
  const e = digestEntry(d.room);
  return json({ room: d.room, last: e.text ? { text: e.text, at: e.at } : null, optOut: e.optOut, now: d.text, changed: !!d.text && e.hash !== digestHash(d.text) });
}

/**
 * A bot pulls its digest (`hq.mjs digest`): `{room?}` or, by default, the room hq.mjs runs in (`from_session`
 * / `from_cwd`). Always the whole current text (even with the push switched off: the bot asked), remembered
 * as what it got so the owner's next message does not carry it again. 200 `{room, text, changed}`.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  let id = roomParam(body.room);
  if (!id) {
    const rooms = await liveRooms(o.db).catch(() => []);
    id = senderRoomOf(rooms, { session: body.from_session, cwd: body.from_cwd }, "")?.name ?? null;
  }
  if (!id) return bad("room: không nhận ra phòng đang gọi; ghi rõ id (hq.mjs digest <id>)", 422);
  const d = await currentDigest(o.db, id);
  const changed = !!d.text && digestEntry(d.room).hash !== digestHash(d.text);
  if (d.text && changed) recordDigest(d.room, d.text);
  return json({ room: d.room, text: d.text, changed });
}

/** The owner's switch, page only (403 for a room): `{room, optOut}`; true = no digest under the owner's messages to that bot. */
export async function PUT(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (senderOf(req, o.access).by !== "owner") return bad("Chỉ chủ HQ bật/tắt digest, từ trang HQ", 403);
  const body = await readBody(req);
  const id = roomParam(body?.room);
  if (!id || typeof body?.optOut !== "boolean") return bad("Cần JSON {room, optOut: boolean}", 422);
  const rooms = await liveRooms(o.db).catch(() => []);
  const room = rooms.find((r) => r.name === id || r.session_id === id)?.name ?? id;
  return json({ room, ...setDigestOptOut(room, body.optOut) });
}
