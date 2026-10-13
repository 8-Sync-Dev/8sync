import { stamp } from "@/lib/server/db";
import { bad, json, open } from "@/lib/server/http";
import { stopTmux } from "@/lib/server/proc";
import { isTmuxName } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/stop">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!isTmuxName(name)) return bad("only hq-* sessions started here can be stopped", 422);
  const r = await stopTmux(name);
  if (!r.ok) return bad(`tmux: ${r.stderr.trim() || "no such session"}`, 404);
  o.db.prepare("UPDATE sessions SET status = 'ended', updated_at = ? WHERE name = ?").run(stamp(), name);
  return json({ ok: true });
}
