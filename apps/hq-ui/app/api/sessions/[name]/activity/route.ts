import { readActivity } from "@/lib/server/activity";
import { bad, json, open } from "@/lib/server/http";

export const runtime = "nodejs";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Nhật ký" of a room: the latest events of its Claude Code transcript (`?limit=` 1–200, default 80). */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[name]/activity">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!SESSION_ID.test(name)) return bad("activity is read from a Claude Code session id", 422);
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 80);
  const limit = Number.isInteger(raw) && raw >= 1 && raw <= 200 ? raw : 80;
  return json({ events: readActivity(name, null, limit), at: Date.now() });
}
