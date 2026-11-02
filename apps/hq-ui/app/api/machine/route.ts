import { awake } from "@/lib/server/awake";
import { json, open } from "@/lib/server/http";
import { history } from "@/lib/server/history";
import { heavy, machine, spec } from "@/lib/server/machine";
import { power } from "@/lib/server/power";

export const runtime = "nodejs";

/** RAM, CPU, GPU, power and cost, whether the machine stays awake with the screen off, what the machine is (CPU, RAM, GPU, OS), and renderers holding ≥ 4 GB (`heavy`, null on an older 8sync), on the machine running HQ. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const [m, a, s, h] = await Promise.all([machine(), awake(), spec(), heavy()]);
  return json({ ...m, power: power(), awake: a, spec: s, history: history(), heavy: h });
}
