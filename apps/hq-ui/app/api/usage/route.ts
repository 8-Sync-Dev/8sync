import { json, open } from "@/lib/server/http";
import { usageReport } from "@/lib/server/usage";

export const runtime = "nodejs";

/** Plan windows (status-line snapshots) and tokens per room (local transcripts). Never the Anthropic usage API. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(await usageReport(o.db));
}
