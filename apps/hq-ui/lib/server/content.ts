// The content registry HQ reads and writes: `content_items` in content-post-agency's own SQLite
// (its migration 0062 makes the table and the publish-gate triggers). HQ never creates or alters
// that schema; every write goes through the DB's triggers like any other writer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { CONTENT_TEXT_FIELDS, isFormat, isStatus, type ContentItem, type ContentList, type ContentStatus } from "../content";
import { configDir } from "./paths";

/** `~/.config/8sync/hq/content.json` = `{"db": "<absolute path to daily-dev.db>"}`; `EIGHTSYNC_CONTENT_DB` wins. */
export const contentConfigPath = () => path.join(configDir(), "content.json");

export type ContentDbPath = { path: string } | { error: string } | null;

/** The configured DB path; null = not configured (the view is hidden). */
export function contentDbPath(env: Record<string, string | undefined> = process.env): ContentDbPath {
  let raw = env.EIGHTSYNC_CONTENT_DB?.trim() || "";
  if (!raw) {
    let text: string;
    try {
      text = fs.readFileSync(contentConfigPath(), "utf8");
    } catch {
      return null;
    }
    try {
      const v = JSON.parse(text) as unknown;
      raw = v && typeof v === "object" && "db" in v && typeof v.db === "string" ? v.db.trim() : "";
    } catch {
      return { error: `${contentConfigPath()} không phải JSON {"db": "..."}` };
    }
    if (!raw) return { error: `${contentConfigPath()} thiếu "db"` };
  }
  if (!path.isAbsolute(raw)) return { error: `đường dẫn DB nội dung phải tuyệt đối: ${raw}` };
  return { path: raw };
}

export const NO_REGISTRY = "Chưa có sổ nội dung, mở app content-ai một lần để chạy migration.";

const g = globalThis as unknown as { __contentDb?: { file: string; db: DatabaseSync } };

/** One connection per file. The app writes the same WAL DB, so a write waits for its lock instead of failing. */
function connect(file: string): DatabaseSync {
  if (g.__contentDb?.file === file) return g.__contentDb.db;
  g.__contentDb?.db.close();
  g.__contentDb = undefined;
  // mode=rw: SQLite itself refuses to create the file (existsSync below only words the error).
  const db = new DatabaseSync(`${pathToFileURL(file).href}?mode=rw`);
  db.exec("PRAGMA busy_timeout = 5000;");
  g.__contentDb = { file, db };
  return db;
}

/** The registry DB, or why it cannot be used. Never creates a file: a missing one is reported. */
export function openContent(env?: Record<string, string | undefined>): { db: DatabaseSync } | { configured: false } | { error: string } {
  const p = contentDbPath(env);
  if (p === null) return { configured: false };
  if ("error" in p) return p;
  if (!fs.existsSync(p.path)) return { error: `không thấy DB nội dung: ${p.path}` };
  let db: DatabaseSync;
  try {
    db = connect(p.path);
  } catch (e) {
    return { error: `không mở được DB nội dung: ${(e as Error).message}` };
  }
  try {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_items'").get();
    return has ? { db } : { error: NO_REGISTRY };
  } catch (e) {
    return { error: `không đọc được DB nội dung: ${(e as Error).message}` };
  }
}

/** An error the API answers with a status: a gate trigger (409, its own message), a bad value (422), a locked DB (503). */
export class ContentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** SQLITE_CONSTRAINT_TRIGGER (RAISE(ABORT, ...)): the gate's message, word for word. */
const CONSTRAINT_TRIGGER = 1811;
const SQLITE_BUSY = 5;

function write<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const err = e as Error & { errcode?: number; errstr?: string };
    if (err.errcode === CONSTRAINT_TRIGGER || err.message.startsWith("content_items:")) throw new ContentError(err.message, 409);
    if (((err.errcode ?? 0) & 0xff) === SQLITE_BUSY) throw new ContentError("DB nội dung đang bận (app content-ai đang ghi), thử lại.", 503);
    if (err.errstr === "constraint failed") throw new ContentError(err.message, 422);
    throw e;
  }
}

export type ContentFilter = { status?: string | null; format?: string | null; fb_page?: string | null };

const LIST_MAX = 500;

export function listContent(db: DatabaseSync, f: ContentFilter = {}): Extract<ContentList, { ready: true }> {
  const by = (["status", "format", "fb_page"] as const).filter((k) => f[k]);
  const where = by.map((k) => `${k} = ?`);
  const args = by.map((k) => f[k]!);
  const sql = `SELECT * FROM content_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ${LIST_MAX}`;
  const items = db.prepare(sql).all(...args) as unknown as ContentItem[];
  const pages = (db.prepare("SELECT DISTINCT fb_page FROM content_items ORDER BY fb_page").all() as { fb_page: string }[]).map((r) => r.fb_page);
  return { configured: true, ready: true, items, pages };
}

