import { lastAutoStatus } from "@/lib/server/auto";
import { guardView } from "@/lib/server/guard-trigger";
import { awake } from "@/lib/server/awake";
import { json, open } from "@/lib/server/http";
import { machine, spec } from "@/lib/server/machine";
import { power } from "@/lib/server/power";

export const runtime = "nodejs";

/** RAM, CPU, GPU, power and cost, whether the machine stays awake with the screen off, and what the machine is (CPU, RAM, GPU, OS), on the machine running HQ. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const [m, a, s] = await Promise.all([machine(), awake(), spec()]);
  // guard: from the shared auto status (spawns nothing here) plus the fast trigger's state; null on an older 8sync.
  return json({ ...m, power: power(), awake: a, spec: s, guard: guardView(lastAutoStatus()?.guard) });
}
