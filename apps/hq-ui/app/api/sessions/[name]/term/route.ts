import { isOmpRoomId } from "@/lib/labels";
import { ompRoom } from "@/lib/server/floor";
import { bad, json, open, readBody } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { clampSize, closeTerm, input, isTermId, openTerm, takeoverTerm, watch, type Term } from "@/lib/server/term";
import { markEnded } from "@/lib/server/room-end";
import { termResponse } from "@/lib/server/term-http";
import { FILES_PER_TASK, isUploadId, placeUploads } from "@/lib/server/uploads";

export const runtime = "nodejs";

/**
 * The room's session view, or null when there is no such room: a live background Claude Code room (tmux
 * rooms keep their own drawer), or an omp room `8sync ls` lists (resolved server side, never a path
 * from the client; idle is fine, its terminal starts it).
 */
async function room(db: Parameters<typeof mergedSessions>[0], id: string): Promise<{ cwd: string | null; name: string | null; project_id: number | null; started_at: number | null } | null> {
  if (isOmpRoomId(id)) { const o = await ompRoom(db, id); return o ? { cwd: o.cwd, name: null, project_id: null, started_at: null } : null; }
  const s = (await mergedSessions(db)).find((x) => x.session_id === id && !x.tmux && x.status !== "ended") ?? null;
  return s && { cwd: s.cwd, name: s.name, project_id: s.project_id, started_at: s.started_at };
}

/**
 * The terminal proves the room is gone (`claude attach` printed "No job matching"): keep the ghost off
 * the live list (owner 2026-10-22 — a dead room kept showing "Đang làm" and its terminal would not open).
 */
function forgetIfDead(db: Parameters<typeof mergedSessions>[0], s: Awaited<ReturnType<typeof room>>, id: string, t: Term) {
  if (!s?.name || isOmpRoomId(id)) return;
  const row = { name: s.name, project_id: s.project_id ?? null, started_at: s.started_at ?? 0, cwd: s.cwd };
  watch(id, t, (b) => {
    if (b === null && t.dead) markEnded(db, row);
  });
}

/** The room's terminal (`claude attach`, or the omp room's host): a stream, or one poll with `?gen=&since=` (see termResponse). */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!isTermId(name)) return bad("terminal is opened by a Claude Code session id or an omp room id", 422);
  const s = await room(o.db, name);
  if (!s) return bad("phòng này không chạy nền (hoặc đã dừng)", 404);
  const url = new URL(req.url);
  const size = clampSize(Number(url.searchParams.get("cols")), Number(url.searchParams.get("rows")));
  try {
    const term = openTerm(name, s.cwd, size);
    forgetIfDead(o.db, s, name, term);
    return termResponse(req, name, term);
  } catch (e) {
    return bad((e as Error).message, 422);
  }
}

/**
 * `{data}` keys typed in the browser and/or `{cols, rows}`. `{takeover: true, cols, rows}` (omp rooms,
 * "Chuyển sang HQ"): end the other terminal that has the session open and open it here; the page
 * then reconnects with GET. `{files: [upload id]}` (the terminal's image button): place the uploads in
 * the room's repo (like a chat attachment) and answer `{paths}`; the page puts them in the input line.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!isTermId(name)) return bad("bad session id", 422);
  const body = await readBody(req);
  if (!body) return bad("body must be a JSON object", 422);
  if (body.files !== undefined) {
    const files = body.files;
    if (!Array.isArray(files) || files.length === 0 || files.length > FILES_PER_TASK || !files.every(isUploadId)) return bad(`files: 1 to ${FILES_PER_TASK} upload ids`, 422);
    const s = await room(o.db, name);
    if (!s?.cwd) return bad("phòng này không còn chạy, không đặt được ảnh", 409);
    try {
      return json({ paths: placeUploads([...new Set(files as string[])], projectOf(s.cwd)?.root ?? s.cwd) });
    } catch (e) {
      return bad((e as Error).message, 400);
    }
  }
  if (body.takeover === true) {
    if (!isOmpRoomId(name)) return bad("chỉ phòng omp mới chuyển sang HQ được", 422);
    const s = await room(o.db, name);
    if (!s) return bad("không thấy phòng omp này", 404);
    takeoverTerm(name, s.cwd, clampSize(body.cols, body.rows));
    return json({ ok: true });
  }
  return input(name, body) ? json({ ok: true }) : bad("terminal chưa mở", 409);
}

/** Close the terminal now (the room keeps running; an omp room's host keeps omp running). */
export async function DELETE(req: Request, ctx: RouteContext<"/api/sessions/[name]/term">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!isTermId(name)) return bad("bad session id", 422);
  closeTerm(name);
  return json({ ok: true });
}
