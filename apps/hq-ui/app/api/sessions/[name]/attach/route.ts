import { attachCommand } from "@/lib/ask";
import { openAttachTerminal } from "@/lib/server/attach";
import { bad, json, open } from "@/lib/server/http";

export const runtime = "nodejs";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens a terminal on this machine attached to a background session, so the owner can answer it. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/attach">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!SESSION_ID.test(name)) return bad("only Claude Code sessions (session id) can be attached", 422);
  const command = attachCommand(name);
  const launcher = await openAttachTerminal(name.slice(0, 8));
  if (!launcher) return json({ ok: false, command, error: "no terminal app found on this machine" }, 501);
  return json({ ok: true, command, launcher });
}
