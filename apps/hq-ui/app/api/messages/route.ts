import { afterParam, bad, limitParam, json, open, readBody } from "@/lib/server/http";
import { openDialog, SessionWaiting } from "@/lib/server/channel";
import { deliverText } from "@/lib/server/deliver";
import { capturePlain, mergedSessions } from "@/lib/server/proc";
import { isInboxId } from "@/lib/server/inbox";
import { messagesAfter } from "@/lib/server/queries";
import { clampText, isTmuxName } from "@/lib/server/validate";
import { expandMentions } from "@/lib/server/fs-list";
import { loadFloor, ompSessions } from "@/lib/server/floor";
import { projectOf } from "@/lib/server/office";
import { FILES_PER_TASK, isUploadId, placeUploads, withFiles } from "@/lib/server/uploads";
import type { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const q = url.searchParams;
  const project = q.get("project");
  const limit = limitParam(url);
  if (limit === null) return bad("limit must be a positive integer", 400);
  return json({
    messages: messagesAfter(o.db, {
      after: afterParam(url),
      session: q.get("session"),
      project: project && /^\d+$/.test(project) ? Number(project) : null,
      limit,
    }),
  });
}

export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const files = body.files ?? [];
  if (!Array.isArray(files) || files.length > FILES_PER_TASK || !files.every(isUploadId)) return bad(`files: at most ${FILES_PER_TASK} upload ids`, 400);
  // "@path" from the composer's picker → absolute, against the room's folder (`base`).
  const raw = typeof body.text === "string" && typeof body.base === "string" ? expandMentions(body.text, body.base) : body.text;
  let text = clampText(raw);
  if (!text.ok) return bad(text.error, 422);
  const inbox = isInboxId(body.session);
  if (!inbox && !isTmuxName(body.session)) return bad("session must be an hq-* session, a Claude session id or an omp room id", 422);
  const session = body.session as string;
  // Attachments go into the room's repo first; the message names their paths, so the room can Read them.
  if (files.length > 0) {
    // A terminal room showing a dialog answers 409 before anything is written (deliverWatched checks again).
    const dialog = inbox ? null : await openDialog(session, capturePlain);
    if (dialog) return json({ error: "session-waiting", dialog }, 409);
    const root = await roomRoot(o.db, session);
    if (!root) return bad("phòng này không còn chạy, không đặt được file đính kèm", 409);
    let paths: string[];
    try {
      paths = placeUploads([...new Set(files as string[])], root);
    } catch (e) {
      return bad((e as Error).message, 400);
    }
    text = clampText(withFiles(text.value, paths));
    if (!text.ok) return bad(`tin + đường dẫn file: ${text.error}`, 422);
  }
  // An omp room or a Claude session started elsewhere: its inbox; an hq-* tmux room: typed in (`deliverText`).
  try {
    return json(await deliverText(o.db, session, text.value), 201);
  } catch (e) {
    if (e instanceof SessionWaiting) return json({ error: "session-waiting", dialog: e.dialog }, 409);
    throw e;
  }
}

/**
 * The repo root of a live room (where its attachments go), from HQ's own session list: the client
 * never names a folder to write into. A worktree room gets its worktree; no git root: its cwd.
 */
async function roomRoot(db: DatabaseSync, session: string): Promise<string | null> {
  const merged = await mergedSessions(db).catch(() => []);
  let room = merged.find((s) => s.status !== "ended" && (s.name === session || s.session_id === session));
  if (!room) room = ompSessions(db, await loadFloor(db)).find((s) => s.name === session);
  if (!room?.cwd) return null;
  return projectOf(room.cwd)?.root ?? room.cwd;
}
