import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/content/route";
import { PUT as PUT_PREFS } from "@/app/api/content/prefs/route";
import { GET as MEDIA } from "@/app/api/content/media/route";
import { addDays, aiReason, byDay, capDay, captionFor, contentTaskText, contentWarning, dayKey, fromLocalInput, monthGrid, nextStatuses, NO_CHANNELS, NO_SCHEDULE, stepCursor, stepHint, toLocalInput, weekStart } from "@/lib/content";
import { getToken } from "@/lib/server/auth";
import { contentConfigPath, NO_REGISTRY } from "@/lib/server/content";
import { aiMark, mediaSigValid } from "@/lib/server/content-media";
import { contentPrefsPath } from "@/lib/server/content-prefs";
import { inboxDir, inboxFile } from "@/lib/server/inbox";
import { ORIGIN, req, tempHome } from "./helpers";

/** content-post-agency apps/content-ai/src/database/migrations/0062_content_registry.up.sql (table + gate). */
const MIGRATION_0062 = `
CREATE TABLE content_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  format TEXT NOT NULL CHECK (format IN ('text','infographic','course_video','ai_video','asmr','clip','other')),
  title TEXT NOT NULL, brief TEXT, caption TEXT, media_path TEXT,
  fb_page TEXT NOT NULL DEFAULT '8syncdev',
  source_url TEXT, source_approved_by TEXT, source_approved_at INTEGER,
  check_note TEXT, checked_at INTEGER, news_url TEXT, fb_post_url TEXT, published_at INTEGER,
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','drafted','checked','approved','published','rejected')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE TRIGGER content_items_gate_insert BEFORE INSERT ON content_items WHEN NEW.status IN ('approved','published')
BEGIN SELECT CASE
  WHEN NEW.source_url IS NULL OR NEW.source_approved_at IS NULL OR NEW.source_approved_by IS NULL THEN RAISE(ABORT, 'content_items: source must be approved before approved/published')
  WHEN NEW.checked_at IS NULL THEN RAISE(ABORT, 'content_items: item must be checked before approved/published')
  WHEN NEW.status = 'published' AND (NEW.news_url IS NULL OR NEW.fb_post_url IS NULL) THEN RAISE(ABORT, 'content_items: published needs news_url and fb_post_url')
END; END;
CREATE TRIGGER content_items_gate_update BEFORE UPDATE ON content_items WHEN NEW.status IN ('approved','published')
BEGIN SELECT CASE
  WHEN NEW.source_url IS NULL OR NEW.source_approved_at IS NULL OR NEW.source_approved_by IS NULL THEN RAISE(ABORT, 'content_items: source must be approved before approved/published')
  WHEN NEW.checked_at IS NULL THEN RAISE(ABORT, 'content_items: item must be checked before approved/published')
  WHEN NEW.status = 'published' AND (NEW.news_url IS NULL OR NEW.fb_post_url IS NULL) THEN RAISE(ABORT, 'content_items: published needs news_url and fb_post_url')
END; END;
`;
/** 0063_content_schedule.up.sql: the calendar's columns. */
const MIGRATION_0063 = `
ALTER TABLE content_items ADD COLUMN scheduled_at INTEGER;
ALTER TABLE content_items ADD COLUMN assignee_session TEXT;
ALTER TABLE content_items ADD COLUMN assignee_base TEXT;
ALTER TABLE content_items ADD COLUMN assigned_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_content_items_scheduled ON content_items(scheduled_at);
`;
/** 0064_content_channels.up.sql, verbatim: channels per item and one row per channel post. */
const MIGRATION_0064 = `
ALTER TABLE content_items ADD COLUMN channels TEXT NOT NULL DEFAULT '["facebook"]'
  CHECK (json_valid(channels) AND json_type(channels) = 'array');
ALTER TABLE content_items ADD COLUMN captions_json TEXT
  CHECK (captions_json IS NULL OR (json_valid(captions_json) AND json_type(captions_json) = 'object'));
ALTER TABLE content_items ADD COLUMN ai_label INTEGER NOT NULL DEFAULT 0 CHECK (ai_label IN (0,1));
CREATE TABLE IF NOT EXISTS content_channel_posts (
  item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('facebook','linkedin','threads','youtube')),
  state TEXT NOT NULL CHECK (state IN ('scheduling','scheduled','published','failed','blocked','cancelled')),
  scheduled_for INTEGER,
  permalink TEXT,
  published_at INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (item_id, channel)
);
`;

let home = "";
let token = "";
const call = (method: string, q: string, body?: unknown) => req(`/api/content${q}`, { method, token, origin: method === "GET" ? null : ORIGIN, body });
const configure = (db: string) => {
  fs.mkdirSync(path.dirname(contentConfigPath()), { recursive: true });
  fs.writeFileSync(contentConfigPath(), JSON.stringify({ db }));
};
function makeDb(name: string, schema: string | null): string {
  const file = path.join(home, name);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  if (schema) db.exec(schema);
  db.close();
  return file;
}

beforeAll(() => {
  home = tempHome();
  token = getToken();
});
afterEach(() => {
  fs.rmSync(contentConfigPath(), { force: true });
  delete process.env.EIGHTSYNC_CONTENT_DB;
});

