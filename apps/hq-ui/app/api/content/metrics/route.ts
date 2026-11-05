import { bad, json, open, readBody } from "@/lib/server/http";
import { addMetric, latestMetrics } from "@/lib/server/content-metrics";

export const runtime = "nodejs";

/** Nội dung › Tổng quan: the newest reading of each post per platform. `?content=` one post. Owner only (lib/access). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const c = new URL(req.url).searchParams.get("content");
  if (c !== null && !/^\d{1,12}$/.test(c)) return bad("content must be a content item id");
  return json({ metrics: latestMetrics(o.db, { content: c ? Number(c) : null }), at: Date.now() });
}

/** `{content_id, platform, url?, at?, reach?, reactions?, comments?, shares?, views?, session?}`: one reading, kept beside the earlier ones. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const b = await readBody(req);
  if (!b) return bad("body must be a JSON object", 422);
  const r = addMetric(o.db, b);
  if (!r.ok) return bad(r.error, r.status);
  return json({ metric: r.metric }, 201);
}
