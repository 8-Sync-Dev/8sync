"use client";

import { useEffect } from "react";

const CHECK_MS = 60_000;
/** sessionStorage: the UI version a ChunkLoadError already reloaded for (one reload, never a loop). */
const RELOADED = "hq.reloaded-for";

/** A missing build chunk: the server now runs another UI build than the one this page came from. */
export function isChunkError(reason: unknown): boolean {
  const text = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason);
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/.test(text);
}

/**
 * Reload the page when HQ restarted on another version (`8sync hq ui` follows `8sync up`): the open tab
 * still runs the old build, whose chunks the new server no longer has. Checks `/api/version` every
 * minute and when the tab comes back; a chunk that fails to load reloads once.
 */
export function useReloadOnNewUi(token: string, rendered: string | null) {
  useEffect(() => {
    if (!rendered) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      clearTimeout(timer);
      try {
        const res = await fetch("/api/version", { headers: { "x-hq-token": token }, cache: "no-store", signal: ac.signal });
        const body: unknown = res.ok ? await res.json() : null;
        if (body && typeof body === "object" && "ui" in body && typeof body.ui === "string" && body.ui !== rendered) {
          window.location.reload();
          return;
        }
      } catch {
        /* HQ restarting: next round */
      }
      if (!ac.signal.aborted) timer = setTimeout(check, CHECK_MS);
    };
    timer = setTimeout(check, CHECK_MS);
    const onShow = () => {
      if (!document.hidden) void check();
    };
    const onChunk = (reason: unknown) => {
      if (!isChunkError(reason) || sessionStorage.getItem(RELOADED) === rendered) return;
      sessionStorage.setItem(RELOADED, rendered);
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => onChunk(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => onChunk(e.reason);
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      ac.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [token, rendered]);
}
