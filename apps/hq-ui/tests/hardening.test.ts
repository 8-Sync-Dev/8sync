import { beforeAll, describe, expect, it, vi } from "vitest";

const sendKeys = vi.hoisted(() => vi.fn(async () => ({ ok: true, stderr: "" })));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  sendKeys,
  capturePlain: async () => "> ",
  sendKeysRaw: async () => ({ ok: true, stdout: "", stderr: "" }),
}));

import * as inbox from "@/app/api/channel/inbox/route";
import * as reply from "@/app/api/channel/reply/route";
import * as heartbeat from "@/app/api/channel/heartbeat/route";
import * as messages from "@/app/api/messages/route";
import * as projects from "@/app/api/projects/route";
import * as sessions from "@/app/api/sessions/route";
import * as keys from "@/app/api/sessions/[name]/keys/route";
import * as screen from "@/app/api/sessions/[name]/screen/route";
import * as stop from "@/app/api/sessions/[name]/stop/route";
import * as stream from "@/app/api/stream/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { sendKeysPlan } from "@/lib/server/proc";
import { clampText } from "@/lib/server/validate";
import nextConfig from "../next.config";
import { ORIGIN, req, tempHome } from "./helpers";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

type H = (r: Request, ctx?: never) => Promise<Response>;
const ctx = { params: Promise.resolve({ name: "hq-x" }) } as never;
const ROUTES: { path: string; mod: Record<string, unknown> }[] = [
  { path: "/api/channel/inbox?session=hq-x", mod: inbox },
  { path: "/api/channel/reply", mod: reply },
  { path: "/api/channel/heartbeat", mod: heartbeat },
  { path: "/api/messages", mod: messages },
  { path: "/api/projects", mod: projects },
  { path: "/api/sessions", mod: sessions },
  { path: "/api/sessions/hq-x/keys", mod: keys },
  { path: "/api/sessions/hq-x/screen", mod: screen },
  { path: "/api/sessions/hq-x/stop", mod: stop },
  { path: "/api/stream", mod: stream },
];
const METHODS = ["GET", "POST", "DELETE", "PUT", "PATCH"];
const cases = ROUTES.flatMap((r) =>
  METHODS.filter((m) => typeof r.mod[m] === "function").map((m) => ({ ...r, method: m, fn: r.mod[m] as H })),
);

describe("every API route is gated", () => {
  it("covers every route file", () => {
    expect(cases.length).toBeGreaterThanOrEqual(13);
  });
  it.each(cases.map((c) => [`${c.method} ${c.path}`, c] as const))("%s", async (_n, c) => {
    const ok = { method: c.method, token, origin: ORIGIN, body: c.method === "GET" ? undefined : {} };
    const mutating = c.method !== "GET";
    expect((await c.fn(req(c.path, { ...ok, token: null }), ctx)).status).toBe(401);
    expect((await c.fn(req(c.path, { ...ok, token: "x".repeat(64) }), ctx)).status).toBe(401);
    expect((await c.fn(req(c.path, { ...ok, host: "evil.test" }), ctx)).status).toBe(403);
    if (mutating) {
      expect((await c.fn(req(c.path, { ...ok, origin: "http://evil.test" }), ctx)).status).toBe(403);
      // The channel endpoints accept a missing Origin; every other mutating route does not.
      if (!c.path.startsWith("/api/channel/")) {
        expect((await c.fn(req(c.path, { ...ok, origin: null }), ctx)).status).toBe(403);
      }
    }
  });
});

describe("control characters are refused with 422", () => {
  const bodies = ["a\x1bb", "a\x03b", "a\x7fb", "a\u0085b", "a\u009bb", "x\x1b[201~rm -rf", "a\rb", "a\x00b"];
  it.each(bodies.map((b) => [JSON.stringify(b), b] as const))("POST /api/messages %s", async (_n, text) => {
    const res = await messages.POST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body: { session: "hq-c", text } }));
    expect(res.status).toBe(422);
    expect(sendKeys).not.toHaveBeenCalled();
    expect(getDb().prepare("SELECT count(*) c FROM messages WHERE session = 'hq-c'").get()).toEqual({ c: 0 });
  });
  it("tab and newline stay allowed", async () => {
    expect(clampText("a\tb\nc").ok).toBe(true);
    const res = await messages.POST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body: { session: "hq-c", text: "a\tb\nc" } }));
    expect(res.status).toBe(201);
  });
  it("sendKeysPlan refuses them too", () => {
    expect(() => sendKeysPlan("hq-c", "a\x1b[201~b")).toThrow();
    expect(() => sendKeysPlan("hq-c", "ok\nmulti\tline")).not.toThrow();
  });
});

describe("GET /api/messages limit", () => {
  const get = (q: string) => messages.GET(req(`/api/messages${q}`, { token }));
  it("400 on non-integers, clamps 1..500", async () => {
    for (const bad of ["abc", "1.5", "-3", "1e3", "5;DROP", ""]) {
      expect((await get(`?limit=${encodeURIComponent(bad)}`)).status, bad).toBe(400);
    }
    expect((await get("?limit=0")).status).toBe(200);
    expect((await get("?limit=99999")).status).toBe(200);
    expect((await get("")).status).toBe(200);
  });
  it("returns at most 500 rows and at least 1", async () => {
    const db = getDb();
    const ins = db.prepare("INSERT INTO messages(ts, session, kind, text) VALUES (1, 'hq-l', 'session_reply', 't')");
    for (let i = 0; i < 520; i++) ins.run();
    expect((await (await get("?limit=99999&session=hq-l")).json()).messages).toHaveLength(500);
    expect((await (await get("?limit=0&session=hq-l")).json()).messages).toHaveLength(1);
    expect((await (await get("?limit=3&session=hq-l")).json()).messages).toHaveLength(3);
  });
});

describe("security headers", () => {
  it("frame-ancestors none, DENY, no-referrer on every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules[0].source).toBe("/:path*");
    const h = Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
  });
});

import { clampText as clampText2 } from "../lib/server/validate";
import { test as test2, expect as expect2 } from "vitest";
test2("CRLF from a textarea is accepted as a newline, lone CR still refused", () => {
  const ok = clampText2("line one\r\nline two");
  expect2(ok.ok && ok.value).toBe("line one\nline two");
  expect2(clampText2("a\rb").ok).toBe(false);
});
