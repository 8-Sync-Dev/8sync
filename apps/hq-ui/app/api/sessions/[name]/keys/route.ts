import { bad, json, open, readBody } from "@/lib/server/http";
import { keysPlan, sendKeysRaw } from "@/lib/server/proc";
import { isTmuxName } from "@/lib/server/validate";

export const runtime = "nodejs";

/**
 * Answers Claude Code's terminal dialogs from the drawer: allowlisted key
 * names ({keys: ["Up", "Enter"]}) or one line of literal text ({text, enter}).
 * Same token + Origin gate as every mutating call; argv only, never a shell.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/keys">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!isTmuxName(name)) return bad("keys can only go to hq-* sessions started here", 422);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const plan = keysPlan(name, body);
  if (!plan.ok) return bad(plan.error, 422);
  const r = await sendKeysRaw(plan.steps);
  if (!r.ok) return bad(`tmux: ${r.stderr.trim() || "no such session"}`, 404);
  return json({ ok: true });
}
