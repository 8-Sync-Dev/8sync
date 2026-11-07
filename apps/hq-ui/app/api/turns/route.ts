import { botNames } from "@/lib/bots";
import { isOmpRoomId } from "@/lib/labels";
import { readActivity, readOmpActivity } from "@/lib/server/activity";
import { findRoom, liveRooms, logOf } from "@/lib/server/brief";
import { ompTranscript } from "@/lib/server/floor";
import { bad, json, open } from "@/lib/server/http";
import { TURNS_MAX } from "@/lib/room-turns";

export const runtime = "nodejs";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Another bot's last turns, what it was asked and what it answered in full (`output` up to 8 000 chars,
 * secrets masked: lib/server/activity.ts): `?room=` a live room's address, session id, label or the name
 * the Bots view gives it ("clean"), or an ended session's id / omp room id; `&n=` 1–20 (default 5).
 * `{room: {id, label} | null, turns}`; 404 when nothing has that name. `hq.mjs turns` and the "Trả lời từ B"
 * cards read it. Read-only, from the transcripts HQ already reads (cached per size + mtime).
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const q = new URL(req.url).searchParams;
  const id = (q.get("room") ?? "").trim();
  if (!id || id.length > 200) return bad("room: id, nhãn hoặc tên của một bot", 422);
  const raw = Number(q.get("n") ?? 5);
  const n = Number.isInteger(raw) && raw >= 1 ? Math.min(raw, TURNS_MAX) : 5;
  const rooms = await liveRooms(o.db);
  let room = findRoom(rooms, id) ?? null;
  if (!room) {
    const names = botNames(rooms);
    const named = rooms.filter((r) => names.get(r.key)?.name.toLowerCase() === id.toLowerCase());
    room = named.length === 1 ? named[0] : null;
  }
  if (room) {
    const log = await logOf(o.db, room);
    return json({ room: { id: room.name, label: room.label }, turns: (log?.turns ?? []).slice(-n), at: Date.now() });
  }
  if (SESSION_ID.test(id)) return json({ room: null, turns: readActivity(id, null, 1).turns.slice(-n), at: Date.now() });
  const file = isOmpRoomId(id) ? await ompTranscript(o.db, id) : undefined;
  if (file === undefined) return bad(`không có bot nào tên/id ${id.slice(0, 80)} (xem hq.mjs roster)`, 404);
  return json({ room: null, turns: file ? readOmpActivity(file, 1).turns.slice(-n) : [], at: Date.now() });
}
