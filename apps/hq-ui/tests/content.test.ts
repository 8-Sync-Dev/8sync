import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/content/route";
import { GET as MEDIA } from "@/app/api/content/media/route";
import { addDays, aiReason, byDay, contentTaskText, contentWarning, dayKey, fromLocalInput, monthGrid, nextStatuses, NO_SCHEDULE, stepCursor, stepHint, toLocalInput, weekStart } from "@/lib/content";
import { getToken } from "@/lib/server/auth";
import { contentConfigPath, NO_REGISTRY } from "@/lib/server/content";
import { aiMark } from "@/lib/server/content-media";
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
  it("approving an AI-made item needs the reviewer's no-AI confirmation; the DB gate still runs after it", async () => {
    configure(makeDb("ai.db", MIGRATION_0062 + MIGRATION_0063));
    const q = await readyToApprove({ format: "ai_video" });
    let res = await PATCH(call("PATCH", q, { status: "approved" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/^Mục có rủi ro nhãn AI \(.+\): tick xác nhận/);
    res = await PATCH(call("PATCH", q, { status: "approved", no_ai_confirmed: true }));
    expect(res.status).toBe(200);

    // The confirmation is no way around the trigger: an unchecked item stays refused by the DB.
    const { item } = await (await POST(call("POST", "", { format: "ai_video", title: "B" }))).json();
    res = await PATCH(call("PATCH", `?id=${item.id}`, { status: "approved", no_ai_confirmed: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("content_items: source must be approved before approved/published");
  });
  it("an approved item edited into AI content without the tick drops back to checked; asking for approved again is refused", async () => {
    configure(makeDb("ai-swap.db", MIGRATION_0062 + MIGRATION_0063));
    const q = await readyToApprove({ format: "text" });
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(200);
    let res = await PATCH(call("PATCH", q, { format: "ai_video" }));
    expect(res.status).toBe(200);
    expect((await res.json()).item).toMatchObject({ format: "ai_video", status: "checked" });
    // Re-approving the AI version needs the tick.
    expect((await PATCH(call("PATCH", q, { status: "approved" }))).status).toBe(409);
    expect((await PATCH(call("PATCH", q, { status: "approved", no_ai_confirmed: true }))).status).toBe(200);

    // Same for new media, and sending status "approved" with the change is a 409, not a silent demote.
    const r = await readyToApprove({ format: "text" });
    expect((await PATCH(call("PATCH", r, { status: "approved" }))).status).toBe(200);
    const dir = path.join(home, "swap-media");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "r.mp4"), Buffer.alloc(64));
    expect((await PATCH(call("PATCH", r, { status: "approved", media_path: dir }))).status).toBe(409);
    res = await PATCH(call("PATCH", r, { media_path: dir }));
    expect((await res.json()).item.status).toBe("checked");
    // With the tick the item stays approved; edits that do not touch the AI rule stay free.
    expect((await PATCH(call("PATCH", r, { status: "approved", no_ai_confirmed: true }))).status).toBe(200);
    expect((await (await PATCH(call("PATCH", r, { caption: "mới" }))).json()).item.status).toBe("approved");
  });
  it("publishing an AI item needs the tick unless it comes from approved; a published post refuses the swap", async () => {
    configure(makeDb("ai-pub.db", MIGRATION_0062 + MIGRATION_0063));
    const links = { news_url: "https://n", fb_post_url: "https://f" };
    // The trigger checks fields, not the previous status: checked → published must not skip the tick.
    const q = await readyToApprove({ format: "ai_video", ...links });
    let res = await PATCH(call("PATCH", q, { status: "published" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/^Mục có rủi ro nhãn AI/);
    expect((await POST(call("POST", "", { format: "ai_video", title: "C", status: "published" }))).status).toBe(409);

    // approved (ticked) → published goes without a second tick.
    const r = await readyToApprove({ format: "course_video", ...links });
    expect((await PATCH(call("PATCH", r, { status: "approved", no_ai_confirmed: true }))).status).toBe(200);
    expect((await PATCH(call("PATCH", r, { status: "published" }))).status).toBe(200);

    const t = await readyToApprove({ format: "text", ...links });
    expect((await PATCH(call("PATCH", t, { status: "approved" }))).status).toBe(200);
    expect((await PATCH(call("PATCH", t, { status: "published" }))).status).toBe(200);
    res = await PATCH(call("PATCH", t, { format: "ai_video" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/^Bài đã đăng không đổi sang nội dung rủi ro nhãn AI/);
  });
  it("a 1-tap step the trigger would refuse says why", () => {
    const base = { source_approved_at: 1, news_url: "https://n", fb_post_url: "https://f" };
    expect(stepHint({ ...base, source_approved_at: null }, "approved")).toBe("Duyệt nguồn trước");
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
    fs.writeFileSync(path.join(dir, "c.mp4"), Buffer.alloc(2048, 7));
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
