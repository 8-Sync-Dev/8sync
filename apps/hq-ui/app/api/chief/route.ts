import type { DatabaseSync } from "node:sqlite";
import { liveRooms } from "@/lib/server/brief";
import { normChief, readChief, writeChief, type ChiefView } from "@/lib/server/chief";
import { bad, json, open, readBody } from "@/lib/server/http";

export const runtime = "nodejs";

async function view(db: DatabaseSync): Promise<ChiefView> {
  const cfg = readChief();
  const rooms = (await liveRooms(db)).map((r) => ({ id: r.name, label: r.label, project: r.project?.name ?? null, engine: r.engine === "omp" ? ("omp" as const) : ("claude" as const), status: r.status }));
  return { cfg, live: !!cfg.room && rooms.some((r) => r.id === cfg.room), rooms };
}

/** Chief of Staff: `{cfg: {room, on}, live, rooms: [{id, label, project, engine, status}]}` (rooms = what the picker offers). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(await view(o.db));
}

/** `{room?, on?}`: fields left out keep their value, `room: null` clears it. 422 not a room id / on without a room; 409 room not live. */
export async function PUT(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const before = readChief();
  const n = normChief(await readBody(req), before);
  if (!n.ok) return bad(n.error, 422);
  const cfg = n.value;
  // Picking a room or turning it on needs it live; turning a closed room's chief off never does.
  if (cfg.room && (cfg.room !== before.room || cfg.on)) {
    const room = (await liveRooms(o.db)).find((r) => r.name === cfg.room || r.session_id === cfg.room);
    if (!room) return bad("Phòng này không đang mở: chọn một phòng đang chạy", 409);
    cfg.room = room.name;
  }
  writeChief(cfg);
  return json(await view(o.db));
}
