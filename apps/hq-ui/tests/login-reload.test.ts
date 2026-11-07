// Opened from another site, the SameSite=Strict `hq_pub` cookie misses the first load: the login
// screen's same-origin probe reloads once on 401 (valid cookie, no token), never on 403, never twice.
// The server side of the signal (valid cookie + no token = 401, no/bad cookie = 403) is pinned in
// tests/auth.test.ts "public host needs the right cookie and the token".
import { describe, expect, it } from "vitest";
import { LOGIN_RELOAD_WINDOW_MS, shouldReloadLogin } from "@/lib/login-reload";

const NOW = 1_800_000_000_000;

describe("login screen reload decision", () => {
  it("401 (cookie valid, token missing) → reload once", () => {
    expect(shouldReloadLogin(401, null, NOW)).toBe(true);
  });
  it("403 (no or expired cookie) or anything else → stay on the login screen", () => {
    expect(shouldReloadLogin(403, null, NOW)).toBe(false);
    expect(shouldReloadLogin(200, null, NOW)).toBe(false);
    expect(shouldReloadLogin(500, null, NOW)).toBe(false);
  });
  it("flag set by a recent reload → stay (no loop)", () => {
    expect(shouldReloadLogin(401, NOW - 1_000, NOW)).toBe(false);
    expect(shouldReloadLogin(401, NOW, NOW)).toBe(false);
  });
  it("a stale or future-dated flag allows one new try (it is rewritten, so the next load stays)", () => {
    expect(shouldReloadLogin(401, NOW - LOGIN_RELOAD_WINDOW_MS - 1, NOW)).toBe(true);
    expect(shouldReloadLogin(401, NOW + 60_000, NOW)).toBe(true);
  });
});
