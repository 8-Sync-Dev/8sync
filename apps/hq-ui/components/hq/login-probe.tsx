"use client";

import { useEffect } from "react";
import { LOGIN_RELOAD_KEY, shouldReloadLogin } from "@/lib/login-reload";

function readFlag(): number | null {
  try {
    const v = Number(sessionStorage.getItem(LOGIN_RELOAD_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return Date.now(); // no sessionStorage: cannot guard a reload, so never reload
  }
}

/**
 * On the login screen: if HQ opened from another site dropped the SameSite=Strict `hq_pub` cookie
 * on this first load, a same-origin probe still carries it; a 401 (valid cookie, no token) means one
 * reload gets the owner in (lib/login-reload.ts). Renders nothing.
 */
export function LoginProbe() {
  useEffect(() => {
    let stop = false;
    void fetch("/api/version", { cache: "no-store" })
      .then((r) => {
        const now = Date.now();
        if (stop || !shouldReloadLogin(r.status, readFlag(), now)) return;
        sessionStorage.setItem(LOGIN_RELOAD_KEY, String(now));
        // A navigation this page starts is same-site, so the Strict cookie goes along (a bare reload()
        // may keep the cross-site initiator). No hash: a hash-only change would not load the page.
        window.location.replace(window.location.pathname + window.location.search);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);
  return null;
}
