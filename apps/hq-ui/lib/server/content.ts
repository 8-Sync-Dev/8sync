// The content registry HQ reads and writes: `content_items` in content-post-agency's own SQLite
// (its migration 0062 makes the table and the publish-gate triggers, 0063 the schedule and assignee
// columns, 0064 the channels and `content_channel_posts`). HQ never creates or alters that schema;
// every write goes through the DB's triggers like any other writer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  aiReason,
  CHANNEL_LABEL,
  channelGate,
  CHANNELS,
  CONTENT_TEXT_FIELDS,
  isChannel,
  isFormat,
  isStatus,
  NO_CHANNELS,
  NO_SCHEDULE,
  RETRYABLE_STATES,
  type Captions,
  type Channel,
  type ChannelPost,
  type ContentItem,
  type ContentList,
  type ContentRow,
  type ContentStatus,
} from "../content";
import { mediaFiles, publicMedia } from "./content-media";
import { isInboxId } from "./inbox";
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
    if (err instanceof ContentError) throw err;
    if (err.errcode === CONSTRAINT_TRIGGER || err.message.startsWith("content_items:")) throw new ContentError(err.message, 409);
    if (((err.errcode ?? 0) & 0xff) === SQLITE_BUSY) throw new ContentError("DB nội dung đang bận (app content-ai đang ghi), thử lại.", 503);
    if (err.errstr === "constraint failed") throw new ContentError(err.message, 422);
    throw e;
  }
}

/** Several statements as one: a refusal halfway leaves nothing behind. */
function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export type ContentFilter = { status?: string | null; format?: string | null; fb_page?: string | null };

const LIST_MAX = 500;

/** Migration 0063 is in: the schedule and assignee columns exist. */
export function hasSchedule(db: DatabaseSync): boolean {
  const cols = new Set((db.prepare("PRAGMA table_info(content_items)").all() as { name: string }[]).map((c) => c.name));
  return cols.has("scheduled_at") && cols.has("assignee_session") && cols.has("assignee_base") && cols.has("assigned_at");
}

/** Migration 0064 is in: the `channels` / `captions_json` columns and the `content_channel_posts` table exist. */
export function hasChannels(db: DatabaseSync): boolean {
  const cols = new Set((db.prepare("PRAGMA table_info(content_items)").all() as { name: string }[]).map((c) => c.name));
  return cols.has("channels") && cols.has("captions_json") && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_channel_posts'").get() !== undefined;
}

/** A row as SQLite returns it: 0064's columns are JSON text. */
type DbItem = Omit<ContentItem, "channels" | "captions_json"> & { channels?: string; captions_json?: string | null };

/** The row as the API hands it: 0064's JSON parsed; unknown channels and non-text captions are left out. */
function fromRow(r: DbItem): ContentItem {
  const { channels, captions_json, ...rest } = r;
  if (channels === undefined) return rest;
  const raw = captions_json ? (JSON.parse(captions_json) as Record<string, unknown>) : {};
  const captions: Captions = {};
  for (const ch of CHANNELS) {
    const v = raw[ch];
    if (typeof v === "string") captions[ch] = v;
  }
  return { ...rest, channels: [...new Set((JSON.parse(channels) as unknown[]).filter(isChannel))], captions_json: Object.keys(captions).length ? captions : null };
}

/** Items with their media, and on a 0064 DB their channel rows (one query for the whole list). */
function rowsOf(db: DatabaseSync, items: ContentItem[], channels: boolean): ContentRow[] {
  const rows: ContentRow[] = items.map((it) => ({ ...it, media: mediaFiles(it.media_path).map((m) => publicMedia(it.id, m)) }));
  if (!channels || rows.length === 0) return rows;
  const posts = db
    .prepare("SELECT * FROM content_channel_posts WHERE item_id IN (SELECT value FROM json_each(?)) ORDER BY item_id, channel")
    .all(JSON.stringify(rows.map((r) => r.id))) as unknown as ChannelPost[];
  const by = new Map<number, ChannelPost[]>();
  for (const p of posts) by.set(p.item_id, [...(by.get(p.item_id) ?? []), p]);
  return rows.map((r) => ({ ...r, channel_posts: by.get(r.id) ?? [] }));
}

