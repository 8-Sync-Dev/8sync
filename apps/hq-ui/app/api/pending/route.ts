import { json, open } from "@/lib/server/http";
import { listPending } from "@/lib/server/pending";

export const runtime = "nodejs";

/** Questions / permission prompts rooms wait on right now (contract C5), soonest deadline first. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ pending: listPending(), now: Date.now() });
}
