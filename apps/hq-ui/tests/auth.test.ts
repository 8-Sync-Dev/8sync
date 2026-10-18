import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as login } from "@/app/api/login/route";
import { isLocalHost } from "@/lib/hosts";
import { checkAuth, getToken, readPublic } from "@/lib/server/auth";
import { open } from "@/lib/server/http";
import { publicPath, tokenPath } from "@/lib/server/paths";
import { tempHome } from "./helpers";

const T = "a".repeat(64);
const base = { host: "127.0.0.1:8740", origin: null, token: T };

describe("auth", () => {
  beforeAll(() => tempHome());

  it("creates a 0600 token on first run and reuses it", () => {
    const t = getToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(tokenPath()).mode & 0o777).toBe(0o600);
    expect(getToken()).toBe(t);
  });

  it("requires the token on every call", () => {
    expect(checkAuth({ ...base, method: "GET", token: null }, T)?.status).toBe(401);
    expect(checkAuth({ ...base, method: "GET", token: "b".repeat(64) }, T)?.status).toBe(401);
    expect(checkAuth({ ...base, method: "GET", token: "short" }, T)?.status).toBe(401);
    expect(checkAuth({ ...base, method: "GET" }, T)).toBeNull();
  });

  it("checks Origin on mutating calls", () => {
    expect(checkAuth({ ...base, method: "POST" }, T)?.error).toBe("missing Origin");
    expect(checkAuth({ ...base, method: "POST", origin: "http://evil.test" }, T)?.error).toBe("bad Origin");
    expect(checkAuth({ ...base, method: "POST", origin: "http://127.0.0.1:9999" }, T)?.error).toBe("bad Origin");
    expect(checkAuth({ ...base, method: "POST", origin: "http://127.0.0.1:8740" }, T)).toBeNull();
    // Channel endpoints: a local node process sends no Origin, but a wrong one is still refused.
    expect(checkAuth({ ...base, method: "POST" }, T, { allowMissingOrigin: true })).toBeNull();
    expect(checkAuth({ ...base, method: "POST", origin: "http://evil.test" }, T, { allowMissingOrigin: true })?.status).toBe(403);
  });

  it("refuses non-loopback Host (DNS rebinding)", () => {
    expect(isLocalHost("localhost:8740")).toBe(true);
    expect(isLocalHost("[::1]:8740")).toBe(true);
    expect(isLocalHost("evil.test:8740")).toBe(false);
    expect(isLocalHost("127.0.0.1.evil.test")).toBe(false);
    expect(isLocalHost(null)).toBe(false);
    expect(checkAuth({ ...base, method: "GET", host: "evil.test" }, T)?.status).toBe(403);
  });
});

// The remote link (contract C6), end to end through `open()` and the login route.
describe("remote link", () => {
  const HOST = "calm-river-42.trycloudflare.com";
  const KEY = "c".repeat(64);
  let token = "";
  const writePub = (v: unknown) => {
    fs.mkdirSync(path.dirname(publicPath()), { recursive: true });
    fs.writeFileSync(publicPath(), JSON.stringify(v));
  };
  const call = (h: { host: string; cookie?: string; token?: string | null; origin?: string; method?: string; tunnel?: boolean }) => {
    const headers = new Headers({ host: h.host });
    if (h.token !== null) headers.set("x-hq-token", h.token ?? token);
    if (h.cookie) headers.set("cookie", h.cookie);
    if (h.origin) headers.set("origin", h.origin);
    if (h.tunnel) headers.set("cf-ray", "8f00-SIN");
    const r = open(new Request(`http://${h.host}/api/x`, { method: h.method ?? "GET", headers }));
    return "res" in r ? r.res.status : 200;
  };

  beforeAll(() => {
    tempHome();
    token = getToken();
  });
  beforeEach(() => writePub({ v: 1, host: HOST, key: KEY, since: Date.now() }));

  it("loopback still works", () => {
    expect(call({ host: "127.0.0.1:8740" })).toBe(200);
    expect(call({ host: "127.0.0.1:8740", method: "POST", origin: "http://127.0.0.1:8740" })).toBe(200);
  });

  it("public host needs the right cookie and the token", () => {
    expect(call({ host: HOST })).toBe(403);
    expect(call({ host: HOST, cookie: `hq_pub=${"d".repeat(64)}` })).toBe(403);
    expect(call({ host: HOST, cookie: "hq_pub=short" })).toBe(403);
    expect(call({ host: HOST, cookie: `hq_pub=${KEY}`, token: null })).toBe(401);
    expect(call({ host: HOST, cookie: `other=1; hq_pub=${KEY}`, tunnel: true })).toBe(200);
  });

  it("mutations on the public host need its https Origin", () => {
    const ok = { host: HOST, cookie: `hq_pub=${KEY}`, method: "POST" };
    expect(call({ ...ok, origin: `https://${HOST}` })).toBe(200);
    expect(call({ ...ok, origin: `http://${HOST}` })).toBe(403);
    expect(call({ ...ok, origin: "https://evil.test" })).toBe(403);
    expect(call(ok)).toBe(403); // no Origin
  });

  it("lookalike hosts and tunnelled loopback are refused", () => {
    const cookie = `hq_pub=${KEY}`;
    expect(call({ host: `${HOST}.evil.test`, cookie })).toBe(403);
    expect(call({ host: `x${HOST}`, cookie })).toBe(403);
    expect(call({ host: "trycloudflare.com", cookie })).toBe(403);
    expect(call({ host: "127.0.0.1:8740", tunnel: true })).toBe(403);
  });

  it("no or malformed public.json: every non-loopback host is 403", () => {
    fs.rmSync(publicPath());
    expect(readPublic()).toBeNull();
    expect(call({ host: HOST, cookie: `hq_pub=${KEY}` })).toBe(403);
    writePub({ v: 1, host: "127.0.0.1", key: KEY });
    expect(readPublic()).toBeNull();
    writePub({ v: 1, host: HOST, key: "not-hex" });
    expect(readPublic()).toBeNull();
  });

  describe("GET /api/login", () => {
    const get = (host: string, k: string) => login(new Request(`http://${host}/api/login?k=${k}`, { headers: { host } }));

    it("right host + key: HttpOnly cookie and 303 to /", async () => {
      const res = await get(HOST, KEY);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
      expect(res.headers.get("set-cookie")).toBe(`hq_pub=${KEY}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);
    });

    it("anything else: 401 without detail or cookie", async () => {
      for (const res of [await get(HOST, "d".repeat(64)), await get(HOST, ""), await get("127.0.0.1:8740", KEY), await get(`${HOST}.evil.test`, KEY)]) {
        expect(res.status).toBe(401);
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(await res.text()).toBe("");
      }
      fs.rmSync(publicPath());
      expect((await get(HOST, KEY)).status).toBe(401);
    });
  });
});