export function listContent(db: DatabaseSync, f: ContentFilter = {}): Extract<ContentList, { ready: true }> {
  const by = (["status", "format", "fb_page"] as const).filter((k) => f[k]);
  const where = by.map((k) => `${k} = ?`);
  const args = by.map((k) => f[k]!);
  const sql = `SELECT * FROM content_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ${LIST_MAX}`;
  const items = rowsOf(db, (db.prepare(sql).all(...args) as unknown as DbItem[]).map(fromRow), hasChannels(db));
  const pages = (db.prepare("SELECT DISTINCT fb_page FROM content_items ORDER BY fb_page").all() as { fb_page: string }[]).map((r) => r.fb_page);
  return { configured: true, ready: true, items, pages, schedule: hasSchedule(db) };
}

export function getContent(db: DatabaseSync, id: number): ContentItem | null {
  const row = db.prepare("SELECT * FROM content_items WHERE id = ?").get(id) as unknown as DbItem | undefined;
  return row ? fromRow(row) : null;
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

/** Planned times HQ accepts: 2000 … 2100, whole ms. */
const SCHEDULE_MIN = Date.UTC(2000, 0, 1);
const SCHEDULE_MAX = Date.UTC(2100, 0, 1);
const BASE_MAX = 200;

/**
 * The 0063 fields of a body: `scheduled_at` (ms or null), `assignee_session` (an omp room id or a
 * Claude session id; null clears it) with its label `assignee_base`. A new assignee stamps `assigned_at`.
 */
function scheduleFields(db: DatabaseSync, body: Record<string, unknown>, now: number): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  const asks = "scheduled_at" in body || "assignee_session" in body;
  if (!asks) return out;
  if (!hasSchedule(db)) throw new ContentError(NO_SCHEDULE, 409);
  if ("scheduled_at" in body) {
    const v = body.scheduled_at;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < SCHEDULE_MIN || v >= SCHEDULE_MAX)) throw new ContentError("scheduled_at: epoch ms (năm 2000 … 2099) hoặc null", 422);
    out.scheduled_at = v;
  }
  if ("assignee_session" in body) {
    const s = body.assignee_session;
    if (s === null) Object.assign(out, { assignee_session: null, assignee_base: null, assigned_at: null });
    else {
      if (!isInboxId(s)) throw new ContentError("assignee_session: id phòng omp hoặc session Claude", 422);
      const base = body.assignee_base;
      if (base != null && (typeof base !== "string" || base.length > BASE_MAX)) throw new ContentError(`assignee_base: chuỗi tối đa ${BASE_MAX} ký tự`, 422);
      Object.assign(out, { assignee_session: s, assignee_base: typeof base === "string" && base.trim() ? base.trim() : null, assigned_at: now });
    }
  }
  return out;
}

/** Stamps a status change carries: "checked" records when, "published" records when it went out. */
function statusStamps(item: Pick<ContentItem, "checked_at" | "published_at"> | null, status: ContentStatus, now: number): Record<string, number> {
  const s: Record<string, number> = {};
  if (status === "checked" && item?.checked_at == null) s.checked_at = now;
  if (status === "published" && item?.published_at == null) s.published_at = now;
  return s;
}

/** Owner rule 2026-11-04: an item with an AI mark is approved only with the reviewer's tick. */
function aiGate(item: Pick<ContentItem, "format" | "media_path">, status: ContentStatus, body: Record<string, unknown>): void {
  if (status !== "approved" && status !== "published") return;
  const why = aiReason({ format: item.format, media: mediaFiles(item.media_path) });
  if (why && body.no_ai_confirmed !== true) throw new ContentError(`Mục có rủi ro nhãn AI (${why}): tick xác nhận không dùng hình/giọng AI photoreal rồi mới duyệt.`, 409);
}

/** The 0064 fields of a body, parsed. Absent on the body = absent here. */
type ChannelFields = { channels?: Channel[]; captions_json?: Captions | null };

/**
 * `channels`: a non-empty list of the four channels, no repeats. `captions_json`: `{channel: text}`
 * merged into the item's own (an empty text drops that channel's own caption, so it reads the shared
 * caption again), or null to drop them all. A DB before 0064 refuses both.
 */
