import { getDb } from "@/lib/server/db";
import { loadFloor } from "@/lib/server/floor";
import { bad, json, open, readBody } from "@/lib/server/http";
import { normWatch, readWatch, watchChanged, watchRooms, watchStatus, writeWatch } from "@/lib/server/machine-watch";

export const runtime = "nodejs";

async function view() {
  const cfg = readWatch();
  const rooms = watchRooms(await loadFloor(getDb())).map((r) => ({ id: r.inbox_id as string, name: r.name, title: r.title, repo: r.repo ?? null, engine: r.engine ?? null }));
  return { cfg, status: watchStatus(cfg), rooms };
}

/** "Canh máy": the settings, when it last looked / sent, and the rooms it can hand the machine to. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(await view());
}

/** `{on?, room?, everyMin?, cpu?, ram?, gpu?, observe?, observeSkip?}`: fields left out keep their value. */
export async function PUT(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("Cần JSON", 422);
  const before = readWatch();
  const cfg = normWatch(body, before);
  if (cfg.on && !cfg.room) return bad("Chọn phòng canh máy trước khi bật", 422);
  writeWatch(cfg);
  if (cfg.room !== before.room || cfg.everyMin !== before.everyMin || cfg.on !== before.on) watchChanged();
  return json(await view());
}
