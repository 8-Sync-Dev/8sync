// The content registry HQ reads and writes: `content_items` in content-post-agency's own SQLite
// (its migration 0062 makes the table and the publish-gate triggers, 0063 the schedule and assignee
// columns, 0064 the channels and `content_channel_posts`). HQ never creates or alters that schema;
// every write goes through the DB's triggers like any other writer. HQ reads only the columns it
// knows (`ITEM_COLUMNS`); any other column of the table stays untouched by it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  CHANNEL_LABEL,
  channelGate,
  CHANNELS,
  CHANNELS_0065,
  CONTENT_TEXT_FIELDS,
  GUEST_DROPBACK_FIELDS,
  isChannel,
  isChannel0065,
  isFormat,
  isHqClaim,
  isStatus,
  NO_CHANNELS,
  NO_CHANNELS_0065,
  NO_SCHEDULE,
  publishTaskText,
  RETRYABLE_STATES,
  type Captions,
  type Channel,
  type ChannelPost,
  type ContentItem,
  type ContentList,
  type ContentRow,
  type ContentStatus,
} from "../content";
import { GUEST_STATUS_DENIED, OWNER_CONTENT_STATUSES } from "../access";
import { mediaFiles, publicMedia } from "./content-media";
import { readAssignPref, saveAssignPref } from "./content-prefs";
import { isInboxId } from "./inbox";
import { configDir } from "./paths";
import { clampText } from "./validate";

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

