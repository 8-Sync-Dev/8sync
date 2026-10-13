import { json, open } from "@/lib/server/http";
import { loadFloor } from "@/lib/server/floor";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ rows: await loadFloor(o.db) });
}
