import { bad, json, open } from "@/lib/server/http";
import { captureTmux } from "@/lib/server/proc";
import { isTmuxName } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[name]/screen">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!isTmuxName(name)) return bad("terminal view is only available for hq-* sessions", 422);
  const r = await captureTmux(name);
  if (!r.ok) return bad(`tmux: ${r.stderr.trim() || "no such session"}`, 404);
  return json({ name, text: r.stdout, at: Date.now() });
}