describe("/api/content without a configured DB", () => {
  it("reports not configured (the view stays hidden) and refuses writes", async () => {
    expect(await (await GET(call("GET", "?probe=1"))).json()).toEqual({ configured: false });
    expect(await (await GET(call("GET", ""))).json()).toEqual({ configured: false });
    const res = await POST(call("POST", "", { format: "text", title: "x" }));
    expect(res.status).toBe(404);
  });
  it("a configured file that is missing is reported, never created", async () => {
    const file = path.join(home, "nope.db");
    configure(file);
    expect(await (await GET(call("GET", "?probe=1"))).json()).toEqual({ configured: true });
    const body = await (await GET(call("GET", ""))).json();
    expect(body).toMatchObject({ configured: true, ready: false });
    expect(body.error).toContain(file);
    expect(fs.existsSync(file)).toBe(false);
  });
  it("a DB without the registry says how to get it and gets no table from HQ", async () => {
    const file = makeDb("bare.db", "CREATE TABLE other (x);");
    configure(file);
    expect(await (await GET(call("GET", ""))).json()).toEqual({ configured: true, ready: false, error: NO_REGISTRY });
    expect((await POST(call("POST", "", { format: "text", title: "x" }))).status).toBe(409);
    const db = new DatabaseSync(file, { readOnly: true });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'content_items'").get()).toBeUndefined();
    db.close();
  });
  it("a configured file that is not SQLite is reported in the view, not a 500", async () => {
    const file = path.join(home, "notes.db");
    fs.writeFileSync(file, "not a database, just notes");
    configure(file);
    const res = await GET(call("GET", ""));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: true, ready: false, error: expect.stringContaining("không") });
  });
  it("EIGHTSYNC_CONTENT_DB wins over content.json; a relative path is refused", async () => {
    configure(path.join(home, "nope.db"));
    process.env.EIGHTSYNC_CONTENT_DB = "relative/daily.db";
    const body = await (await GET(call("GET", ""))).json();
    expect(body.ready).toBe(false);
    expect(body.error).toContain("relative/daily.db");
  });
});

