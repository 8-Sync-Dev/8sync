import type { DigestRow } from "@/lib/content-metrics";
import { ARTIFACT_LIST_MAX, listArtifacts } from "@/lib/server/artifacts";
import { latestMetrics } from "@/lib/server/content-metrics";
import { json, open } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Nội dung's results in one poll: artifacts linked to a content item (`hq.mjs artifact add --content`),
 * the newest numbers per post and platform, and the last end-of-day tasks. Owner only (lib/access).
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const digest = o.db.prepare("SELECT day, session, status, at FROM content_digest ORDER BY day DESC LIMIT 14").all() as DigestRow[];
  return json({ artifacts: listArtifacts(o.db, { linked: true, limit: ARTIFACT_LIST_MAX }), metrics: latestMetrics(o.db), digest, at: Date.now() });
}
