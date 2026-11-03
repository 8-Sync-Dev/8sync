import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/content/route";
import { contentTaskText, contentWarning, nextStatuses } from "@/lib/content";
import { getToken } from "@/lib/server/auth";
import { contentConfigPath, NO_REGISTRY } from "@/lib/server/content";
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
  it("the task names the item", () => {
    expect(contentTaskText({ id: 12, title: "Bài A", fb_page: "zus" }, " sửa caption ")).toBe("[Nội dung #12 · zus] Bài A\nsửa caption");
  });
});
