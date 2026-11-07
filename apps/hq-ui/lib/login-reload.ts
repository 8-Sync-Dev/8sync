// The login screen's one-time reload (components/hq/login-probe.tsx). Tested in tests/login-reload.test.ts.
//
// `hq_pub` is SameSite=Strict, so a top-level visit from another site (a link in Zalo, Messenger,
// Telegram) arrives without it and the page shows the login screen although the owner is signed in.
// The screen's own same-origin `GET /api/version` does carry the cookie; lib/server/auth.ts checkAuth
// then answers 401 "missing or invalid x-hq-token" for a valid cookie (only the page's token is
// missing) and 403 "forbidden host" for a missing or expired one. 401 = a reload will get in.

export const LOGIN_RELOAD_KEY = "hq.login.reloaded";

/** A reload this recent (ms) means the probe already tried: stay, never loop. */
export const LOGIN_RELOAD_WINDOW_MS = 30_000;

/** Reload once when the probe says the cookie is valid (401) and no reload was tried in the window. */
export function shouldReloadLogin(status: number, reloadedAt: number | null, now: number): boolean {
  if (status !== 401) return false;
  return reloadedAt == null || !(now - reloadedAt >= 0 && now - reloadedAt < LOGIN_RELOAD_WINDOW_MS);
}
