"use client";

import { useCallback, useEffect, useState } from "react";
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
