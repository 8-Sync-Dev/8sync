import { readActivity, readOmpActivity, type RoomLog } from "@/lib/server/activity";
import { ompTranscript } from "@/lib/server/floor";
import { bad, json, open } from "@/lib/server/http";
import { isOmpRoomId } from "@/lib/labels";

export const runtime = "nodejs";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Nhật ký" of a room (`?limit=` 1–200, default 80): the latest steps of a Claude Code session's
 * transcript, or of an omp room's (`omp-<16 hex>`; its file comes from `8sync ls`, never the client),
 * plus its turns (prompt → final output) and `rev`. `?since=<rev>` while the file is unchanged answers
 * `{same: true}` only, so an idle room costs a stat per poll instead of its whole log.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[name]/activity">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  const omp = isOmpRoomId(name);
  if (!omp && !SESSION_ID.test(name)) return bad("activity is read from a Claude Code session id or an omp room id", 422);
  const q = new URL(req.url).searchParams;
  const raw = Number(q.get("limit") ?? 80);
  const limit = Number.isInteger(raw) && raw >= 1 && raw <= 200 ? raw : 80;
  let log: RoomLog;
  if (!omp) log = readActivity(name, null, limit);
  else {
    const file = await ompTranscript(o.db, name);
    log = file ? readOmpActivity(file, limit) : { events: [], turns: [], rev: "" };
  }
  const since = q.get("since");
  if (since && log.rev && since === log.rev) return json({ same: true, rev: log.rev, at: Date.now() });
  return json({ ...log, at: Date.now() });
}
