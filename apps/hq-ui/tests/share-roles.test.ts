import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as CONTENT, PATCH } from "@/app/api/content/route";
import { GET as MEDIA } from "@/app/api/content/media/route";
import { GET as UPLOAD_FILE } from "@/app/api/uploads/[id]/file/route";
import { DELETE as INVITES_DELETE, GET as INVITES_GET, POST as INVITES_POST } from "@/app/api/invites/route";
import { GET as LOGIN } from "@/app/api/login/route";
import { GET as GH_POLL, POST as GH_START } from "@/app/api/login/github/route";
import { atLeast, deniedText, GUEST_ROLES, GUEST_ROUTES, GUEST_STATUS_DENIED, type GuestRole } from "@/lib/access";
import { GUEST_CHANNEL_ERROR } from "@/lib/content";
import { checkAuth, getToken, isDenied, sessionSecret, type Access, type Denied } from "@/lib/server/auth";
import { contentConfigPath } from "@/lib/server/content";
import { contentPrefsPath, saveAssignPref } from "@/lib/server/content-prefs";
import { inboxDir } from "@/lib/server/inbox";
import { __resetFlows, githubConfigPath } from "@/lib/server/github-login";
import { cookieAccess } from "@/lib/server/http";
import { createInvite, GUEST_COOKIE, GUEST_GH_MS, GUEST_MAX_MS, guestAccess, guestCookie, readInvites, revokeInvite } from "@/lib/server/invites";
import { saveUpload, uploadLink } from "@/lib/server/uploads";
import { invitesPath } from "@/lib/server/paths";
import { ORIGIN, req, tempHome } from "./helpers";

const HOST = "127.0.0.1:8740";
const API = path.join(import.meta.dirname, "..", "app", "api");
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const SELF_AUTH: Record<string, true> = { "/api/login": true, "/api/login/github": true, "/api/play/[key]/[[...path]]": true, "/api/omp/v1/[...path]": true };

let token = "";
/** A browser request carrying only the `hq_guest` cookie (a guest has no token). */
function guestReq(url: string, cookie: string, init: { method?: string; body?: unknown; origin?: string | null; host?: string } = {}) {
  const method = init.method ?? "GET";
  const headers = new Headers({ host: init.host ?? HOST, cookie: `${GUEST_COOKIE}=${cookie}` });
  const origin = init.origin === undefined ? (["GET", "HEAD", "OPTIONS"].includes(method) ? null : ORIGIN) : init.origin;
  if (origin) headers.set("origin", origin);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://${init.host ?? HOST}${url}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const invite = (role: GuestRole, days = 7, extra: Record<string, unknown> = {}, now = Date.now()) => createInvite({ label: `khách ${role}`, role, days, ...extra }, now);
const cookieFor = (id: string, role: GuestRole, issued = Date.now(), gh?: string) => guestCookie({ id, role, issued, ...(gh ? { gh } : {}) }, sessionSecret());
const authAs = (cookie: string, now = Date.now(), method = "GET", p = "/api/content") =>
  checkAuth({ method, host: HOST, origin: method === "GET" ? null : ORIGIN, token: null, guest: cookie, path: p }, token, {}, null, now);
const status = (r: Access | Denied) => (isDenied(r) ? r.status : 200);

/** Every `app/api/**\/route.ts` as its URL pattern (`/api/rooms/[key]`): a new route joins the matrix by existing. */
function routeFiles(): { url: string; file: string }[] {
  return (fs.readdirSync(API, { recursive: true }) as string[])
    .filter((rel) => path.basename(rel) === "route.ts")
    .map((rel) => ({ url: `/api/${path.dirname(rel).split(path.sep).join("/")}`, file: path.join(API, rel) }))
    .sort((a, b) => a.url.localeCompare(b.url));
}
/** A concrete URL and Next's `params` for a pattern: every dynamic segment gets "x". */
function concrete(url: string) {
  const params: Record<string, string | string[]> = {};
  const real = url.replace(/\[\[?(\.\.\.)?([^\]]+)\]\]?/g, (_, rest: string | undefined, name: string) => {
    params[name] = rest ? ["x"] : "x";
    return "x";
  });
  return { real, ctx: { params: Promise.resolve(params) } };
}

