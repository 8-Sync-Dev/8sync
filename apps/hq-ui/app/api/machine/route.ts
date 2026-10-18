import { json, open } from "@/lib/server/http";
import { machine } from "@/lib/server/machine";

export const runtime = "nodejs";

/** RAM, CPU, GPU and the RAM Claude Code / Node processes hold on the machine running HQ. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(await machine());
}
