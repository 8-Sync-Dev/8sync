"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shouldAutoStart, type AutoState } from "@/lib/auto";
import type { AutoAction } from "@/lib/server/auto";
import type { Office } from "@/lib/server/office";

export type { Office, Room } from "@/lib/server/office";

const POLL_MS = 4000;

/** GET /api/office every few seconds while the tab is visible. */
export function useOffice(token: string) {
  const [data, setData] = useState<Office | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    const load = async () => {
      if (document.hidden) return schedule();
      try {
        const r = await fetch("/api/office", { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData((await r.json()) as Office);
        setError(null);
      } catch (e) {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "failed");
      }
      schedule();
    };
    const onShow = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", onShow);
    void load();
    return () => {
      ac.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [token, tick]);

  return { office: data, error, retry: useCallback(() => setTick((t) => t + 1), []) };
}

export type OfficeState = ReturnType<typeof useOffice>;

const AUTO_POLL_MS = 60_000;

/**
 * `8sync ccc auto` status every 60 s while the tab is visible. Default behaviour: running. When
 * 8sync answers off and the owner never paused, POST `on` once per fetch, so it turns on by
 * itself once per page load (never after the owner paused, never over hand-set idle/delegate);
 * an expired lease is shown, not re-armed (the 4 h subscription cap stays). `setAuto` is the Pause / Run button.
 */
export function useAuto(token: string) {
  const [status, setStatus] = useState<AutoState | null>(null);
  const [busy, setBusy] = useState(false);
  /** One automatic `on` per page load (see shouldAutoStart). */
  const started = useRef(false);

  const call = useCallback(
    async (method: "GET" | "POST", action?: AutoAction, signal?: AbortSignal): Promise<AutoState> => {
      try {
        const r = await fetch("/api/auto", {
          method,
          headers: { "x-hq-token": token, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
          body: method === "POST" ? JSON.stringify({ action }) : undefined,
          signal,
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as AutoState;
      } catch (e) {
        return { on: false, paused: false, error: e instanceof Error ? e.message : "failed" };
      }
    },
    [token],
  );

  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!document.hidden) {
        let st = await call("GET", undefined, ac.signal);
        if (ac.signal.aborted) return;
        if (shouldAutoStart(st, started.current)) {
          started.current = true;
          st = await call("POST", "on", ac.signal);
        }
        if (ac.signal.aborted) return;
        setStatus(st);
      }
      timer = setTimeout(load, AUTO_POLL_MS);
    };
    const onShow = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", onShow);
    void load();
    return () => {
      ac.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [call]);

  const setAuto = useCallback(
    async (action: AutoAction) => {
      setBusy(true);
      const next = await call("POST", action);
      // POST answers the auto status only: keep the version / remote-link facts from the last GET.
      setStatus((prev) => ({ ...next, versions: next.versions ?? prev?.versions, remote: next.remote ?? prev?.remote }));
      setBusy(false);
    },
    [call],
  );

  return { status, busy, setAuto };
}
