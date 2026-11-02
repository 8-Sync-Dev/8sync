import { json, open } from "@/lib/server/http";
import { grantableModels } from "@/lib/server/omp-gateway";

export const runtime = "nodejs";

/** Models a key can be given: the gateway's catalog without Claude. Empty when the gateway is down. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ models: await grantableModels() });
}
