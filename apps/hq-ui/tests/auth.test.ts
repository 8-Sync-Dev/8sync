import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as login } from "@/app/api/login/route";
import { isLocalHost } from "@/lib/hosts";
import { __setNonceForTest, checkAuth, getToken, LINK_MS, readPublic, SESSION_MS, sessionCookie, sessionValid } from "@/lib/server/auth";
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
    // Windows has no POSIX mode bits (stat reports 0o666 whatever chmod set); the profile ACL guards it there.
    if (process.platform !== "win32") expect(fs.statSync(tokenPath()).mode & 0o777).toBe(0o600);
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
  const NONCE = "e".repeat(64);
  let token = "";
  let SESSION = "";
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
  beforeEach(() => {
    __setNonceForTest(NONCE);
    writePub({ v: 1, host: HOST, key: KEY, since: Date.now(), nonce: NONCE });
    SESSION = sessionCookie(KEY, Date.now());
  });
  afterAll(() => {
    __setNonceForTest("");
  });

  it("loopback still works", () => {
    expect(call({ host: "127.0.0.1:8740" })).toBe(200);
    expect(call({ host: "127.0.0.1:8740", method: "POST", origin: "http://127.0.0.1:8740" })).toBe(200);
  });

  it("public host needs the right cookie and the token", () => {
    expect(call({ host: HOST })).toBe(403);
    expect(call({ host: HOST, cookie: `hq_pub=${"d".repeat(64)}` })).toBe(403);
    expect(call({ host: HOST, cookie: "hq_pub=short" })).toBe(403);
    expect(call({ host: HOST, cookie: `hq_pub=${KEY}` })).toBe(403); // the raw key is no longer a session
    expect(call({ host: HOST, cookie: `hq_pub=${SESSION}`, token: null })).toBe(401);
    expect(call({ host: HOST, cookie: `other=1; hq_pub=${SESSION}`, tunnel: true })).toBe(200);
  });

  it("session cookie: HMAC-signed, expires server side after 12 h (security M1)", () => {
    const now = Date.now();
    expect(sessionValid(sessionCookie(KEY, now - SESSION_MS + 1000), KEY, now)).toBe(true);
    expect(sessionValid(sessionCookie(KEY, now - SESSION_MS - 1), KEY, now)).toBe(false);
    expect(sessionValid(sessionCookie(KEY, now + 60_000), KEY, now)).toBe(false);
    expect(sessionValid(sessionCookie("d".repeat(64), now), KEY, now)).toBe(false);
    const [issued, mac] = sessionCookie(KEY, now).split(".");
    expect(sessionValid(`${Number(issued) + 1}.${mac}`, KEY, now)).toBe(false); // forged issue time
    expect(sessionValid(KEY, KEY, now)).toBe(false);
    expect(call({ host: HOST, cookie: `hq_pub=${sessionCookie(KEY, now - SESSION_MS - 1)}` })).toBe(403);
  });

  it("public.json counts only with the nonce of this HQ process (contract C-C)", () => {
    expect(readPublic()?.host).toBe(HOST);
    __setNonceForTest("");
    expect(readPublic()).toBeNull();
    expect(call({ host: HOST, cookie: `hq_pub=${SESSION}` })).toBe(403);
    __setNonceForTest("f".repeat(64));
    expect(readPublic()).toBeNull();
    __setNonceForTest(NONCE);
    writePub({ v: 1, host: HOST, key: KEY, since: Date.now() }); // no nonce in the file
    expect(readPublic()).toBeNull();
  });

  it("the nonce is taken once at load and kept out of process.env (security M-A)", () => {
    expect(process.env.HQ_PUBLIC_NONCE).toBeUndefined();
    __setNonceForTest("");
    process.env.HQ_PUBLIC_NONCE = NONCE; // set after load: ignored
    try {
      expect(readPublic()).toBeNull();
    } finally {
      delete process.env.HQ_PUBLIC_NONCE;
    }
  });

  it("mutations on the public host need its https Origin", () => {
    const ok = { host: HOST, cookie: `hq_pub=${SESSION}`, method: "POST" };
    expect(call({ ...ok, origin: `https://${HOST}` })).toBe(200);
    expect(call({ ...ok, origin: `http://${HOST}` })).toBe(403);
    expect(call({ ...ok, origin: "https://evil.test" })).toBe(403);
    expect(call(ok)).toBe(403); // no Origin
  });

  it("lookalike hosts and tunnelled loopback are refused", () => {
    const cookie = `hq_pub=${SESSION}`;
    expect(call({ host: `${HOST}.evil.test`, cookie })).toBe(403);
    expect(call({ host: `x${HOST}`, cookie })).toBe(403);
    expect(call({ host: "trycloudflare.com", cookie })).toBe(403);
    expect(call({ host: "127.0.0.1:8740", tunnel: true })).toBe(403);
  });

  it("no or malformed public.json: every non-loopback host is 403", () => {
    fs.rmSync(publicPath());
    expect(readPublic()).toBeNull();
    expect(call({ host: HOST, cookie: `hq_pub=${SESSION}` })).toBe(403);
    writePub({ v: 1, host: "127.0.0.1", key: KEY, since: Date.now(), nonce: NONCE });
    expect(readPublic()).toBeNull();
    writePub({ v: 1, host: HOST, key: "not-hex", since: Date.now(), nonce: NONCE });
    expect(readPublic()).toBeNull();
  });

  describe("GET /api/login", () => {
    const get = (host: string, k: string) => login(new Request(`http://${host}/api/login?k=${k}`, { headers: { host } }));

    it("right host + key: signed HttpOnly cookie (not the key) and 303 to /", async () => {
      const before = Date.now();
      const res = await get(HOST, KEY);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
      const m = /^hq_pub=(\d+\.[0-9a-f]{64}); HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200$/.exec(res.headers.get("set-cookie") ?? "");
      expect(m).not.toBeNull();
      expect(m![1]).not.toContain(KEY);
      expect(Number(m![1].split(".")[0])).toBeGreaterThanOrEqual(before);
      expect(sessionValid(m![1], KEY)).toBe(true);
      expect(call({ host: HOST, cookie: `hq_pub=${m![1]}` })).toBe(200);
    });

    it("the link expires 10 minutes after `since`", async () => {
      writePub({ v: 1, host: HOST, key: KEY, since: Date.now() - LINK_MS + 30_000, nonce: NONCE });
      expect((await get(HOST, KEY)).status).toBe(303);
      writePub({ v: 1, host: HOST, key: KEY, since: Date.now() - LINK_MS - 1000, nonce: NONCE });
      const res = await get(HOST, KEY);
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await res.text()).toBe("");
    });

    it("anything else: 401 without detail or cookie", async () => {
      for (const res of [await get(HOST, "d".repeat(64)), await get(HOST, ""), await get("127.0.0.1:8740", KEY), await get(`${HOST}.evil.test`, KEY)]) {
        expect(res.status).toBe(401);
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(await res.text()).toBe("");
      }
      __setNonceForTest("");
      expect((await get(HOST, KEY)).status).toBe(401);
      __setNonceForTest(NONCE);
      fs.rmSync(publicPath());
      expect((await get(HOST, KEY)).status).toBe(401);
    });
  });
});
