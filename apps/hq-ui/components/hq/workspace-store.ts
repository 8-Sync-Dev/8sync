"use client";

// Không gian's state, shared by the sidebar (a session row opens a pane; "+" picks the folder) and
// the workspace view (panes, the start composer): open panes, the composer's folder and the recent
// folders, kept in localStorage. One module-level store read with useSyncExternalStore.
import { useSyncExternalStore } from "react";
import { EMPTY_WORKSPACE, closePane, openPane, pushRecent, readWorkspace, replacePane, type Pane, type WorkspaceState } from "@/lib/omp-workspace";

const PANES_KEY = "hq.workspace.panes";
const RECENT_KEY = "hq.workspace.recent";
const FOLDER_KEY = "hq.workspace.folder";
/** The start composer's text box (Ctrl+N focuses it). */
export const COMPOSER_ID = "ws-composer";

export type WorkspaceSnap = {
  ws: WorkspaceState;
  folder: string | null;
  recent: string[];
  /** Panes open: the start composer shows over them (never resizing a terminal) while this is set. */
  composer: boolean;
};

const SERVER: WorkspaceSnap = { ws: EMPTY_WORKSPACE, folder: null, recent: [], composer: false };
let snap: WorkspaceSnap = SERVER;
let loaded = false;
const subs = new Set<() => void>();

function readList(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  snap = { ws: readWorkspace(localStorage.getItem(PANES_KEY)), folder: localStorage.getItem(FOLDER_KEY), recent: readList(localStorage.getItem(RECENT_KEY)), composer: false };
}

function set(next: Partial<WorkspaceSnap>) {
  load();
  snap = { ...snap, ...next };
  if (next.ws) localStorage.setItem(PANES_KEY, JSON.stringify(snap.ws));
  if (next.recent) localStorage.setItem(RECENT_KEY, JSON.stringify(snap.recent));
  if (next.folder) localStorage.setItem(FOLDER_KEY, next.folder);
  for (const f of subs) f();
}

function subscribe(cb: () => void) {
  const first = !loaded;
  load();
  subs.add(cb);
  if (first) cb();
  return () => {
    subs.delete(cb);
  };
}

export function useWorkspace(): WorkspaceSnap {
  return useSyncExternalStore(
    subscribe,
    () => snap,
    () => SERVER,
  );
}

/** Frees the terminal bridge of a pane that left the screen; the omp session keeps running. */
function release(token: string, id: string) {
  void fetch(`/api/sessions/${encodeURIComponent(id)}/term`, { method: "DELETE", headers: { "x-hq-token": token } }).catch(() => {});
}

export const workspace = {
  /** `split`: beside the others (Alt+click, "Mở cạnh nhau"); else in the active pane's place. */
  open(token: string, p: Pane, split = false) {
    load();
    const before = snap.ws.panes;
    const ws = split ? openPane(snap.ws, p) : replacePane(snap.ws, p);
    for (const x of before) if (!ws.panes.some((y) => y.id === x.id)) release(token, x.id);
    set({ ws, composer: false });
  },
  close(token: string, id: string) {
    load();
    set({ ws: closePane(snap.ws, id) });
    release(token, id);
  },
  focus(id: string) {
    load();
    if (snap.ws.active !== id) set({ ws: { ...snap.ws, active: id } });
  },
  max(id: string) {
    load();
    set({ ws: { ...snap.ws, active: id, max: snap.ws.max === id ? null : id } });
  },
  folder(p: string) {
    load();
    set({ folder: p, recent: pushRecent(snap.recent, p) });
  },
  composer(on: boolean) {
    set({ composer: on });
  },
};