function channelFields(body: Record<string, unknown>, has: boolean, current: Captions | null): ChannelFields {
  const out: ChannelFields = {};
  if (!("channels" in body) && !("captions_json" in body)) return out;
  if (!has) throw new ContentError(NO_CHANNELS, 400);
  if ("channels" in body) {
    const v = body.channels;
    if (!Array.isArray(v) || v.length === 0 || !v.every(isChannel) || new Set(v).size !== v.length)
      throw new ContentError(`channels: danh sách không rỗng, không trùng, trong ${CHANNELS.join(", ")}`, 422);
    out.channels = v;
  }
  if ("captions_json" in body) {
    const v = body.captions_json;
    if (v !== null && (typeof v !== "object" || Array.isArray(v))) throw new ContentError("captions_json: object {kênh: caption} hoặc null", 422);
    const next: Captions = v === null ? {} : { ...current };
    for (const [k, s] of Object.entries(v ?? {})) {
      if (!isChannel(k)) throw new ContentError(`captions_json: kênh lạ "${k}", chỉ có ${CHANNELS.join(", ")}`, 422);
      if (typeof s !== "string") throw new ContentError(`captions_json.${k}: phải là chuỗi`, 422);
      const t = s.trim();
      if (t.length > TEXT_MAX) throw new ContentError(`captions_json.${k}: quá ${TEXT_MAX} ký tự`, 422);
      if (t) next[k] = t;
      else delete next[k];
    }
    out.captions_json = Object.keys(next).length ? next : null;
  }
  return out;
}

/** The columns `channelFields` writes (the DB keeps JSON text). */
function channelColumns(c: ChannelFields): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (c.channels) out.channels = JSON.stringify(c.channels);
  if ("captions_json" in c) out.captions_json = c.captions_json ? JSON.stringify(c.captions_json) : null;
  return out;
}

/** Contract 0064: entering approved needs every channel's caption within its limit, and YouTube a video and a title. */
function channelApproval(it: Pick<ContentItem, "title" | "caption" | "captions_json" | "channels" | "media_path">): void {
  const why = channelGate({ ...it, media: mediaFiles(it.media_path) });
  if (why) throw new ContentError(why, 409);
}

