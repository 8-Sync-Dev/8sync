import { json, open } from "@/lib/server/http";
import { readOmpAccounts } from "@/lib/server/omp-accounts";

export const runtime = "nodejs";

/** Every login omp holds and its newest limit windows, read-only from omp's agent.db. Never a secret. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(readOmpAccounts());
}
