import { json, open } from "@/lib/server/http";
import { loadOffice } from "@/lib/server/office";

export const runtime = "nodejs";

/** Rooms (one per live session), their specialists, usage and the walks between rooms. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(await loadOffice(o.db));
}
