"use client";

// The sidebar's session tree as React state: every omp session (GET /api/omp/sessions?all=1, 5 s while
// visible) merged with the office's live rooms, plus the owner's local choices kept in this browser:
// group & sort, folded groups/sessions, the archive, and the "xong, chưa xem" dots.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { DEFAULT_PREFS, NO_ORDER, finishedSince, mergeSessions, readArchive, readOrder, readPrefs, toggle, type GroupBy, type OmpTreeRow, type SortBy, type TreeOrder, type TreePrefs, type TreeSession, type TreeState } from "@/lib/session-tree";
import type { Hq } from "./use-hq";
import type { OfficeState } from "./use-office";
import { usePoll } from "./use-poll";

const OMP_POLL_MS = 5000;
const PREFS_KEY = "hq.tree.prefs";
const ARCHIVE_KEY = "hq.tree.archive";
const UNREAD_KEY = "hq.tree.unread";
const ORDER_KEY = "hq.tree.order";

/** One localStorage value as an external store, so every view showing it agrees (sidebar, pages, other tabs). */
export function localValue<T>(key: string, parse: (raw: string | null) => T, fallback: T) {
  let cur: T | null = null;
  let raw: string | null = null;
  const subs = new Set<() => void>();
  const get = () => {
    const now = localStorage.getItem(key);
    if (cur === null || now !== raw) {
      raw = now;
      cur = parse(now);
    }
    return cur;
  };
  const subscribe = (cb: () => void) => {
    subs.add(cb);
    const onStorage = (e: StorageEvent) => e.key === key && cb();
    window.addEventListener("storage", onStorage);
    return () => {
      subs.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  };
  const server = () => fallback;
  return {
    useValue: () => useSyncExternalStore(subscribe, get, server),
    set: (v: T) => {
      localStorage.setItem(key, JSON.stringify(v));
      for (const f of subs) f();
    },
    get,
  };
}

const NO_KEYS: string[] = [];
const prefsStore = localValue<TreePrefs>(PREFS_KEY, readPrefs, DEFAULT_PREFS);
const archiveStore = localValue<string[]>(ARCHIVE_KEY, readArchive, NO_KEYS);
const unreadStore = localValue<string[]>(UNREAD_KEY, readArchive, NO_KEYS);
const orderStore = localValue<TreeOrder>(ORDER_KEY, readOrder, NO_ORDER);

// `v: 2` marks a sort the owner picked (readPrefs).
const setPrefs = (p: TreePrefs) => prefsStore.set({ ...p, v: 2 } as TreePrefs);

/** The drag-and-drop order. A drop also switches the list to "Tự sắp" so the move sticks. */
export function useTreeOrder() {
  const order = orderStore.useValue();
  const set = useCallback((next: TreeOrder) => {
    orderStore.set(next);
    const p = prefsStore.get();
    if (p.sort !== "manual") setPrefs({ ...p, sort: "manual" });
  }, []);
  return { order, set };
}

export function useTreePrefs() {
  const prefs = prefsStore.useValue();
  return {
    prefs,
    setGroup: (group: GroupBy) => setPrefs({ ...prefsStore.get(), group }),
    setSort: (sort: SortBy) => setPrefs({ ...prefsStore.get(), sort }),
    /** Folds or unfolds a group / a session's sub-sessions (keys are prefixed by the caller). */
    toggleCollapsed: (key: string) => {
      const p = prefsStore.get();
      setPrefs({ ...p, collapsed: toggle(p.collapsed, key) });
    },
  };
}

export function useArchive() {
  const keys = archiveStore.useValue();
  return { keys, toggle: (key: string) => archiveStore.set(toggle(archiveStore.get(), key)) };
}

/** The blue dots: keys of sessions that finished unseen. `seen(key)` clears one. */
export function useUnread() {
  const keys = unreadStore.useValue();
  const seen = useCallback((key: string) => {
    const cur = unreadStore.get();
    if (cur.includes(key)) unreadStore.set(cur.filter((k) => k !== key));
  }, []);
  return { keys, seen };
}

/** `at`: when the session list last answered (ms, 0 before the first answer). */
export type SessionTree = { sessions: TreeSession[]; at: number; loading: boolean; error: string | null; reload: () => void };

/**
 * Every session HQ can show: live rooms and all omp sessions, with sub-sessions. `active`: the session
 * on screen now (its key, or the key of its room when its Chat phòng is open); it never collects a blue dot.
 */
export function useSessionTree(hq: Hq, office: OfficeState, active: string | null): SessionTree {
  const omp = usePoll<{ sessions: OmpTreeRow[] }>(hq.api, "/api/omp/sessions?all=1", OMP_POLL_MS, true);
  const rooms = office.office?.rooms;
  const sessions = useMemo(() => mergeSessions(rooms ?? [], omp.data?.sessions ?? []), [rooms, omp.data]);

  // Working → done/idle while not on screen: a blue dot until opened.
  const prev = useRef<Record<string, TreeState> | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = Object.fromEntries(sessions.map((s) => [s.key, s.state]));
    if (!was) return;
    const onScreen = new Set(sessions.filter((s) => s.key === active || (active != null && s.room === active)).map((s) => s.key));
    const done = finishedSince(was, sessions).filter((k) => !onScreen.has(k));
    if (done.length) unreadStore.set([...new Set([...unreadStore.get(), ...done])].slice(-500));
  }, [sessions, active]);

  return {
    sessions,
    loading: !omp.data && !office.office && !omp.error && !office.error,
    error: !omp.data && !office.office ? (omp.error ?? office.error ?? null) : null,
    at: omp.at,
    reload: omp.reload,
  };
}