beforeAll(() => {
  tempHome();
  token = getToken();
});
beforeEach(() => fs.rmSync(invitesPath(), { force: true }));

describe("role matrix over every API route (deny by default)", () => {
  const routes = routeFiles();

  it("finds the routes, and every route outside the own-auth list goes through open()", () => {
    expect(routes.length).toBeGreaterThan(40);
    for (const r of routes) {
      if (SELF_AUTH[r.url]) continue;
      expect(fs.readFileSync(r.file, "utf8"), r.url).toMatch(/\bopen\(req\b/);
    }
    // The guest table only names routes that exist.
    for (const url of Object.keys(GUEST_ROUTES)) expect(routes.map((r) => r.url)).toContain(url);
  });

  for (const role of GUEST_ROLES) {
    it(`${role}: 403 everywhere except the routes opened to it`, async () => {
      const { invite: inv } = invite(role);
      const cookie = cookieFor(inv.id, role);
      for (const r of routes) {
        // Runtime-selected: the file list is the point (a route added tomorrow is checked without editing this test).
        const mod = (await import(/* @vite-ignore */ r.file)) as Record<string, unknown>;
        const { real, ctx } = concrete(r.url);
        for (const m of METHODS) {
          const handler = mod[m];
          if (typeof handler !== "function") continue;
          const res: Response = await handler(guestReq(real, cookie, { method: m, body: ["GET", "HEAD", "OPTIONS"].includes(m) ? undefined : {} }), ctx);
          const where = `${role} ${m} ${r.url}`;
          if (SELF_AUTH[r.url]) {
            expect(res.status, where).toBeGreaterThanOrEqual(400);
            continue;
          }
          const need = GUEST_ROUTES[r.url]?.[m];
          if (need && atLeast(role, need)) {
            expect([401, 403], where).not.toContain(res.status);
          } else {
            expect(res.status, where).toBe(403);
            expect(((await res.json()) as { error: string }).error, where).toBe(deniedText(role));
          }
        }
      }
    }, 60_000);
  }
});

describe("guest cookie", () => {
  it("revoke answers 401 at the next request", () => {
    const { invite: inv } = invite("viewer");
    const cookie = cookieFor(inv.id, "viewer");
    expect(authAs(cookie)).toMatchObject({ role: "viewer", guest: { id: inv.id, label: "khách viewer" } });
    expect(revokeInvite(inv.id)).toBe(true);
    expect(status(authAs(cookie))).toBe(401);
    expect(cookieAccess(new Headers({ host: HOST, cookie: `${GUEST_COOKIE}=${cookie}` }))).toEqual({ error: expect.stringMatching(/thu hồi hoặc hết hạn/) });
    expect(revokeInvite("nope")).toBe(false);
  });

  it("expires with the invite, and after 7 days whatever the invite says", () => {
    const now = Date.now();
    const day = invite("viewer", 1, {}, now).invite;
    const c1 = cookieFor(day.id, "viewer", now);
    expect(status(authAs(c1, now + 86_400_000 - 1))).toBe(200);
    expect(status(authAs(c1, now + 86_400_000))).toBe(401);
    const month = invite("editor", 30, {}, now).invite;
    const c30 = cookieFor(month.id, "editor", now);
    expect(status(authAs(c30, now + GUEST_MAX_MS - 1))).toBe(200);
    expect(status(authAs(c30, now + GUEST_MAX_MS))).toBe(401);
    // A fresh visit of the same link starts a new week, still inside the invite.
    expect(status(authAs(cookieFor(month.id, "editor", now + GUEST_MAX_MS), now + GUEST_MAX_MS))).toBe(200);
  });

  it("refuses forged and tampered cookies", () => {
    const { invite: inv } = invite("viewer");
    const good = cookieFor(inv.id, "viewer");
    const [payload, mac] = good.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const raised = Buffer.from(JSON.stringify({ ...claims, role: "editor" })).toString("base64url");
    expect(status(authAs(`${raised}.${mac}`))).toBe(401); // role raised, old signature
    expect(status(authAs(guestCookie({ ...claims, role: "editor" }, sessionSecret())))).toBe(401); // signed, but not the invite's role
    expect(status(authAs(guestCookie(claims, "f".repeat(64))))).toBe(401); // wrong key
    expect(status(authAs(guestCookie({ ...claims, issued: Date.now() + 60_000 }, sessionSecret())))).toBe(401); // issued in the future
    expect(status(authAs(guestCookie({ ...claims, id: "0".repeat(16) }, sessionSecret())))).toBe(401); // unknown invite
    expect(status(authAs(`${payload}.${"0".repeat(64)}`))).toBe(401);
    expect(status(authAs("garbage"))).toBe(401);
    // A guest cookie never reads as the owner, and a guest browser must send Origin on writes.
    expect(status(authAs(good, Date.now(), "PATCH"))).toBe(403);
    const editor = invite("editor").invite;
    const ec = cookieFor(editor.id, "editor");
    expect(status(checkAuth({ method: "PATCH", host: HOST, origin: null, token: null, guest: ec, path: "/api/content" }, token, { allowMissingOrigin: true }))).toBe(403);
    expect(status(authAs(ec, Date.now(), "PATCH"))).toBe(200);
  });

  it("an invite bound to a GitHub login opens only after that login signs in", () => {
    const { invite: inv } = invite("editor", 7, { github: "@Quin19FD" });
    expect(inv.github).toBe("Quin19FD");
    const pending = cookieFor(inv.id, "editor");
    expect(authAs(pending)).toEqual({ status: 401, error: "Link chia sẻ này cần đăng nhập GitHub trước." });
    expect(cookieAccess(new Headers({ host: HOST, cookie: `${GUEST_COOKIE}=${pending}` }))).toEqual({ github: "Quin19FD" });
    expect("github" in guestAccess(cookieFor(inv.id, "editor", Date.now(), "someone"), sessionSecret())).toBe(true);
    expect(authAs(cookieFor(inv.id, "editor", Date.now(), "quin19fd"))).toMatchObject({ role: "editor", guest: { github: "quin19fd" } });
    expect(() => invite("viewer", 7, { github: "bad login!" })).toThrow(/github/);
  });
});

describe("invites API (owner only) and the invite link", () => {
  const owner = (method: string, q = "", body?: unknown) => req(`/api/invites${q}`, { method, token, origin: method === "GET" ? null : ORIGIN, body });

  it("creates, lists without the hash, revokes; the file holds hashes only, mode 0600", async () => {
    const res = await INVITES_POST(owner("POST", "", { label: "an@example.com", role: "viewer", days: 30 }));
    expect(res.status).toBe(201);
    const { invite: inv, link } = (await res.json()) as { invite: { id: string; state: string }; link: string };
    expect(inv.state).toBe("active");
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:8740\/api\/login\?invite=[0-9a-f]{64}$/);
    const tokenInLink = link.split("=")[1];
    const file = fs.readFileSync(invitesPath(), "utf8");
    expect(file).not.toContain(tokenInLink);
    if (process.platform !== "win32") expect(fs.statSync(invitesPath()).mode & 0o777).toBe(0o600);
    const list = (await (await INVITES_GET(owner("GET"))).json()) as { invites: Record<string, unknown>[]; public: boolean };
    expect(list.public).toBe(false);
    expect(list.invites).toHaveLength(1);
    expect(list.invites[0]).not.toHaveProperty("hash");
    expect((await INVITES_POST(owner("POST", "", { label: "x", role: "owner", days: 7 }))).status).toBe(422);
    expect((await INVITES_POST(owner("POST", "", { label: "x", role: "viewer", days: 3 }))).status).toBe(422);
    expect((await INVITES_POST(owner("POST", "", { label: "", role: "viewer", days: 7 }))).status).toBe(422);

    // The link: a signed guest cookie (never the token), no Secure on loopback, at most 7 days.
    const login = await LOGIN(new Request(link, { headers: { host: HOST } }));
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/");
    const set = login.headers.get("set-cookie") ?? "";
    expect(set).toMatch(new RegExp(`^${GUEST_COOKIE}=[A-Za-z0-9_-]+\\.[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${GUEST_MAX_MS / 1000}$`));
    expect(set).not.toContain(tokenInLink);
    const cookie = /=([^;]+)/.exec(set)![1];
    expect((await CONTENT(guestReq("/api/content", cookie))).status).toBe(200);
    expect((await INVITES_GET(guestReq("/api/invites", cookie))).status).toBe(403);

    expect((await INVITES_DELETE(owner("DELETE", `?id=${inv.id}`))).status).toBe(200);
    expect((await CONTENT(guestReq("/api/content", cookie))).status).toBe(401);
    expect((await LOGIN(new Request(link, { headers: { host: HOST } }))).status).toBe(401); // a revoked link no longer logs in
    expect((await INVITES_DELETE(owner("DELETE", "?id=nope"))).status).toBe(404);
    expect(readInvites()[0].revoked).not.toBeNull();
  });

  it("the link is refused through the tunnel on loopback, and with a wrong token; ?out=1 clears the cookie", async () => {
    const { token: t } = invite("viewer");
    expect((await LOGIN(new Request(`http://${HOST}/api/login?invite=${t}`, { headers: { host: HOST, "cf-ray": "1" } }))).status).toBe(401);
    const wrong = await LOGIN(new Request(`http://${HOST}/api/login?invite=${"0".repeat(64)}`, { headers: { host: HOST } }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect((await LOGIN(new Request(`http://evil.test/api/login?invite=${t}`, { headers: { host: "evil.test" } }))).status).toBe(401);
    const out = await LOGIN(new Request(`http://${HOST}/api/login?out=1`, { headers: { host: HOST } }));
    expect(out.status).toBe(303);
    expect(out.headers.get("set-cookie")).toBe(`${GUEST_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  });
});

describe("content as a guest", () => {
  const SCHEMA = `CREATE TABLE content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, format TEXT NOT NULL, title TEXT NOT NULL, brief TEXT, caption TEXT, media_path TEXT,
    fb_page TEXT NOT NULL DEFAULT '8syncdev', source_url TEXT, source_approved_by TEXT, source_approved_at INTEGER,
    check_note TEXT, checked_at INTEGER, news_url TEXT, fb_post_url TEXT, published_at INTEGER,
    status TEXT NOT NULL DEFAULT 'ordered', created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    scheduled_at INTEGER, assignee_session TEXT, assignee_base TEXT, assigned_at INTEGER);`;
  let dir = "";
  let id = 0;
  let file = "";

  beforeAll(() => {
    const home = process.env.USERPROFILE!;
    dir = path.join(home, "share-media");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "clip.mp4"), Buffer.alloc(512, 7));
    file = path.join(home, "share-content.db");
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    id = Number(db.prepare("INSERT INTO content_items (format, title, caption, media_path) VALUES ('clip', 'Bài chia sẻ', 'cap', ?)").run(dir).lastInsertRowid);
    db.close();
    fs.mkdirSync(path.dirname(contentConfigPath()), { recursive: true });
    fs.writeFileSync(contentConfigPath(), JSON.stringify({ db: file }));
  });

  it("viewer reads (no disk path) and downloads; cannot write; a revoked viewer loses the signed media", async () => {
    const { invite: inv } = invite("viewer");
    const cookie = cookieFor(inv.id, "viewer");
    const { items } = (await (await CONTENT(guestReq("/api/content", cookie))).json()) as { items: { id: number; media_path: string; media: { url: string }[] }[] };
    const row = items.find((i) => i.id === id)!;
    expect(row.media_path).toBe("share-media");
    const url = `${row.media[0].url}&dl=1`;
    const dl = await MEDIA(guestReq(url, cookie));
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toMatch(/attachment/);
    expect((await PATCH(guestReq(`/api/content?id=${id}`, cookie, { method: "PATCH", body: { caption: "x" } }))).status).toBe(403);
    // A signed URL alone, on the tunnel host with no login, is not enough.
    expect((await MEDIA(new Request(`http://${HOST}${url}`, { headers: { host: HOST, "cf-ray": "1" } }))).status).toBe(401);
    revokeInvite(inv.id);
    expect((await MEDIA(guestReq(url, cookie))).status).toBe(401);
  });

  it("a signed chat-upload link is owner-only: a guest cookie is 403, no login on the tunnel is 401", async () => {
    const up = saveUpload("clip.mp4", Buffer.alloc(64, 1));
    const url = uploadLink(up.id);
    const ctx = { params: Promise.resolve({ id: up.id }) } as unknown as Parameters<typeof UPLOAD_FILE>[1];
    const { invite: inv } = invite("editor");
    expect((await UPLOAD_FILE(guestReq(url, cookieFor(inv.id, "editor")), ctx)).status).toBe(403);
    expect((await UPLOAD_FILE(new Request(`http://${HOST}${url}`, { headers: { host: HOST, "cf-ray": "1" } }), ctx)).status).toBe(401);
    expect((await UPLOAD_FILE(new Request(`http://${HOST}${url}`, { headers: { host: HOST } }), ctx)).status).toBe(200);
  });

  it("editor edits caption and status, not the media path or assignees; the change is signed with the invite label", async () => {
    const { invite: inv } = invite("editor");
    const cookie = cookieFor(inv.id, "editor");
    const patchAs = (body: Record<string, unknown>) => PATCH(guestReq(`/api/content?id=${id}`, cookie, { method: "PATCH", body }));
    const res = await patchAs({ caption: "caption mới", status: "drafted" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { item: { caption: string; status: string; media_path: string } }).item).toMatchObject({ caption: "caption mới", status: "drafted", media_path: "share-media" });
    expect((await patchAs({ source_url: "https://s" })).status).toBe(200);
    const approved = await patchAs({ approve_source: "https://s" });
    expect(((await approved.json()) as { item: { source_approved_by: string } }).item.source_approved_by).toBe("chia sẻ: khách editor");
    for (const field of ["media_path", "assignee_session", "assignee_base", "retry_channel"]) {
      const r = await PATCH(guestReq(`/api/content?id=${id}`, cookie, { method: "PATCH", body: { [field]: "C:/x" } }));
      expect(r.status, field).toBe(403);
    }
    expect((await PATCH(guestReq(`/api/content?id=${id}`, cookie, { method: "PATCH", body: { caption: "y" }, origin: "http://evil.test" }))).status).toBe(403);
  });

  it("a guest cannot send the posting task to an agent session, nor read the owner's default session", async () => {
    saveAssignPref({ session: "omp-2364d8b9ca3a61ed", base: "mkt · 8sync-startup" });
    try {
      for (const role of GUEST_ROLES) {
        const { invite: inv } = invite(role);
        const cookie = cookieFor(inv.id, role);
        const r = await PATCH(guestReq(`/api/content?id=${id}`, cookie, { method: "PATCH", body: { status: "approved", send: { session: "omp-2364d8b9ca3a61ed", base: "x" } } }));
        expect(r.status, role).toBe(403);
        const list = (await (await CONTENT(guestReq("/api/content", cookie))).json()) as { assign: unknown };
        expect(list.assign, role).toBeNull();
      }
    } finally {
      fs.rmSync(contentPrefsPath(), { force: true });
    }
  });

  it("a guest editor's change to what an approved item posts sends it back to checked; the owner's edit keeps it approved", async () => {
    const setApproved = () => {
      const db = new DatabaseSync(file);
      db.prepare("UPDATE content_items SET status = 'approved', checked_at = 1 WHERE id = ?").run(id);
      db.close();
    };
    const statusIn = async (r: Response) => {
      expect(r.status).toBe(200);
      const body: { item: { status: string } } = await r.json();
      return body.item.status;
    };
    const { invite: inv } = invite("editor");
    const cookie = cookieFor(inv.id, "editor");
    const patchAs = (body: Record<string, unknown>) => PATCH(guestReq(`/api/content?id=${id}`, cookie, { method: "PATCH", body })).then(statusIn);
    for (const body of [{ caption: "caption khách sửa" }, { title: "Tiêu đề khách sửa" }, { fb_page: "trang-khac" }, { format: "text" }]) {
      setApproved();
      expect(await patchAs(body), JSON.stringify(body)).toBe("checked");
    }
    // The item waits for the owner: a guest cannot approve it again, nor mark it published, alone or
    // riding along an edit; the refused write changes nothing.
    for (const body of [{ status: "approved" }, { status: "published" }, { caption: "lén duyệt", status: "approved" }]) {
      const r = await PATCH(guestReq(`/api/content?id=${id}`, cookie, { method: "PATCH", body }));
      expect(r.status, JSON.stringify(body)).toBe(403);
      const err: { error: string } = await r.json();
      expect(err.error).toBe(GUEST_STATUS_DENIED);
    }
    const db = new DatabaseSync(file);
    expect(db.prepare("SELECT status, caption FROM content_items WHERE id = ?").get(id)).toMatchObject({ status: "checked", caption: "caption khách sửa" });
    db.close();
    // The earlier steps stay the guest's.
    expect(await patchAs({ status: "drafted" })).toBe("drafted");
    expect(await patchAs({ status: "checked" })).toBe("checked");
    // The same value again, or a field that is not what gets posted: still approved.
    setApproved();
    expect(await patchAs({ caption: "caption khách sửa" })).toBe("approved");
    expect(await patchAs({ check_note: "ok" })).toBe("approved");
    // Nothing went to any agent session.
    expect(fs.existsSync(inboxDir()) ? fs.readdirSync(inboxDir()) : []).toEqual([]);
    // The owner's edit keeps main's behaviour (0.122.15: no drop-back), and the owner approves.
    expect(await statusIn(await PATCH(req(`/api/content?id=${id}`, { method: "PATCH", token, origin: ORIGIN, body: { caption: "chủ sửa" } })))).toBe("approved");
    expect(await statusIn(await PATCH(req(`/api/content?id=${id}`, { method: "PATCH", token, origin: ORIGIN, body: { status: "published" } })))).toBe("published");
  });

  // Last in this block: it adds migration 0064 to the shared DB.
  it("a guest reads a channel's failure as a generic line, never the worker's text; the owner reads it whole", async () => {
    const db = new DatabaseSync(file);
    db.exec(`ALTER TABLE content_items ADD COLUMN channels TEXT NOT NULL DEFAULT '["facebook"]';
      ALTER TABLE content_items ADD COLUMN captions_json TEXT;
      ALTER TABLE content_items ADD COLUMN ai_label INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE content_channel_posts (item_id INTEGER NOT NULL, channel TEXT NOT NULL, state TEXT NOT NULL, scheduled_for INTEGER, permalink TEXT,
        published_at INTEGER, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (item_id, channel));`);
    const secret = "ego profile C:\\Users\\owner\\AppData\\ego\\8sync FB: login checkpoint";
    db.prepare("INSERT INTO content_channel_posts (item_id, channel, state, error) VALUES (?, 'facebook', 'failed', ?)").run(id, secret);
    db.close();
    type Listed = { items: { id: number; channel_posts: { state: string; error: string | null }[] }[] };
    for (const role of GUEST_ROLES) {
      const { invite: inv } = invite(role);
      const res = await CONTENT(guestReq("/api/content", cookieFor(inv.id, role)));
      const text = await res.text();
      expect(text, role).not.toContain("AppData");
      const row = (JSON.parse(text) as Listed).items.find((i) => i.id === id)!;
      expect(row.channel_posts, role).toEqual([expect.objectContaining({ state: "failed", error: GUEST_CHANNEL_ERROR })]);
    }
    const owner = (await (await CONTENT(req("/api/content", { token, origin: null }))).json()) as Listed;
    expect(owner.items.find((i) => i.id === id)!.channel_posts[0].error).toBe(secret);
    // With channels: a guest's change of channels or a channel caption on an approved item drops it back too.
    const { invite: ed } = invite("editor");
    for (const body of [{ channels: ["facebook", "threads"] }, { captions_json: { threads: "khách viết" } }]) {
      const db = new DatabaseSync(file);
      db.prepare("UPDATE content_items SET status = 'approved' WHERE id = ?").run(id);
      db.close();
      const r = await PATCH(guestReq(`/api/content?id=${id}`, cookieFor(ed.id, "editor"), { method: "PATCH", body }));
      const got: { item: { status: string } } = await r.json();
      expect(got.item.status, JSON.stringify(body)).toBe("checked");
    }
  });
});

describe("GitHub sign-in for a bound invite (device flow, loopback)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __resetFlows();
    fs.rmSync(githubConfigPath(), { force: true });
  });

  async function signIn(cookie: string, login: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.now();
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/login/device/code")) return Response.json({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 });
      if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: "gho_x" });
      if (url.endsWith("/user")) return Response.json({ login });
      return new Response(null, { status: 404 });
    });
    const start = await GH_START(guestReq("/api/login/github", cookie, { method: "POST" }));
    expect(start.status).toBe(200);
    const { id } = (await start.json()) as { id: string };
    vi.setSystemTime(t0 + 6000);
    return GH_POLL(guestReq(`/api/login/github?f=${id}`, cookie));
  }

  it("the bound login gets the invite's cookie; another login is refused; an allow guest role gets its own 12 h cookie", async () => {
    fs.mkdirSync(path.dirname(githubConfigPath()), { recursive: true });
    fs.writeFileSync(githubConfigPath(), JSON.stringify({ client_id: "Iv1.abcdef123456", allow: [{ login: "helper", role: "viewer" }] }));
    const { invite: inv } = invite("viewer", 7, { github: "Quin19FD" });
    const pending = cookieFor(inv.id, "viewer");

    const wrong = await signIn(pending, "someone");
    expect(wrong.status).toBe(403);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    vi.useRealTimers();
    __resetFlows();

    const ok = await signIn(pending, "quin19fd");
    expect(ok.status).toBe(200);
    const set = ok.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+$/);
    expect(set).not.toContain("Secure");
    vi.useRealTimers();
    const signed = /=([^;]+)/.exec(set)![1];
    expect(authAs(signed, Date.now() + 60_000)).toMatchObject({ role: "viewer", guest: { id: inv.id, github: "quin19fd" } });
    __resetFlows();

    // `allow` {login, role: "viewer"}: the same flow from a browser holding a bound link (loopback needs one) also
    // lets that account in as itself, on its own 12 h cookie.
    const helper = await signIn(pending, "helper");
    expect(helper.status).toBe(200);
    const hset = helper.headers.get("set-cookie") ?? "";
    expect(hset).toContain(`Max-Age=${GUEST_GH_MS / 1000}`);
    vi.useRealTimers();
    expect(authAs(/=([^;]+)/.exec(hset)![1], Date.now() + 60_000)).toMatchObject({ role: "viewer", guest: { id: "gh:helper", label: "helper" } });
  });

  it("is off on loopback without a pending bound invite", async () => {
    fs.mkdirSync(path.dirname(githubConfigPath()), { recursive: true });
    fs.writeFileSync(githubConfigPath(), JSON.stringify({ client_id: "Iv1.abcdef123456", allow: ["8syncdev"] }));
    const plain = invite("viewer").invite;
    expect((await GH_START(guestReq("/api/login/github", cookieFor(plain.id, "viewer"), { method: "POST" }))).status).toBe(404);
  });
});
