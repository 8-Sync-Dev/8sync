// "Góp ý" on a content item (owner 2026-11-06): the owner types comments while reviewing (also while
// unapproving), they are saved, not sent; later one send hands every draft of the item to its posting
// room in ONE message. Kept in HQ's own DB (`content_comments`, lib/server/db.ts), never in the content
// DB: drafts survive a reload and show on the owner's other devices. Owner only (lib/access: no guest route).
import type { DatabaseSync } from "node:sqlite";
import { COMMENT_MAX, COMMENTS_SEND_MAX, COMMENTS_SENT_SHOWN, commentsTaskText, type CommentList, type ContentComment } from "../content-comments";
import type { ContentItem } from "../content";
import { ContentError, type Deliver, type Sent } from "./content";
import { isInboxId } from "./inbox";
import { hasControlChars } from "./validate";

const BASE_MAX = 200;
const COLS = "id, item_id, text, created_at, sent_at, sent_to, sent_label";

/** A comment's text: trimmed, CRLF as LF, 1..COMMENT_MAX characters, no control character but tab and newline. Throws 422. */
export function commentText(v: unknown): string {
  if (typeof v !== "string") throw new ContentError("text: cần chuỗi", 422);
  const t = v.replace(/\r\n/g, "\n").trim();
  if (!t) throw new ContentError("Góp ý đang trống", 422);
  const n = [...t].length;
  if (n > COMMENT_MAX) throw new ContentError(`Góp ý dài ${n.toLocaleString("vi-VN")} ký tự, tối đa ${COMMENT_MAX.toLocaleString("vi-VN")}`, 422);
  if (hasControlChars(t)) throw new ContentError("Góp ý có ký tự điều khiển, không lưu", 422);
  return t;
}

/** The item's drafts (oldest first: the order they are numbered in) and its newest sent comments. */
export function listComments(db: DatabaseSync, itemId: number): CommentList {
  const drafts = db.prepare(`SELECT ${COLS} FROM content_comments WHERE item_id = ? AND sent_at IS NULL ORDER BY id`).all(itemId) as unknown as ContentComment[];
  const sent = db
    .prepare(`SELECT ${COLS} FROM content_comments WHERE item_id = ? AND sent_at IS NOT NULL ORDER BY sent_at DESC, id LIMIT ?`)
    .all(itemId, COMMENTS_SENT_SHOWN) as unknown as ContentComment[];
  return { drafts, sent };
}

const one = (db: DatabaseSync, id: number) => db.prepare(`SELECT ${COLS} FROM content_comments WHERE id = ?`).get(id) as unknown as ContentComment | undefined;

export function addComment(db: DatabaseSync, itemId: number, text: unknown, now = Date.now()): ContentComment {
  const t = commentText(text);
  const id = Number(db.prepare("INSERT INTO content_comments (item_id, text, created_at) VALUES (?, ?, ?)").run(itemId, t, now).lastInsertRowid);
  return one(db, id)!;
}

/** A draft that is still a draft: 404 when gone, 409 once sent (what went out is not rewritten). */
function draft(db: DatabaseSync, id: number): ContentComment {
  const c = one(db, id);
  if (!c) throw new ContentError(`không có góp ý #${id}`, 404);
  if (c.sent_at != null) throw new ContentError("Góp ý này đã gửi, không sửa hay xoá được nữa", 409);
  return c;
}

export function editComment(db: DatabaseSync, id: number, text: unknown): ContentComment {
  const t = commentText(text);
  draft(db, id);
  db.prepare("UPDATE content_comments SET text = ? WHERE id = ? AND sent_at IS NULL").run(t, id);
  return one(db, id)!;
}

/** Drops a draft; returns its item id. */
export function deleteComment(db: DatabaseSync, id: number): number {
  const c = draft(db, id);
  db.prepare("DELETE FROM content_comments WHERE id = ? AND sent_at IS NULL").run(id);
  return c.item_id;
}

/**
 * Sends every draft of the item in one message (`commentsTaskText`) to `session` (an omp room id or
 * Claude session id; the room's label `base` is kept for the history). The drafts that were in the
 * message are marked sent only when the delivery did not fail; a failure (thrown or `failed`)
 * answers 502 and keeps them all as drafts. A draft added during the delivery stays a draft.
 */
export async function sendComments(
  db: DatabaseSync,
  it: Pick<ContentItem, "id" | "title" | "fb_page">,
  body: { session: unknown; base?: unknown },
  deliver: Deliver,
  now = Date.now(),
): Promise<{ sent: Sent; count: number; comments: CommentList }> {
  const session = body.session;
  if (!isInboxId(session)) throw new ContentError("session: chọn phòng nhận góp ý (id phòng omp hoặc session Claude)", 422);
  const rawBase = body.base;
  if (rawBase != null && (typeof rawBase !== "string" || rawBase.length > BASE_MAX)) throw new ContentError(`base: chuỗi tối đa ${BASE_MAX} ký tự`, 422);
  const base = typeof rawBase === "string" && rawBase.trim() ? rawBase.trim() : null;
  const drafts = listComments(db, it.id).drafts;
  if (drafts.length === 0) throw new ContentError("Chưa có góp ý nào để gửi", 409);
  const text = commentsTaskText(it, drafts.map((d) => d.text));
  const n = [...text].length;
  if (n > COMMENTS_SEND_MAX)
    throw new ContentError(`${drafts.length} góp ý thành tin dài ${n.toLocaleString("vi-VN")} ký tự, tối đa ${COMMENTS_SEND_MAX.toLocaleString("vi-VN")}: rút gọn hoặc xoá bớt rồi gửi`, 422);
  let sent: Sent;
  try {
    sent = await deliver(session, text);
  } catch (e) {
    throw new ContentError(`Chưa gửi được góp ý, vẫn giữ nháp: ${(e as Error).message}`, 502);
  }
  if (sent.delivery === "failed") throw new ContentError(`Chưa gửi được góp ý, vẫn giữ nháp: ${sent.error ?? "gửi lỗi"}`, 502);
  const ids = drafts.map((d) => d.id);
  db.prepare(`UPDATE content_comments SET sent_at = ?, sent_to = ?, sent_label = ? WHERE sent_at IS NULL AND id IN (${ids.map(() => "?").join(", ")})`).run(now, session, base, ...ids);
  return { sent, count: drafts.length, comments: listComments(db, it.id) };
}
