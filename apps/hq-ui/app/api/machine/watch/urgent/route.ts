import { bad, json, open } from "@/lib/server/http";
import { sendUrgent } from "@/lib/server/machine-watch";

export const runtime = "nodejs";

/** "Gửi urgent ngay": scan now and hand the watch room the result, whether or not the watch is on. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const r = await sendUrgent();
  return "sent" in r ? json(r) : bad(r.skipped, 409);
}