describe("/api/content against the 0062 gate", () => {
  it("publishing without news_url answers 409 with the trigger's message; the full path then passes", async () => {
    configure(makeDb("gate.db", MIGRATION_0062));
    const created = await POST(call("POST", "", { format: "infographic", title: "  Bài A  ", fb_page: "zus", source_url: "https://example.com/a" }));
    expect(created.status).toBe(201);
    const { item } = await created.json();
    expect(item).toMatchObject({ title: "Bài A", fb_page: "zus", status: "ordered", source_approved_at: null });
    const q = `?id=${item.id}`;

    let res = await PATCH(call("PATCH", q, { status: "approved" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("content_items: source must be approved before approved/published");

    res = await PATCH(call("PATCH", q, { approve_source: "https://example.com/a" }));
    expect((await res.json()).item.source_approved_by).toMatch(/^hq:/);
    res = await PATCH(call("PATCH", q, { status: "checked" }));
    expect((await res.json()).item.checked_at).toEqual(expect.any(Number));
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(200);

    res = await PATCH(call("PATCH", q, { status: "published", fb_post_url: "https://facebook.com/p/1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("content_items: published needs news_url and fb_post_url");
    // The refused write left the row as it was.
    const list = await (await GET(call("GET", "?status=approved"))).json();
    expect(list.items.map((i: { id: number; fb_post_url: string | null }) => [i.id, i.fb_post_url])).toEqual([[item.id, null]]);

    res = await PATCH(call("PATCH", q, { status: "published", fb_post_url: "https://facebook.com/p/1", news_url: "https://news.8syncdev.com/a" }));
    expect(res.status).toBe(200);
    expect((await res.json()).item).toMatchObject({ status: "published", published_at: expect.any(Number) });
  });
  it("a new source drops the earlier approval; an empty field becomes NULL", async () => {
    configure(makeDb("src.db", MIGRATION_0062));
    const { item } = await (await POST(call("POST", "", { format: "text", title: "B", source_url: "https://a" }))).json();
    // Approval names the source the owner saw: one changed since is refused, not approved unseen.
    const stale = await PATCH(call("PATCH", `?id=${item.id}`, { approve_source: "https://old" }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/Nguồn đã đổi/);
    await PATCH(call("PATCH", `?id=${item.id}`, { approve_source: "https://a" }));
    const same = (await (await PATCH(call("PATCH", `?id=${item.id}`, { source_url: "https://a", caption: "" }))).json()).item;
    expect(same.source_approved_at).toEqual(expect.any(Number));
    expect(same.caption).toBeNull();
    const moved = (await (await PATCH(call("PATCH", `?id=${item.id}`, { source_url: "https://b" }))).json()).item;
    expect(moved).toMatchObject({ source_url: "https://b", source_approved_by: null, source_approved_at: null });
  });
  it("bad values are 422 before SQL; filters, delete", async () => {
    configure(makeDb("crud.db", MIGRATION_0062));
    expect((await POST(call("POST", "", { format: "podcast", title: "x" }))).status).toBe(422);
    expect((await POST(call("POST", "", { format: "text", title: "  " }))).status).toBe(422);
    expect((await GET(call("GET", "?status=done"))).status).toBe(400);
    const a = (await (await POST(call("POST", "", { format: "clip", title: "C", fb_page: "zus" }))).json()).item;
    await POST(call("POST", "", { format: "text", title: "D" }));
    const zus = await (await GET(call("GET", "?fb_page=zus"))).json();
    expect(zus.items.map((i: { title: string }) => i.title)).toEqual(["C"]);
    expect(zus.pages).toEqual(["8syncdev", "zus"]);
    expect((await DELETE(call("DELETE", `?id=${a.id}`))).status).toBe(200);
    expect((await DELETE(call("DELETE", `?id=${a.id}`))).status).toBe(404);
    expect((await PATCH(call("PATCH", "?id=abc", { title: "x" }))).status).toBe(400);
  });
});

/** Source approved and checked: the next step is the owner's Duyệt. */
async function readyToApprove(fields: Record<string, unknown>): Promise<string> {
  const { item } = await (await POST(call("POST", "", { title: "Bài", source_url: "https://s", ...fields }))).json();
  const q = `?id=${item.id}`;
  await PATCH(call("PATCH", q, { approve_source: "https://s" }));
  expect((await PATCH(call("PATCH", q, { status: "checked" }))).status).toBe(200);
  return q;
}

describe("/api/content calendar fields (0063)", () => {
  it("scheduled_at and the assignee are stored, validated and cleared", async () => {
    configure(makeDb("sched.db", MIGRATION_0062 + MIGRATION_0063));
    const at = new Date(2026, 10, 4, 19, 30).getTime();
    const created = await POST(call("POST", "", { format: "text", title: "A", scheduled_at: at }));
    expect(created.status).toBe(201);
    const { item } = await created.json();
    expect(item).toMatchObject({ scheduled_at: at, assignee_session: null, media: [] });
    const q = `?id=${item.id}`;

    for (const scheduled_at of ["2026-11-04", 1.5, 0, Date.UTC(2100, 0, 1)]) expect((await PATCH(call("PATCH", q, { scheduled_at }))).status).toBe(422);
    expect((await PATCH(call("PATCH", q, { assignee_session: "core; rm -rf" }))).status).toBe(422);

    let res = await PATCH(call("PATCH", q, { assignee_session: "omp-2364d8b9ca3a61ed", assignee_base: "mkt · 8sync-startup" }));
    expect(res.status).toBe(200);
    expect((await res.json()).item).toMatchObject({ assignee_session: "omp-2364d8b9ca3a61ed", assignee_base: "mkt · 8sync-startup", assigned_at: expect.any(Number) });
    // Saved in the DB: a fresh read (the reload the owner does) shows the same session.
    const listed = (await (await GET(call("GET", ""))).json()) as { schedule: boolean; items: { id: number; assignee_session: string | null }[] };
    expect(listed.schedule).toBe(true);
    expect(listed.items.find((i) => i.id === item.id)?.assignee_session).toBe("omp-2364d8b9ca3a61ed");

    res = await PATCH(call("PATCH", q, { assignee_session: null, scheduled_at: null }));
    expect((await res.json()).item).toMatchObject({ assignee_session: null, assignee_base: null, assigned_at: null, scheduled_at: null });
  });
  it("a DB before 0063 lists without the calendar and refuses its fields with the reason", async () => {
    configure(makeDb("old.db", MIGRATION_0062));
    const { item } = await (await POST(call("POST", "", { format: "text", title: "A" }))).json();
    expect((await (await GET(call("GET", ""))).json()).schedule).toBe(false);
    const res = await PATCH(call("PATCH", `?id=${item.id}`, { scheduled_at: Date.now() }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(NO_SCHEDULE);
    // Other edits still work.
    expect((await PATCH(call("PATCH", `?id=${item.id}`, { caption: "x" }))).status).toBe(200);
  });
  it("approving an AI-made item needs the owner's AI choice; the DB gate still runs after it", async () => {
    configure(makeDb("ai.db", MIGRATION_0062 + MIGRATION_0063));
    const q = await readyToApprove({ format: "ai_video" });
    let res = await PATCH(call("PATCH", q, { status: "approved" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/^Mục có thể dùng AI \(.+\)/);
    expect((await PATCH(call("PATCH", q, { status: "approved", ai_label: "có" }))).status).toBe(422);
    // Before 0064 the choice is taken but there is no column to keep it in.
    res = await PATCH(call("PATCH", q, { status: "approved", ai_label: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).item).not.toHaveProperty("ai_label");

    // The choice is no way around the trigger: an unchecked item stays refused by the DB.
    const { item } = await (await POST(call("POST", "", { format: "ai_video", title: "B" }))).json();
    res = await PATCH(call("PATCH", `?id=${item.id}`, { status: "approved", ai_label: false }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("content_items: source must be approved before approved/published");
  });
  it("an approved item edited into AI content without the choice drops back to checked; asking for approved again is refused", async () => {
    configure(makeDb("ai-swap.db", MIGRATION_0062 + MIGRATION_0063));
    const q = await readyToApprove({ format: "text" });
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(200);
    let res = await PATCH(call("PATCH", q, { format: "ai_video" }));
    expect(res.status).toBe(200);
    expect((await res.json()).item).toMatchObject({ format: "ai_video", status: "checked" });
    // Re-approving the AI version needs the choice.
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(409);
    expect((await PATCH(call("PATCH", q, { status: "approved", ai_label: true }))).status).toBe(200);

    // Same for new media, and sending status "approved" with the change is a 409, not a silent demote.
    const r = await readyToApprove({ format: "text" });
    expect((await PATCH(call("PATCH", r, { status: "approved" }))).status).toBe(200);
    const dir = path.join(home, "swap-media");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "r.mp4"), Buffer.alloc(64));
    expect((await PATCH(call("PATCH", r, { status: "approved", media_path: dir }))).status).toBe(409);
    res = await PATCH(call("PATCH", r, { media_path: dir }));
    expect((await res.json()).item.status).toBe("checked");
    // With the choice the item stays approved; edits that do not touch the AI rule stay free.
    expect((await PATCH(call("PATCH", r, { status: "approved", ai_label: false }))).status).toBe(200);
    expect((await (await PATCH(call("PATCH", r, { caption: "mới" }))).json()).item.status).toBe("approved");
  });
  it("publishing an AI item needs the choice from any status, including a video added after approval; a published post refuses the swap", async () => {
    configure(makeDb("ai-pub.db", MIGRATION_0062 + MIGRATION_0063));
    const links = { news_url: "https://n", fb_post_url: "https://f" };
    // The trigger checks fields, not the previous status: checked → published must not skip the choice.
    const q = await readyToApprove({ format: "ai_video", ...links });
    let res = await PATCH(call("PATCH", q, { status: "published" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/^Mục có thể dùng AI/);
    expect((await POST(call("POST", "", { format: "ai_video", title: "C", status: "published" }))).status).toBe(409);

    // A text item approved with a clean media folder; a video lands there afterwards.
    const dir = path.join(home, "late-media");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.txt"), "caption");
    const r = await readyToApprove({ format: "text", media_path: dir, ...links });
    expect((await PATCH(call("PATCH", r, { status: "approved" }))).status).toBe(200);
    fs.writeFileSync(path.join(dir, "r.mp4"), Buffer.alloc(64));
    expect((await PATCH(call("PATCH", r, { status: "published" }))).status).toBe(409);
    expect((await PATCH(call("PATCH", r, { status: "published", ai_label: true }))).status).toBe(200);

    const t = await readyToApprove({ format: "text", ...links });
    expect((await PATCH(call("PATCH", t, { status: "approved" }))).status).toBe(200);
    expect((await PATCH(call("PATCH", t, { status: "published" }))).status).toBe(200);
    res = await PATCH(call("PATCH", t, { format: "ai_video" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/^Bài đã đăng không đổi sang nội dung rủi ro nhãn AI/);
  });
  it("a 1-tap step the trigger would refuse says why", () => {
    const base = { source_approved_at: 1, checked_at: 1, news_url: "https://n", fb_post_url: "https://f" };
    expect(stepHint({ ...base, source_approved_at: null }, "approved")).toBe("Duyệt nguồn trước");
    expect(stepHint({ ...base, checked_at: null }, "approved")).toBe("Mục chưa ghi giờ check (checked_at trống)");
    expect(stepHint({ ...base, fb_post_url: null }, "approved")).toBeNull();
    expect(stepHint({ ...base, fb_post_url: null }, "published")).toBe("Điền link tin news và bài FB trước");
    expect(stepHint({ ...base, source_approved_at: null }, "rejected")).toBeNull();
    expect(stepHint(base, "published")).toBeNull();
  });
  it("media with Content Credentials or an IPTC AI source flags the item; plain media does not", async () => {
    const dir = path.join(home, "media");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(5000), Buffer.from("jumb c2pa.claim v2"), Buffer.alloc(10)]));
    fs.writeFileSync(path.join(dir, "b.jpg"), Buffer.concat([Buffer.alloc(100), Buffer.from("Iptc4xmpExt:DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia")]));
    fs.writeFileSync(path.join(dir, "c.mp4"), Buffer.from(Array.from({ length: 2048 }, (_, k) => k % 251)));
    fs.writeFileSync(path.join(dir, "notes.txt"), "c2pa.claim");
    expect(aiMark(path.join(dir, "a.png"))).toMatch(/C2PA/);
    expect(aiMark(path.join(dir, "b.jpg"))).toMatch(/IPTC/);
    expect(aiMark(path.join(dir, "c.mp4"))).toBeNull();
    // A long render is read at both ends only: an MP4 with its manifest after mdat is still caught.
    const big = path.join(home, "big.mp4");
    fs.writeFileSync(big, Buffer.concat([Buffer.alloc(20 * 1024 * 1024), Buffer.from("c2pa.claim"), Buffer.alloc(64)]));
    expect(aiMark(big)).toMatch(/C2PA/);

    configure(makeDb("media.db", MIGRATION_0062 + MIGRATION_0063));
    const q = await readyToApprove({ format: "infographic", media_path: dir });
    const { items } = await (await GET(call("GET", ""))).json();
    const row = items.find((i: { media_path: string }) => i.media_path === dir);
    expect(row.media.map((m: { name: string; kind: string; ai: string | null }) => [m.name, m.kind, m.ai != null])).toEqual([
      ["a.png", "image", true],
      ["b.jpg", "image", true],
      ["c.mp4", "video", false],
    ]);
    expect(aiReason(row)).toMatch(/a\.png/);
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(409);

    // The preview route serves the item's files by index only.
    const get = (query: string) => MEDIA(req(`/api/content/media${query}`, { method: "GET", token, origin: null }));
    const video = await get(`?id=${row.id}&i=2`);
    expect(video.status).toBe(200);
    expect(video.headers.get("content-type")).toBe("video/mp4");
    expect((await video.arrayBuffer()).byteLength).toBe(2048);
    // The name pins the file: a folder that shifted since the list answers 409, not another file.
    expect((await get(`?id=${row.id}&i=2&n=c.mp4`)).status).toBe(200);
    expect((await get(`?id=${row.id}&i=1&n=c.mp4`)).status).toBe(409);
    expect((await get(`?id=${row.id}&i=3`)).status).toBe(404);
    expect((await get(`?id=9999&i=0`)).status).toBe(404);
    expect((await get(`?id=${row.id}&i=../notes.txt`)).status).toBe(400);
    expect((await MEDIA(req(`/api/content/media?id=${row.id}&i=0`, { method: "GET", token: null, origin: null }))).status).toBe(401);

    // The list's signed URL works with no token (a <video src> / download link cannot send one).
    const signed = row.media[2].url as string;
    const plain = (url: string, range?: string) =>
      MEDIA(new Request(ORIGIN + url, { headers: range ? { host: "127.0.0.1:8740", range } : { host: "127.0.0.1:8740" } }));
    const whole = await plain(signed);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-disposition")).toBeNull();
    const bytesOf = fs.readFileSync(path.join(dir, "c.mp4"));
    expect(Buffer.from(await whole.arrayBuffer()).equals(bytesOf)).toBe(true);
    // Range: the player seeks without pulling the whole file.
    const mid = await plain(signed, "bytes=100-199");
    expect(mid.status).toBe(206);
    expect(mid.headers.get("content-range")).toBe("bytes 100-199/2048");
    expect(Buffer.from(await mid.arrayBuffer()).equals(bytesOf.subarray(100, 200))).toBe(true);
    const tail = await plain(signed, "bytes=-10");
    expect(tail.headers.get("content-range")).toBe("bytes 2038-2047/2048");
    expect(Buffer.from(await tail.arrayBuffer()).equals(bytesOf.subarray(2038))).toBe(true);
    const open = await plain(signed, "bytes=2000-");
    expect(open.headers.get("content-length")).toBe("48");
    const past = await plain(signed, "bytes=5000-");
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */2048");
    // An invalid range (last < first) or several ranges: the whole file, not 416.
    for (const r of ["bytes=5-3", "bytes=0-1,5-6"]) {
      const res = await plain(signed, r);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("2048");
    }
    // "Tải": attachment under the file's own name.
    expect((await plain(`${signed}&dl=1`)).headers.get("content-disposition")).toBe(`attachment; filename="c.mp4"; filename*=UTF-8''c.mp4`);
    // The signature pins item, index, name and size: any other value, or a forged one, is refused.
    expect((await plain(signed.replace("&i=2&", "&i=1&"))).status).toBe(401);
    expect((await plain(signed.replace(/sig=([0-9a-f])/, (_, c: string) => `sig=${c === "0" ? "1" : "0"}`))).status).toBe(401);
    expect((await plain(signed.replace(/&s=\d+/, "&s=2049"))).status).toBe(401);
    const sp = new URL(ORIGIN + signed).searchParams;
    const exp = Number(sp.get("e"));
    expect(mediaSigValid(sp.get("sig") ?? "", row.id, 2, "c.mp4", 2048, exp, exp - 1)).toBe(true);
    expect(mediaSigValid(sp.get("sig") ?? "", row.id, 2, "c.mp4", 2048, exp, exp)).toBe(false);
    // The file was re-rendered since the list: same name, new size → 409, not the wrong bytes.
    fs.appendFileSync(path.join(dir, "c.mp4"), Buffer.alloc(1));
    expect((await plain(signed)).status).toBe(409);
  });
});

describe("calendar math (local time)", () => {
  it("month grid: 6 weeks from the Monday on or before the 1st", () => {
    const g = monthGrid(2026, 10); // November 2026 starts on a Sunday.
    expect(g).toHaveLength(42);
    expect(dayKey(g[0])).toBe("2026-10-26");
    expect(dayKey(g[6])).toBe("2026-11-01");
    expect(dayKey(weekStart(new Date(2026, 10, 1)))).toBe("2026-10-26");
    expect(dayKey(addDays(new Date(2026, 11, 31), 1))).toBe("2027-01-01");
  });
  it("steps never skip a short month; a day key and a datetime-local value round-trip", () => {
    expect(dayKey(stepCursor(new Date(2026, 0, 31), "month", 1))).toBe("2026-02-01");
    expect(dayKey(stepCursor(new Date(2026, 2, 1), "week", -1))).toBe("2026-02-22");
    const at = new Date(2026, 10, 4, 7, 5).getTime();
    expect(toLocalInput(at)).toBe("2026-11-04T07:05");
    expect(fromLocalInput("2026-11-04T07:05")).toBe(at);
    expect(fromLocalInput("2026-11-04")).toBeNull();
  });
  it("by day: scheduled wins over published, each day in time order, undated left out", () => {
    const t = (h: number, d = 4) => new Date(2026, 10, d, h).getTime();
    const m = byDay([
      { id: 1, scheduled_at: t(20), published_at: t(9, 1) },
      { id: 2, scheduled_at: null, published_at: t(8) },
      { id: 3, scheduled_at: null, published_at: null },
    ]);
    expect([...m.entries()].map(([k, v]) => [k, v.map((i) => i.id)])).toEqual([["2026-11-04", [2, 1]]]);
  });
});

describe("content rules", () => {
  it("flow buttons: next step then Bỏ; rejected reopens; published ends", () => {
    expect(nextStatuses("ordered")).toEqual(["drafted", "rejected"]);
    expect(nextStatuses("approved")).toEqual(["published", "rejected"]);
    expect(nextStatuses("published")).toEqual([]);
    expect(nextStatuses("rejected")).toEqual(["ordered"]);
  });
  it("red flag only once a Facebook post exists without news or an approved source", () => {
    const ok = { fb_post_url: "https://fb/1", news_url: "https://n/1", source_url: "https://s", source_approved_at: 1 };
    expect(contentWarning({ ...ok, fb_post_url: null, news_url: null })).toBeNull();
    expect(contentWarning(ok)).toBeNull();
    expect(contentWarning({ ...ok, news_url: null })).toBe("Đã có bài FB nhưng thiếu tin news");
    expect(contentWarning({ ...ok, source_approved_at: null })).toBe("Đã có bài FB nhưng nguồn chưa duyệt");
    expect(contentWarning({ ...ok, source_url: null, source_approved_at: null, news_url: null })).toBe("Đã có bài FB nhưng thiếu tin news, thiếu nguồn");
  });
  it("every video needs the no-AI check, marked or not (reel 1.2: lip-sync + cloned voice, no C2PA); plain text and images do not", () => {
    for (const format of ["course_video", "clip", "asmr", "ai_video"] as const) expect(aiReason({ format })).not.toBeNull();
    expect(aiReason({ format: "text", media: [{ name: "a.mp4", kind: "video", ai: null }] })).toMatch(/^video/);
    expect(aiReason({ format: "infographic", media: [{ name: "a.png", kind: "image", ai: null }] })).toBeNull();
    expect(aiReason({ format: "text" })).toBeNull();
  });
  it("the task names the item", () => {
    expect(contentTaskText({ id: 12, title: "Bài A", fb_page: "zus" }, " sửa caption ")).toBe("[Nội dung #12 · zus] Bài A\nsửa caption");
  });
});

describe("/api/content channels (0064)", () => {
  const ALL = MIGRATION_0062 + MIGRATION_0063 + MIGRATION_0064;
  const V1 = "=== FACEBOOK (Page) — 20:30 ===\nA\n\n=== LINKEDIN ===\nB\n=== THREADS — x ===\nC";
  const CHS = ["facebook", "linkedin", "threads", "youtube"] as const;
  /** The rows the worker would write, straight into the DB file. */
  function putPost(file: string, item: number, channel: string, state: string) {
    const db = new DatabaseSync(file);
    db.prepare("INSERT OR REPLACE INTO content_channel_posts (item_id, channel, state, error) VALUES (?, ?, ?, ?)").run(item, channel, state, state === "scheduled" ? null : "lỗi thử");
    db.close();
  }
  function posts(file: string): [string, string][] {
    const db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("SELECT channel, state FROM content_channel_posts ORDER BY item_id, channel").all() as { channel: string; state: string }[];
    db.close();
    return rows.map((r) => [r.channel, r.state]);
  }

  it("caption per channel: own caption, else its section, else the whole plain caption for Facebook only", () => {
    const of = (caption: string | null, captions_json: Record<string, string> | null = null) => CHS.map((ch) => captionFor({ caption, captions_json }, ch));
    expect(of(V1)).toEqual(["A", "B", "C", null]);
    expect(of("plain")).toEqual(["plain", null, null, null]);
    expect(of(V1, { linkedin: "X" })).toEqual(["A", "X", "C", null]);
    expect(of(V1, { threads: "  " })).toEqual(["A", "B", "C", null]);
    // A section under an unknown header is dropped; an empty section is no caption.
    expect(of("=== TIKTOK ===\nT\n=== LINKEDIN ===\n  \n=== YOUTUBE ===\nY")).toEqual([null, null, null, "Y"]);
    expect(of(null)).toEqual([null, null, null, null]);
  });

  it("channels and captions_json are validated, merged and stored (NULL once no own caption is left)", async () => {
    const file = makeDb("ch.db", ALL);
    configure(file);
    const { item } = await (await POST(call("POST", "", { format: "text", title: "A", caption: V1 }))).json();
    expect(item).toMatchObject({ channels: ["facebook"], captions_json: null, channel_posts: [] });
    const q = `?id=${item.id}`;
    for (const channels of [[], ["facebook", "facebook"], ["tiktok"], "facebook", null]) expect((await PATCH(call("PATCH", q, { channels }))).status).toBe(422);
    for (const captions_json of [{ tiktok: "x" }, { threads: 5 }, ["x"], "x"]) expect((await PATCH(call("PATCH", q, { captions_json }))).status).toBe(422);

    let res = await PATCH(call("PATCH", q, { channels: ["threads", "facebook"], captions_json: { threads: "  T  " } }));
    expect((await res.json()).item).toMatchObject({ channels: ["threads", "facebook"], captions_json: { threads: "T" } });
    res = await PATCH(call("PATCH", q, { captions_json: { linkedin: "L" } }));
    expect((await res.json()).item.captions_json).toEqual({ threads: "T", linkedin: "L" });
    res = await PATCH(call("PATCH", q, { captions_json: { threads: "" } }));
    expect((await res.json()).item.captions_json).toEqual({ linkedin: "L" });
    res = await PATCH(call("PATCH", q, { captions_json: { linkedin: "" } }));
    expect((await res.json()).item.captions_json).toBeNull();
    const db = new DatabaseSync(file, { readOnly: true });
    expect(db.prepare("SELECT channels, captions_json FROM content_items WHERE id = ?").get(item.id)).toMatchObject({ channels: '["threads","facebook"]', captions_json: null });
    db.close();
  });

  it("entering approved needs every channel's caption within its limit and YouTube a video file; the refusal is the sheet's hint and changes nothing", async () => {
    configure(makeDb("appr.db", ALL));
    const q = await readyToApprove({ format: "infographic", caption: "plain", channels: ["facebook", "threads"] });
    const approve = async (extra: Record<string, unknown> = {}) => {
      const res = await PATCH(call("PATCH", q, { status: "approved", ...extra }));
      return { status: res.status, body: await res.json() };
    };
    let r = await approve();
    expect(r.status).toBe(409);
    // The refused write left the item checked, and the sheet's hint says the same as the API.
    let it = (await (await PATCH(call("PATCH", q, { captions_json: { threads: "x".repeat(501) } }))).json()).item;
    expect(it.status).toBe("checked");
    expect(stepHint(it, "approved")).not.toBeNull();
    r = await approve();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(stepHint(it, "approved"));
    // Limits count characters, not UTF-16 units: 500 emoji fit Threads.
    it = (await (await PATCH(call("PATCH", q, { captions_json: { threads: "😀".repeat(500) } }))).json()).item;
    expect(stepHint(it, "approved")).toBeNull();
    expect((await approve()).status).toBe(200);

    // YouTube: a folder is no video, nor a missing file, nor an over-long title.
    const dir = path.join(home, "yt");
    fs.mkdirSync(dir, { recursive: true });
    const video = path.join(dir, "v.MP4");
    fs.writeFileSync(video, Buffer.alloc(64));
    const y = await readyToApprove({ format: "clip", title: "Video", caption: "=== YOUTUBE ===\nMô tả", channels: ["youtube"], media_path: dir });
    const approveY = async () => (await PATCH(call("PATCH", y, { status: "approved", ai_label: true }))).status;
    expect(await approveY()).toBe(409);
    await PATCH(call("PATCH", y, { media_path: path.join(dir, "missing.mp4") }));
    expect(await approveY()).toBe(409);
    await PATCH(call("PATCH", y, { media_path: video, title: "x".repeat(101) }));
    expect(await approveY()).toBe(409);
    await PATCH(call("PATCH", y, { title: "Video" }));
    expect(await approveY()).toBe(200);
  });

  it("Thử lại deletes only a failed, blocked or cancelled row; the list carries each item's rows; re-approving clears cancelled rows", async () => {
    const file = makeDb("retry.db", ALL);
    configure(file);
    const q = await readyToApprove({ format: "infographic", caption: V1, channels: ["facebook", "linkedin", "threads"] });
    const id = Number(q.slice("?id=".length));
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(200);
    putPost(file, id, "facebook", "scheduled");
    putPost(file, id, "linkedin", "failed");
    putPost(file, id, "threads", "blocked");
    const listed = (await (await GET(call("GET", ""))).json()).items.find((i: { id: number }) => i.id === id);
    expect(listed.channel_posts.map((p: { channel: string; state: string }) => [p.channel, p.state])).toEqual([
      ["facebook", "scheduled"],
      ["linkedin", "failed"],
      ["threads", "blocked"],
    ]);

    expect((await PATCH(call("PATCH", q, { retry_channel: "facebook" }))).status).toBe(409);
    expect((await PATCH(call("PATCH", q, { retry_channel: "youtube" }))).status).toBe(409);
    expect((await PATCH(call("PATCH", q, { retry_channel: "tiktok" }))).status).toBe(422);
    // A refused retry leaves the other changes of the same write undone too.
    expect((await PATCH(call("PATCH", q, { retry_channel: "facebook", caption: "khác" }))).status).toBe(409);
    const res = await PATCH(call("PATCH", q, { retry_channel: "linkedin" }));
    expect(res.status).toBe(200);
    expect((await res.json()).item).toMatchObject({ caption: V1, status: "approved" });
    expect(posts(file)).toEqual([
      ["facebook", "scheduled"],
      ["threads", "blocked"],
    ]);

    // Un-approve: the worker cancels the scheduled post and keeps the row; approving again clears it so the post is planned again.
    expect((await PATCH(call("PATCH", q, { status: "checked" }))).status).toBe(200);
    putPost(file, id, "facebook", "cancelled");
    expect((await PATCH(call("PATCH", q, { caption: V1 }))).status).toBe(200);
    expect(posts(file)).toEqual([
      ["facebook", "cancelled"],
      ["threads", "blocked"],
    ]);
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(200);
    expect(posts(file)).toEqual([["threads", "blocked"]]);
  });

  it("a DB before 0064 lists and approves as before and refuses the channel fields with the reason", async () => {
    configure(makeDb("pre64.db", MIGRATION_0062 + MIGRATION_0063));
    const q = await readyToApprove({ format: "infographic" });
    for (const body of [{ channels: ["facebook"] }, { captions_json: { threads: "x" } }, { retry_channel: "facebook" }]) {
      const res = await PATCH(call("PATCH", q, body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(NO_CHANNELS);
    }
    expect((await POST(call("POST", "", { format: "text", title: "B", channels: ["threads"] }))).status).toBe(400);
    const { items } = await (await GET(call("GET", ""))).json();
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("channels");
    expect(items[0]).not.toHaveProperty("channel_posts");
    // No caption at all: without 0064 there is no channel rule to meet.
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(200);
  });
});

describe("/api/content Duyệt = approve + send (owner 2026-11-04)", () => {
  const ALL = MIGRATION_0062 + MIGRATION_0063 + MIGRATION_0064;
  const ROOM = "omp-2364d8b9ca3a61ed";
  const send = (q: string, extra: Record<string, unknown> = {}) => PATCH(call("PATCH", q, { status: "approved", send: { session: ROOM, base: "mkt · 8sync-startup" }, ...extra }));
  const queued = (): string[] => {
    try {
      return fs.readFileSync(inboxFile(ROOM), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).text as string);
    } catch {
      return [];
    }
  };
  const statusOf = async (q: string) => (await (await GET(call("GET", ""))).json()).items.find((i: { id: number }) => `?id=${i.id}` === q).status;
  afterEach(() => {
    fs.rmSync(inboxDir(), { recursive: true, force: true });
    fs.rmSync(contentPrefsPath(), { force: true });
  });

  it("approves, sends the posting task to the session, records the holder and makes it the default", async () => {
    configure(makeDb("send.db", ALL));
    const at = new Date(2026, 10, 5, 18, 0).getTime();
    const q = await readyToApprove({ format: "course_video", title: "C++ bài 1", caption: "=== FACEBOOK ===\nCap FB\n=== THREADS ===\nCap TH", channels: ["facebook", "threads"], scheduled_at: at });
    const id = Number(q.slice("?id=".length));
    const res = await send(q, { ai_label: true });
    expect(res.status).toBe(200);
    expect((await res.json()).item).toMatchObject({ status: "approved", ai_label: true, assignee_session: ROOM, assignee_base: "mkt · 8sync-startup", assigned_at: expect.any(Number) });
    const [task, ...rest] = queued();
    expect(rest).toHaveLength(0);
    expect(task.split("\n")[0]).toBe(`[Nội dung #${id} · 8syncdev] C++ bài 1`);
    expect(task).toContain("Cap FB");
    expect(task).toContain("Cap TH");
    expect(task).toContain(`--only ${id}`);
    // A reload: the item still shows its holder; the session is the default for the next item.
    const listed = await (await GET(call("GET", ""))).json();
    expect(listed.items.find((i: { id: number }) => i.id === id)).toMatchObject({ status: "approved", assignee_session: ROOM });
    expect(listed.assign).toEqual({ session: ROOM, base: "mkt · 8sync-startup" });
  });

  it("a refusal sends nothing: missing AI choice, a channel rule, a bad session or body", async () => {
    configure(makeDb("send-refused.db", ALL));
    const v = await readyToApprove({ format: "course_video", caption: "x", channels: ["facebook"] });
    expect((await send(v)).status).toBe(409);
    const t = await readyToApprove({ format: "infographic", caption: "=== FACEBOOK ===\nA", channels: ["facebook", "threads"] });
    expect((await send(t)).status).toBe(409);
    expect((await PATCH(call("PATCH", t, { status: "approved", send: { session: "core; rm -rf" } }))).status).toBe(422);
    expect((await PATCH(call("PATCH", t, { status: "checked", send: { session: ROOM } }))).status).toBe(422);
    expect((await PATCH(call("PATCH", t, { status: "approved", caption: "y", send: { session: ROOM } }))).status).toBe(422);
    expect(queued()).toEqual([]);
    expect(await statusOf(v)).toBe("checked");
    expect(await statusOf(t)).toBe("checked");
    expect((await (await GET(call("GET", ""))).json()).assign).toBeNull();
  });

  it("a failed delivery leaves the item as it was", async () => {
    configure(makeDb("send-fail.db", ALL));
    const q = await readyToApprove({ format: "infographic", caption: "Cap" });
    // The inbox folder cannot be made: a file sits where it goes.
    fs.mkdirSync(path.dirname(inboxDir()), { recursive: true });
    fs.writeFileSync(inboxDir(), "");
    const res = await send(q);
    expect(res.status).toBe(502);
    fs.rmSync(inboxDir(), { force: true });
    expect(await statusOf(q)).toBe("checked");
    const listed = await (await GET(call("GET", ""))).json();
    expect(listed.items[0].assignee_session).toBeNull();
    expect(listed.assign).toBeNull();
  });

  it("the default session is kept server-side across reads, replaced and forgotten", async () => {
    configure(makeDb("prefs.db", ALL));
    const put = (assign: unknown) => PUT_PREFS(req("/api/content/prefs", { method: "PUT", token, origin: ORIGIN, body: { assign } }));
    expect((await put({ session: ROOM, base: " mkt · 8sync-startup " })).status).toBe(200);
    expect((await (await GET(call("GET", ""))).json()).assign).toEqual({ session: ROOM, base: "mkt · 8sync-startup" });
    expect((await (await GET(call("GET", ""))).json()).assign).toEqual({ session: ROOM, base: "mkt · 8sync-startup" });
    expect((await put({ session: "../../etc", base: "x" })).status).toBe(422);
    expect((await (await GET(call("GET", ""))).json()).assign?.session).toBe(ROOM);
    expect((await put(null)).status).toBe(200);
    expect((await (await GET(call("GET", ""))).json()).assign).toBeNull();
  });
});

describe("calendar overflow", () => {
  it("a day shows up to the cap, one more as a chip, and puts the rest behind +N", () => {
    const five = [1, 2, 3, 4, 5];
    expect(capDay(five, 3)).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(capDay([1, 2, 3, 4], 3)).toEqual({ shown: [1, 2, 3, 4], more: 0 });
    expect(capDay(five, 6)).toEqual({ shown: five, more: 0 });
    expect(capDay([], 3)).toEqual({ shown: [], more: 0 });
  });
});
