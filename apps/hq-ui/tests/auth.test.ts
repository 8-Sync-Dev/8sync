import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { checkAuth, getToken, isLocalHost } from "@/lib/server/auth";
import { tokenPath } from "@/lib/server/paths";
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