export function getContent(db: DatabaseSync, id: number): ContentItem | null {
  return (db.prepare("SELECT * FROM content_items WHERE id = ?").get(id) as unknown as ContentItem | undefined) ?? null;
}

const TEXT_MAX = 20_000;

/** The text fields of a body: string → trimmed (empty = NULL), null → NULL, absent → skipped. */
function textFields(body: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of CONTENT_TEXT_FIELDS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v !== null && typeof v !== "string") throw new ContentError(`${k}: phải là chuỗi`, 422);
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length > TEXT_MAX) throw new ContentError(`${k}: quá ${TEXT_MAX} ký tự`, 422);
    out[k] = s === "" ? null : s;
  }
  if ("title" in out && out.title === null) throw new ContentError("title: không được trống", 422);
  if ("fb_page" in out && out.fb_page === null) throw new ContentError("fb_page: không được trống", 422);
  return out;
}

/** Stamps a status change carries: "checked" records when, "published" records when it went out. */
function statusStamps(item: Pick<ContentItem, "checked_at" | "published_at"> | null, status: ContentStatus, now: number): Record<string, number> {
  const s: Record<string, number> = {};
  if (status === "checked" && item?.checked_at == null) s.checked_at = now;
  if (status === "published" && item?.published_at == null) s.published_at = now;
  return s;
}

export function createContent(db: DatabaseSync, body: Record<string, unknown>, now = Date.now()): ContentItem {
  if (!isFormat(body.format)) throw new ContentError("format: một trong text, infographic, course_video, ai_video, asmr, clip, other", 422);
  if (body.status !== undefined && !isStatus(body.status)) throw new ContentError("status: không hợp lệ", 422);
  const t = textFields(body);
  if (!t.title) throw new ContentError("title: không được trống", 422);
  const status: ContentStatus = (body.status as ContentStatus | undefined) ?? "ordered";
  const row: Record<string, string | number | null> = { ...t, format: body.format, status, ...statusStamps(null, status, now), created_at: now, updated_at: now };
  const cols = Object.keys(row);
  const id = write(() => db.prepare(`INSERT INTO content_items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c])).lastInsertRowid);
  return getContent(db, Number(id))!;
}

/**
 * Edit one item. Body: any text field, `format`, `status`, and `approve_source: "<the source URL the
 * owner saw>"` (records who and when; 409 when the row's source has changed since).
 * A new `source_url` drops an earlier approval: it approved the old source.
 */
export function updateContent(db: DatabaseSync, id: number, body: Record<string, unknown>, approver: string, now = Date.now()): ContentItem {
  const item = getContent(db, id);
  if (!item) throw new ContentError(`không có mục #${id}`, 404);
  const set: Record<string, string | number | null> = textFields(body);
  if ("format" in body) {
    if (!isFormat(body.format)) throw new ContentError("format: không hợp lệ", 422);
    set.format = body.format;
  }
  if ("status" in body) {
    if (!isStatus(body.status)) throw new ContentError("status: không hợp lệ", 422);
    set.status = body.status;
    Object.assign(set, statusStamps(item, body.status, now));
  }
  if ("source_url" in set && set.source_url !== item.source_url) {
    set.source_approved_by = null;
    set.source_approved_at = null;
  }
  if ("approve_source" in body) {
    const src = "source_url" in set ? set.source_url : item.source_url;
    if (!src) throw new ContentError("chưa có nguồn để duyệt", 422);
    if (body.approve_source !== src) throw new ContentError("Nguồn đã đổi so với lúc anh xem, tải lại rồi duyệt.", 409);
    set.source_approved_by = approver;
    set.source_approved_at = now;
  }
  const cols = Object.keys(set);
  if (cols.length === 0) throw new ContentError("không có gì để sửa", 400);
  set.updated_at = now;
  cols.push("updated_at");
  write(() => db.prepare(`UPDATE content_items SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => set[c]), id));
  return getContent(db, id)!;
}

export function deleteContent(db: DatabaseSync, id: number): boolean {
  return write(() => db.prepare("DELETE FROM content_items WHERE id = ?").run(id).changes > 0);
}

/** Who approved a source from HQ: the account HQ runs under (the owner's machine). */
export const hqApprover = () => `hq:${os.userInfo().username}`;
