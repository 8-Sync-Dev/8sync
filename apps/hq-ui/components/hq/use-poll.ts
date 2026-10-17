"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Hq } from "./use-hq";

/**
 * GET `url` every `ms` while `on` and the page is visible (Principle 4: nothing polls harder than
 * needed). Keeps the last good data across errors so a blip never blanks the view.
 */
export function usePoll<T>(api: Hq["api"], url: string, ms: number, on: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (!on) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const r = await api<T>(url, { signal: ac.signal });
          setData(r);
          setAt(Date.now());
          setError(null);
        } catch (e) {
          if (!ac.signal.aborted) setError((e as Error).message);
        }
      }
      if (!ac.signal.aborted) timer = setTimeout(poll, ms);
    };
    const onShow = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onShow);
    void poll();
    return () => {
      ac.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [api, url, ms, on, nonce]);

  return { data, error, at, loading: data === null && error === null, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

/**
 * An image the API serves behind `x-hq-token` (an <img src> cannot send the header), as an object
 * URL. Fetched only once `visible` turns true, revoked when the id changes or the view unmounts.
 */
export function useAuthedImage(token: string, id: string | null, visible: boolean) {
  // Keyed by id, so a new id shows its own loading state without a reset in the effect.
  const [st, setSt] = useState<{ id: string; src: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!id || !visible) return;
    const ac = new AbortController();
    let url: string | null = null;
    fetch(`/api/preview/file?id=${encodeURIComponent(id)}`, { headers: { "x-hq-token": token }, signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        url = URL.createObjectURL(await r.blob());
        setSt({ id, src: url, failed: false });
      })
      .catch(() => {
        if (!ac.signal.aborted) setSt({ id, src: null, failed: true });
      });
    return () => {
      ac.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, id, visible]);
  return st && st.id === id ? st : { src: null, failed: false };
}

/** True once the element has scrolled near the viewport (then stays true). */
export function useNearView<T extends Element>(margin = "200px") {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  // No IntersectionObserver (old engine): load right away.
  return [ref, seen || typeof IntersectionObserver === "undefined"] as const;
}