export function createContent(db: DatabaseSync, body: Record<string, unknown>, now = Date.now()): ContentRow {
  if (!isFormat(body.format)) throw new ContentError("format: một trong text, infographic, course_video, ai_video, asmr, clip, other", 422);
  if (body.status !== undefined && !isStatus(body.status)) throw new ContentError("status: không hợp lệ", 422);
  const t = textFields(body);
  if (!t.title) throw new ContentError("title: không được trống", 422);
  const status: ContentStatus = (body.status as ContentStatus | undefined) ?? "ordered";
  aiGate({ format: body.format, media_path: t.media_path ?? null }, status, body);
  const has = hasChannels(db);
  const ch = channelFields(body, has, null);
  if (has && status === "approved")
    channelApproval({ title: t.title, caption: t.caption ?? null, captions_json: ch.captions_json ?? null, channels: ch.channels ?? ["facebook"], media_path: t.media_path ?? null });
  const row: Record<string, string | number | null> = { ...t, ...scheduleFields(db, body, now), ...channelColumns(ch), format: body.format, status, ...statusStamps(null, status, now), created_at: now, updated_at: now };
  const cols = Object.keys(row);
  const id = write(() => db.prepare(`INSERT INTO content_items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c])).lastInsertRowid);
  return rowsOf(db, [getContent(db, Number(id))!], has)[0];
}

/**
 * Edit one item. Body: any text field, `format`, `status`, `scheduled_at`, `assignee_session` (+
 * `assignee_base`), and `approve_source: "<the source URL the owner saw>"` (records who and when;
 * 409 when the row's source has changed since). Approving an item with an AI mark needs
 * `no_ai_confirmed: true`; an approved item edited into AI-risk content without it drops back to
 * `checked`, a published one answers 409. A new `source_url` drops an earlier approval: it approved the old source.
 * 0064: `channels`, `captions_json` (see `channelFields`) and `retry_channel: "<channel>"`, which
 * deletes that channel's failed / blocked / cancelled row so the worker plans it again (409 for any
 * other state: a live or posted one must not be posted twice). Entering approved checks the channel
 * rule and clears the item's cancelled rows (left from an earlier un-approve) so it is scheduled again.
 */
export function updateContent(db: DatabaseSync, id: number, body: Record<string, unknown>, approver: string, now = Date.now()): ContentRow {
  const item = getContent(db, id);
  if (!item) throw new ContentError(`không có mục #${id}`, 404);
  const has = hasChannels(db);
  const ch = channelFields(body, has, item.captions_json ?? null);
  let retry: Channel | null = null;
  if ("retry_channel" in body) {
    if (!has) throw new ContentError(NO_CHANNELS, 400);
    if (!isChannel(body.retry_channel)) throw new ContentError(`retry_channel: một trong ${CHANNELS.join(", ")}`, 422);
    retry = body.retry_channel;
  }
  const set: Record<string, string | number | null> = { ...textFields(body), ...scheduleFields(db, body, now), ...channelColumns(ch) };
  if ("format" in body) {
    if (!isFormat(body.format)) throw new ContentError("format: không hợp lệ", 422);
    set.format = body.format;
  }
  if ("status" in body) {
    if (!isStatus(body.status)) throw new ContentError("status: không hợp lệ", 422);
    set.status = body.status;
    Object.assign(set, statusStamps(item, body.status, now));
  }
  // The AI tick is asked on every entry into approved or published: `aiReason` reads the media
  // folder as it is now, and a video can land there after approval (no column records what was
  // approved, and HQ never alters the schema). The 0062 trigger checks fields, not the previous status.
  // An approved item edited into AI-risk content lost that check: without the tick it drops back to
  // checked (re-approve in the sheet). A published post cannot be quietly un-published: refused.
  const next = (set.status as ContentStatus | undefined) ?? item.status;
  const nextFormat = (set.format as ContentItem["format"] | undefined) ?? item.format;
  const nextMedia = "media_path" in set ? (set.media_path as string | null) : item.media_path;
  const changed = nextFormat !== item.format || nextMedia !== item.media_path;
  const after = { format: nextFormat, media_path: nextMedia };
  if (next !== item.status) aiGate(after, next, body);
  else if (changed && (next === "approved" || next === "published") && body.no_ai_confirmed !== true) {
    const why = aiReason({ format: nextFormat, media: mediaFiles(nextMedia) });
    if (why && item.status === "published") throw new ContentError(`Bài đã đăng không đổi sang nội dung rủi ro nhãn AI (${why}) được.`, 409);
    if (why && "status" in body) aiGate(after, next, body);
    if (why) set.status = "checked";
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
  const final = (set.status as ContentStatus | undefined) ?? item.status;
  const entering = has && final === "approved" && item.status !== "approved";
  if (entering)
    channelApproval({
      title: "title" in set ? (set.title as string) : item.title,
      caption: "caption" in set ? (set.caption as string | null) : item.caption,
      captions_json: "captions_json" in ch ? (ch.captions_json ?? null) : (item.captions_json ?? null),
      channels: ch.channels ?? item.channels,
      media_path: nextMedia,
    });
  const cols = Object.keys(set);
  if (cols.length === 0 && retry === null) throw new ContentError("không có gì để sửa", 400);
  write(() =>
    tx(db, () => {
      if (retry !== null) {
        const states = RETRYABLE_STATES.map(() => "?").join(", ");
        const gone = db.prepare(`DELETE FROM content_channel_posts WHERE item_id = ? AND channel = ? AND state IN (${states})`).run(id, retry, ...RETRYABLE_STATES).changes;
        if (gone === 0) throw new ContentError(`${CHANNEL_LABEL[retry]}: chỉ thử lại được khi kênh lỗi, bị chặn hoặc đã huỷ lịch.`, 409);
      }
      if (cols.length === 0) return;
      set.updated_at = now;
      cols.push("updated_at");
      db.prepare(`UPDATE content_items SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => set[c]), id);
      if (entering) db.prepare("DELETE FROM content_channel_posts WHERE item_id = ? AND state = 'cancelled'").run(id);
    }),
  );
  return rowsOf(db, [getContent(db, id)!], has)[0];
}

export function deleteContent(db: DatabaseSync, id: number): boolean {
  return write(() => db.prepare("DELETE FROM content_items WHERE id = ?").run(id).changes > 0);
}

/** Who approved a source from HQ: the account HQ runs under (the owner's machine). */
export const hqApprover = () => `hq:${os.userInfo().username}`;