/** The git checkout holding the DB (content-post-agency), where the owner's `cpa-live` omp session runs; null when none. */
export function contentRepo(env: Record<string, string | undefined> = process.env): string | null {
  const p = contentDbPath(env);
  if (!p || "error" in p) return null;
  for (let dir = path.dirname(p.path); ; ) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
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

/**
 * Migration 0065 is in: the CHECK on `content_channel_posts.channel` names every `CHANNELS_0065`
 * channel (read from the table's CREATE sql, as SQLite keeps it). False before 0064 too.
 */
export function hasChannels0065(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_channel_posts'").get() as { sql: string | null } | undefined;
  const sql = row?.sql ?? "";
  return CHANNELS_0065.every((c) => sql.includes(`'${c}'`));
}

/** The `content_items` columns HQ reads: 0062's, then 0063's and 0064's when the DB has them. */
const ITEM_COLUMNS = [
  "id",
  "format",
  "title",
  "brief",
  "caption",
  "media_path",
  "fb_page",
  "source_url",
  "source_approved_by",
  "source_approved_at",
  "check_note",
  "checked_at",
  "news_url",
  "fb_post_url",
  "published_at",
  "status",
  "created_at",
  "updated_at",
  "scheduled_at",
  "assignee_session",
  "assignee_base",
  "assigned_at",
  "channels",
  "captions_json",
] as const;

/** `SELECT` list of the `ITEM_COLUMNS` this DB has (an older DB lacks the 0063/0064 ones). */
function itemSelect(db: DatabaseSync): string {
  const cols = new Set((db.prepare("PRAGMA table_info(content_items)").all() as { name: string }[]).map((c) => c.name));
  return ITEM_COLUMNS.filter((c) => cols.has(c)).join(", ");
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
  return {
    ...rest,
    channels: [...new Set((JSON.parse(channels) as unknown[]).filter(isChannel))],
    captions_json: Object.keys(captions).length ? captions : null,
  };
}

/** Items with their media, and on a 0064 DB their channel rows (one query for the whole list). */
function rowsOf(db: DatabaseSync, items: ContentItem[], channels: boolean): ContentRow[] {
  const rows: ContentRow[] = items.map((it) => ({ ...it, media: mediaFiles(it.media_path).map((m) => publicMedia(it.id, m)) }));
  if (!channels || rows.length === 0) return rows;
  const posts = db
    .prepare("SELECT * FROM content_channel_posts WHERE item_id IN (SELECT value FROM json_each(?)) ORDER BY item_id, channel")
    .all(JSON.stringify(rows.map((r) => r.id))) as unknown as ChannelPost[];
  const by = new Map<number, ChannelPost[]>();
  // A channel this HQ does not know (a newer content-ai) is left out, as `fromRow` leaves it out of `channels`.
  for (const p of posts) if (isChannel(p.channel)) by.set(p.item_id, [...(by.get(p.item_id) ?? []), p]);
  return rows.map((r) => ({ ...r, channel_posts: by.get(r.id) ?? [] }));
}

export function listContent(db: DatabaseSync, f: ContentFilter = {}): Extract<ContentList, { ready: true }> {
  const by = (["status", "format", "fb_page"] as const).filter((k) => f[k]);
  const where = by.map((k) => `${k} = ?`);
  const args = by.map((k) => f[k]!);
  const sql = `SELECT ${itemSelect(db)} FROM content_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ${LIST_MAX}`;
  const items = rowsOf(db, (db.prepare(sql).all(...args) as unknown as DbItem[]).map(fromRow), hasChannels(db));
  const pages = (db.prepare("SELECT DISTINCT fb_page FROM content_items ORDER BY fb_page").all() as { fb_page: string }[]).map((r) => r.fb_page);
  return { configured: true, ready: true, items, pages, schedule: hasSchedule(db), channels0065: hasChannels0065(db), assign: readAssignPref() };
}

export function getContent(db: DatabaseSync, id: number): ContentItem | null {
  const row = db.prepare(`SELECT ${itemSelect(db)} FROM content_items WHERE id = ?`).get(id) as unknown as DbItem | undefined;
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

/** The 0064 fields of a body, parsed. Absent on the body = absent here. */
type ChannelFields = { channels?: Channel[]; captions_json?: Captions | null };

/**
 * `channels`: a non-empty list of `CHANNELS`, no repeats. `captions_json`: `{channel: text}`
 * merged into the item's own (an empty text drops that channel's own caption, so it reads the shared
 * caption again), or null to drop them all. A DB before 0064 refuses both; one before 0065 (`wide`
 * false) refuses putting a `CHANNELS_0065` channel or its caption on the item (the worker's
 * `content_channel_posts` CHECK would reject its row), while dropping one still goes.
 */
function channelFields(body: Record<string, unknown>, has: boolean, wide: boolean, current: Captions | null): ChannelFields {
  const out: ChannelFields = {};
  if (!("channels" in body) && !("captions_json" in body)) return out;
  if (!has) throw new ContentError(NO_CHANNELS, 400);
  if ("channels" in body) {
    const v = body.channels;
    if (!Array.isArray(v) || v.length === 0 || !v.every(isChannel) || new Set(v).size !== v.length)
      throw new ContentError(`channels: danh sách không rỗng, không trùng, trong ${CHANNELS.join(", ")}`, 422);
    if (!wide && v.some(isChannel0065)) throw new ContentError(NO_CHANNELS_0065, 400);
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
      if (t && !wide && isChannel0065(k)) throw new ContentError(NO_CHANNELS_0065, 400);
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

/**
 * Contract 0064: entering approved needs every channel's caption within its limit, and YouTube a video
 * and a title. Before 0065 (`wide` false) an item still holding a `CHANNELS_0065` channel cannot be scheduled.
 */
function channelApproval(it: Pick<ContentItem, "title" | "caption" | "captions_json" | "channels" | "media_path">, wide: boolean): void {
  if (!wide && it.channels?.some(isChannel0065)) throw new ContentError(NO_CHANNELS_0065, 400);
  const why = channelGate({ ...it, media: mediaFiles(it.media_path) });
  if (why) throw new ContentError(why, 409);
}
export function createContent(db: DatabaseSync, body: Record<string, unknown>, now = Date.now()): ContentRow {
  if (!isFormat(body.format)) throw new ContentError("format: một trong text, infographic, course_video, ai_video, asmr, clip, other", 422);
  if (body.status !== undefined && !isStatus(body.status)) throw new ContentError("status: không hợp lệ", 422);
  const t = textFields(body);
  if (!t.title) throw new ContentError("title: không được trống", 422);
  const status: ContentStatus = (body.status as ContentStatus | undefined) ?? "ordered";
  const has = hasChannels(db);
  const wide = has && hasChannels0065(db);
  const ch = channelFields(body, has, wide, null);
  if (has && status === "approved")
    channelApproval({ title: t.title, caption: t.caption ?? null, captions_json: ch.captions_json ?? null, channels: ch.channels ?? ["facebook"], media_path: t.media_path ?? null }, wide);
  const row: Record<string, string | number | null> = {
    ...t,
    ...scheduleFields(db, body, now),
    ...channelColumns(ch),
    format: body.format,
    status,
    ...statusStamps(null, status, now),
    created_at: now,
    updated_at: now,
  };
  const cols = Object.keys(row);
  const id = write(() => db.prepare(`INSERT INTO content_items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c])).lastInsertRowid);
  return rowsOf(db, [getContent(db, Number(id))!], has)[0];
}

/** Thrown inside a write transaction to roll it back on purpose (`checkUpdate`). */
class DryRun extends Error {}

/**
 * Edit one item. Body: any text field, `format`, `status`, `scheduled_at`, `assignee_session` (+
 * `assignee_base`), and `approve_source: "<the source URL the owner saw>"` (records who and when;
 * 409 when the row's source has changed since). A new `source_url` drops an earlier approval: it approved the old source.
 * 0064: `channels`, `captions_json` (see `channelFields`) and `retry_channel: "<channel>"`, which
 * deletes that channel's failed / blocked / cancelled row so the worker plans it again (409 for any
 * other state: a live or posted one must not be posted twice). Entering approved checks the channel
 * rule and clears the item's cancelled rows (left from an earlier un-approve) so it is scheduled again.
 * `seen` (optional): the `updated_at` the caller had on screen; 409 `CONTENT_CHANGED` when the item changed since.
 * `guest`: the edit comes from a Chia sẻ guest: never `approved`/`published` (403), and see `GUEST_DROPBACK_FIELDS`.
 */
export function updateContent(db: DatabaseSync, id: number, body: Record<string, unknown>, approver: string, now = Date.now(), guest = false): ContentRow {
  applyUpdate(db, id, body, approver, now, false, guest);
  return rowsOf(db, [getContent(db, id)!], hasChannels(db))[0];
}

/** Whether `updateContent` would take this body: the same checks and the DB's triggers, then a rollback. Throws its refusal. */
export function checkUpdate(db: DatabaseSync, id: number, body: Record<string, unknown>, approver: string, now = Date.now()): void {
  applyUpdate(db, id, body, approver, now, true);
}

function applyUpdate(db: DatabaseSync, id: number, body: Record<string, unknown>, approver: string, now: number, dry: boolean, guest = false): void {
  const item = getContent(db, id);
  if (!item) throw new ContentError(`không có mục #${id}`, 404);
  // Only the owner approves or marks published (owner 2026-11-05); the route refuses it first.
  if (guest && typeof body.status === "string" && OWNER_CONTENT_STATUSES.includes(body.status)) throw new ContentError(GUEST_STATUS_DENIED, 403);
  if ("seen" in body) {
    if (typeof body.seen !== "number" || !Number.isFinite(body.seen)) throw new ContentError("seen: cần updated_at của mục lúc xem (số ms)", 422);
    if (item.updated_at !== body.seen) throw new ContentError(CONTENT_CHANGED, 409);
  }
  const has = hasChannels(db);
  const wide = has && hasChannels0065(db);
  const ch = channelFields(body, has, wide, item.captions_json ?? null);
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
  const nextMedia = "media_path" in set ? (set.media_path as string | null) : item.media_path;
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
  // A guest's change to what an approved item posts sends it back to "checked" (owner 2026-11-05):
  // the owner approves the text that goes out, and only the owner approves it again.
  if (guest && item.status === "approved") {
    const fields = GUEST_DROPBACK_FIELDS.filter((k) => k in set && (has || (k !== "channels" && k !== "captions_json")));
    if (fields.length) {
      const raw = db.prepare(`SELECT ${fields.join(", ")} FROM content_items WHERE id = ?`).get(id) as Record<string, unknown>;
      if (fields.some((k) => set[k] !== raw[k])) set.status = "checked";
    }
  }
  const final = (set.status as ContentStatus | undefined) ?? item.status;
  const entering = has && final === "approved" && item.status !== "approved";
  if (entering)
    channelApproval(
      {
        title: "title" in set ? (set.title as string) : item.title,
        caption: "caption" in set ? (set.caption as string | null) : item.caption,
        captions_json: "captions_json" in ch ? (ch.captions_json ?? null) : (item.captions_json ?? null),
        channels: ch.channels ?? item.channels,
        media_path: nextMedia,
      },
      wide,
    );
  const cols = Object.keys(set);
  if (cols.length === 0 && retry === null) throw new ContentError("không có gì để sửa", 400);
  try {
    write(() =>
      tx(db, () => {
        if (retry !== null) {
          // A row HQ handed to a posting room is that room's work in hand: a retry would let the
          // worker schedule it a second time.
          const row = db.prepare("SELECT state, error FROM content_channel_posts WHERE item_id = ? AND channel = ?").get(id, retry) as Pick<ChannelPost, "state" | "error"> | undefined;
          if (isHqClaim(row)) throw new ContentError("Phòng đăng đang xử lý kênh này", 409);
          const states = RETRYABLE_STATES.map(() => "?").join(", ");
          const gone = db.prepare(`DELETE FROM content_channel_posts WHERE item_id = ? AND channel = ? AND state IN (${states})`).run(id, retry, ...RETRYABLE_STATES).changes;
          if (gone === 0) throw new ContentError(`${CHANNEL_LABEL[retry]}: chỉ thử lại được khi kênh lỗi, bị chặn hoặc đã huỷ lịch.`, 409);
        }
        if (cols.length > 0) {
          set.updated_at = now;
          cols.push("updated_at");
          db.prepare(`UPDATE content_items SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => set[c]), id);
          if (entering) db.prepare("DELETE FROM content_channel_posts WHERE item_id = ? AND state = 'cancelled'").run(id);
        }
        if (dry) throw new DryRun();
      }),
    );
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
}

/** What "Duyệt" sends: an Owner message as `/api/messages` delivers it (`deliverText`). */
export type Sent = { delivery: string; live?: boolean; error: string | null };
export type Deliver = (session: string, text: string) => Promise<Sent>;

/** The longest task `/api/messages` takes (`clampText`'s default). */
const TASK_MAX = 4000;
/** What a stale approval answers: the item changed after the owner opened it. */
export const CONTENT_CHANGED = "Nội dung vừa được sửa — xem lại rồi duyệt";

/**
 * "Duyệt" in one tap (owner 2026-11-04): approve the item AND send its posting task to the chosen
 * session. Body: `session` (omp room id or Claude session id), `base` (its label), `seen` (the
 * item's `updated_at` the owner had on screen: required, 409 when the item changed since, so an
 * edit by someone else cannot ride on the owner's approval). Order: the whole approval is tried and
 * rolled back first (channel rule, the 0062 trigger), so a refusal sends nothing; then the task is delivered,
 * and a delivery that fails leaves the status as it was; then the approval and the assignee are
 * written, and the session becomes the default for the next approval. No write transaction is held
 * across the delivery.
 */
export async function approveAndSend(db: DatabaseSync, id: number, body: Record<string, unknown>, approver: string, deliver: Deliver, now = Date.now()): Promise<{ item: ContentRow; sent: Sent }> {
  const session = body.session;
  if (!isInboxId(session)) throw new ContentError("session: chọn phiên nhận việc đăng (id phòng omp hoặc session Claude)", 422);
  const rawBase = body.base;
  if (rawBase != null && (typeof rawBase !== "string" || rawBase.length > BASE_MAX)) throw new ContentError(`base: chuỗi tối đa ${BASE_MAX} ký tự`, 422);
  const base = typeof rawBase === "string" && rawBase.trim() ? rawBase.trim() : null;
  if (typeof body.seen !== "number") throw new ContentError("seen: cần updated_at của mục lúc chủ xem (số ms)", 422);
  const change: Record<string, unknown> = { status: "approved", seen: body.seen };
  if (hasSchedule(db)) Object.assign(change, { assignee_session: session, assignee_base: base });
  checkUpdate(db, id, change, approver, now);

  const text = clampText(publishTaskText(getContent(db, id)!), TASK_MAX);
  if (!text.ok) throw new ContentError(`Tin giao việc: ${text.error}`, 422);
  let sent: Sent;
  try {
    sent = await deliver(session, text.value);
  } catch (e) {
    throw new ContentError(`Chưa gửi được tới phiên, chưa duyệt: ${(e as Error).message}`, 502);
  }
  if (sent.delivery === "failed") throw new ContentError(`Chưa gửi được tới phiên, chưa duyệt: ${sent.error ?? "gửi lỗi"}`, 502);

  let row: ContentRow;
  try {
    row = updateContent(db, id, change, approver, now);
  } catch (e) {
    const status = e instanceof ContentError && e.status !== 409 ? e.status : 409;
    throw new ContentError(`Đã gửi tin cho phiên nhưng chưa duyệt được mục #${id}: ${(e as Error).message}`, status);
  }
  try {
    saveAssignPref({ session, base });
  } catch (e) {
    console.error("[hq] content: default session not saved:", (e as Error).message);
  }
  return { item: row, sent };
}

export function deleteContent(db: DatabaseSync, id: number): boolean {
  return write(() => db.prepare("DELETE FROM content_items WHERE id = ?").run(id).changes > 0);
}

/** Who approved a source from HQ: the account HQ runs under (the owner's machine). */
export const hqApprover = () => `hq:${os.userInfo().username}`;
