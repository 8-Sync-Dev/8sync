import { bad, json, open, readBody } from "@/lib/server/http";
import { attachLine, openInOrca, orcaBin } from "@/lib/server/orca";
import { mergedSessions } from "@/lib/server/proc";
import { TERM_ID } from "@/lib/server/term";

export const runtime = "nodejs";

/** The live background room for this id, or null (tmux rooms keep their own drawer). */
async function room(db: Parameters<typeof mergedSessions>[0], id: string) {
  return (await mergedSessions(db)).find((s) => s.session_id === id && !s.tmux && s.status !== "ended") ?? null;
}

/** Whether Orca is here, and the line to paste in any terminal to land in this room. */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[name]/orca">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("only Claude Code sessions (session id)", 422);
  const s = await room(o.db, name);
  return json({ orca: orcaBin() != null, command: attachLine(s?.cwd, name.slice(0, 8)) });
}

/** Open `claude attach` for this room as an Orca tab in the room's worktree. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/orca">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("only Claude Code sessions (session id)", 422);
  const s = await room(o.db, name);
  if (!s?.cwd) return bad("phòng này không chạy nền (hoặc đã dừng)", 404);
  const body = await readBody(req);
  const title = typeof body?.title === "string" ? body.title : name.slice(0, 8);
  const r = await openInOrca(s.cwd, title, name.slice(0, 8));
  const command = attachLine(s.cwd, name.slice(0, 8));
  return r.ok ? json({ ok: true, dir: r.dir, command }) : json({ ok: false, error: r.error, command }, 502);
}
