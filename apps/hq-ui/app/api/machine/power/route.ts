import { bad, json, open, readBody } from "@/lib/server/http";
import { LIMITS, parseSettings, powerSettings, setPowerSettings } from "@/lib/server/power";

export const runtime = "nodejs";

/** {vndPerKwh?, otherW?, budgetVnd? (null clears)}: the price, the estimate for the rest of the box, the daily budget. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const s = parseSettings(await readBody(req), powerSettings());
  if (!s) {
    const r = (k: keyof typeof LIMITS) => `${LIMITS[k][0]}-${LIMITS[k][1]}`;
    return bad(`vndPerKwh ${r("vndPerKwh")}, otherW ${r("otherW")}, budgetVnd ${r("budgetVnd")} hoặc null`, 422);
  }
  return json(setPowerSettings(s));
}
