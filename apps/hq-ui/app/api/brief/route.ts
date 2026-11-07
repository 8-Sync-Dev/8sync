import { bad, json, open } from "@/lib/server/http";
import { briefOf, findRoom, liveRooms, roster } from "@/lib/server/brief";

export const runtime = "nodejs";

/**
 * What each live room is on (lib/server/brief.ts): `{rooms: Brief[], at}`, or with `?room=<id>`
 * (address, session id or a unique label) `{brief: Brief, at}`; 404 when no live room has it.
 * Read-only; `hq.mjs brief` / `roster`, the Chief of Staff and the Bots view read it.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = new URL(req.url).searchParams.get("room");
  if (id == null) return json({ rooms: await roster(o.db), at: Date.now() });
  if (!id.trim() || id.length > 200) return bad("room: a live room's id", 422);
  const room = findRoom(await liveRooms(o.db), id.trim());
  if (!room) return bad(`không có phòng nào đang mở tên/id ${id.trim().slice(0, 80)}`, 404);
  return json({ brief: await briefOf(room, o.db), at: Date.now() });
}
