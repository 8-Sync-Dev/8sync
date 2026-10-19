import { bad, json, open, readBody } from "@/lib/server/http";
import { mergedSessions } from "@/lib/server/proc";
import { TERM_ID, clampSize, closeTerm, input, openTerm } from "@/lib/server/term";
import { termResponse } from "@/lib/server/term-http";

export const runtime = "nodejs";

/** The live background room for this id, or null (tmux rooms keep their own drawer). */
async function room(db: Parameters<typeof mergedSessions>[0], id: string) {
  return (await mergedSessions(db)).find((s) => s.session_id === id && !s.tmux && s.status !== "ended") ?? null;
}

/** The room's terminal (`claude attach`): a stream, or one poll with `?gen=&since=` (see termResponse). */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("terminal is opened by a Claude Code session id", 422);
  const s = await room(o.db, name);
  if (!s) return bad("phòng này không chạy nền (hoặc đã dừng)", 404);
  const url = new URL(req.url);
  const size = clampSize(Number(url.searchParams.get("cols")), Number(url.searchParams.get("rows")));
  try {
    return termResponse(req, name, openTerm(name, s.cwd, size));
  } catch (e) {
    return bad((e as Error).message, 422);
  }
}

/** `{data}` keys typed in the browser and/or `{cols, rows}`. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("bad session id", 422);
  const body = await readBody(req);
  if (!body) return bad("body must be a JSON object", 422);
  return input(name, body) ? json({ ok: true }) : bad("terminal chưa mở", 409);
}

/** Close the terminal now (the room keeps running). */
export async function DELETE(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("bad session id", 422);
  closeTerm(name);
  return json({ ok: true });
}
