"use client";

import { ArrowRightLeftIcon, LayoutGridIcon, Maximize2Icon, Minimize2Icon, PlusIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ResizablePanelGroup, ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import { browseStart, folderName, mergeProjects, paneGrid, pathKey, type Pane, type WorkspaceState, type WsProject } from "@/lib/omp-workspace";
import { TREE_WORD, type TreeSession } from "@/lib/session-tree";
import { cn } from "@/lib/utils";
import { StatusDot } from "./bits";
import type { SessionStatus } from "./types";
import { WorkspaceComposer } from "./workspace-composer";
import { type Listing } from "./workspace-launcher";
import { useWorkspace, workspace } from "./workspace-store";

// xterm touches `window`: the terminal loads in the page only.
const LiveTerminal = dynamic(() => import("./live-terminal").then((m) => m.LiveTerminal), { ssr: false });

/** Below Tailwind `md` the panes become tabs: one thing at a time. */
const SMALL_QUERY = "(max-width: 767px)";
const subscribeSmall = (cb: () => void) => {
  const m = window.matchMedia(SMALL_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const isSmall = () => window.matchMedia(SMALL_QUERY).matches;

async function errorOf(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
}

const STATUS_OF: Record<TreeSession["state"], SessionStatus> = { working: "running", needs: "needs_input", done: "idle", error: "idle", idle: "idle" };

/**
 * Không gian (owner 2026-11-02, "học theo Claude Code Desktop"): the sessions open as windows (a
 * sidebar click puts one in the active window, Alt+click or "Mở cạnh nhau" beside it, up to four),
 * or the start composer (Phiên mới) when none is open; with windows open, the composer is drawn over
 * them so no terminal is resized. A window is the session's own terminal (`8sync ccc term omp-<id>`);
 * "Chuyển sang HQ" (takeover) only on the owner's click. State: workspace-store.ts.
 */
export function WorkspaceView({ token, projects, sessions }: { token: string; projects: WsProject[]; sessions: TreeSession[] }) {
  const small = useSyncExternalStore(subscribeSmall, isSmall, () => false);
  const { ws, folder, recent, composer } = useWorkspace();
  const [home, setHome] = useState<string | null>(null);

  const api = useCallback(
    async <T,>(url: string, init?: { method?: string; body?: unknown }): Promise<T> => {
      const res = await fetch(url, {
        method: init?.method ?? "GET",
        headers: { "x-hq-token": token, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await errorOf(res));
      return (await res.json()) as T;
    },
    [token],
  );

  // The home folder: `~\…` paths in the picker, and where browsing falls back to.
  useEffect(() => {
    api<Listing>("/api/tree?path=")
      .then((l) => setHome(l.home || null))
      .catch(() => {});
  }, [api]);

  const list = useMemo(() => mergeProjects(recent, projects), [recent, projects]);
  const browseFrom = useMemo(() => browseStart(list.map((p) => p.path), home), [list, home]);
  const byId = useMemo(() => new Map(sessions.flatMap((s) => (s.ompId ? [[s.ompId, s] as const] : []))), [sessions]);
  // Names in use in the folder (and its worktrees): a new session never takes one (that reopens it).
  const taken = useMemo(() => (folder ? sessions.filter((s) => s.kind === "omp" && s.root != null && (pathKey(s.root) === pathKey(folder) || (s.cwd != null && pathKey(s.cwd) === pathKey(folder)))).map((s) => s.name) : []), [sessions, folder]);

  const hasPanes = ws.panes.length > 0;
  const showComposer = !hasPanes || composer;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasPanes && (
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5 md:px-3" role="tablist" aria-label="Không gian">
          <Button size="sm" variant={composer ? "ghost" : "secondary"} className="max-md:h-11 max-md:flex-1" role="tab" aria-selected={!composer} onClick={() => workspace.composer(false)}>
            <LayoutGridIcon aria-hidden /> Cửa sổ <span className="text-xs text-muted-foreground tabular">{ws.panes.length}</span>
          </Button>
          <Button size="sm" variant={composer ? "secondary" : "ghost"} className="max-md:h-11 max-md:flex-1" role="tab" aria-selected={composer} onClick={() => workspace.composer(true)}>
            <PlusIcon aria-hidden /> Phiên mới
          </Button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {hasPanes && (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col p-2 md:p-3" aria-label="Cửa sổ phiên" inert={composer}>
            <Panes ws={ws} small={small} token={token} byId={byId} onFocus={workspace.focus} onClose={(id) => workspace.close(token, id)} onMax={workspace.max} />
          </section>
        )}
        {/* Kept mounted while hidden: the typed task survives a look at the windows. */}
        <div
          className={cn("flex min-h-0 min-w-0 flex-1 flex-col", hasPanes && "absolute inset-0 z-10", !showComposer && "hidden")}
          onKeyDown={(e) => {
            if (e.key === "Escape" && hasPanes) workspace.composer(false);
          }}
        >
          <WorkspaceComposer api={api} folder={folder} list={list} home={home} browseFrom={browseFrom} taken={taken} onFolder={workspace.folder} onCreated={(p) => workspace.open(token, p)} />
        </div>
      </div>
    </div>
  );
}

type PaneActions = { onFocus: (id: string) => void; onClose: (id: string) => void; onMax: (id: string) => void };

/** 1-4 windows (never 0: the composer shows instead): side by side, 1+2, or 2×2, resizable; one maximized; tabs on a phone. */
function Panes({ ws, small, token, byId, ...act }: { ws: WorkspaceState; small: boolean; token: string; byId: Map<string, TreeSession> } & PaneActions) {
  const grid = useMemo(() => paneGrid(ws.panes.length), [ws.panes.length]);

  const view = (p: Pane) => <PaneView key={p.id} pane={p} token={token} s={byId.get(p.id)} active={ws.active === p.id} maxed={ws.max === p.id} {...act} />;

  if (small) {
    const cur = ws.panes.find((p) => p.id === ws.active) ?? ws.panes[0];
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Cửa sổ">
          {ws.panes.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === cur.id}
              onClick={() => act.onFocus(p.id)}
              className={cn("min-h-11 shrink-0 rounded-md border px-3 font-mono text-xs", p.id === cur.id ? "border-primary text-foreground" : "text-muted-foreground")}
            >
              {p.name}
            </button>
          ))}
        </div>
        {view(cur)}
      </div>
    );
  }

  const max = ws.panes.find((p) => p.id === ws.max);
  if (max) return view(max);

  return (
    <ResizablePanelGroup orientation="vertical" className="min-h-0">
      {grid.map((row, ri) => (
        <Fragment key={`r${ri}`}>
          {ri > 0 && <ResizableHandle className="my-1" />}
          <ResizablePanel id={`r${ri}`} minSize="20" className="min-h-0">
            <ResizablePanelGroup orientation="horizontal">
              {row.map((i, ci) => (
                <Fragment key={ws.panes[i].id}>
                  {ci > 0 && <ResizableHandle className="mx-1" />}
                  <ResizablePanel id={ws.panes[i].id} minSize="20" className="flex min-h-0 min-w-0">
                    {view(ws.panes[i])}
                  </ResizablePanel>
                </Fragment>
              ))}
            </ResizablePanelGroup>
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

/** One session window: header (folder/name, status, takeover, maximize, close) over its live terminal. */
function PaneView({ pane, token, s, active, maxed, onFocus, onClose, onMax }: { pane: Pane; token: string; s?: TreeSession; active: boolean; maxed: boolean } & PaneActions) {
  const url = `/api/sessions/${encodeURIComponent(pane.id)}/term`;
  // Bumped after a takeover: the terminal reconnects to the bridge that now owns the session.
  const [gen, setGen] = useState(0);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takeover = async () => {
    setMoving(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "x-hq-token": token, "content-type": "application/json" }, body: JSON.stringify({ takeover: true, cols: 120, rows: 34 }) });
      if (!res.ok) throw new Error(await errorOf(res));
      setGen((g) => g + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="neon-panel flex min-h-0 min-w-0 flex-1 flex-col" data-active={active ? "true" : undefined} onFocusCapture={() => onFocus(pane.id)} onPointerDown={() => onFocus(pane.id)}>
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        {s && <StatusDot status={STATUS_OF[s.state]} />}
        <p className="min-w-0 flex-1 truncate text-xs" title={[`${pane.cwd} · ${pane.name}`, s ? TREE_WORD[s.state] : null, s?.doing].filter(Boolean).join("\n")}>
          <span className="text-muted-foreground">{folderName(pane.cwd)} /</span> <span className="font-medium text-foreground">{s?.title ?? pane.name}</span>
          {s?.doing && <span className="text-muted-foreground"> · {s.doing}</span>}
        </p>
        {error && <span className="max-w-48 truncate text-[11px] text-danger" title={error}>{error}</span>}
        <Button size="icon-sm" variant="ghost" className="max-md:size-11" disabled={moving} aria-busy={moving} aria-label="Chuyển sang HQ (đóng terminal kia)" title="Chuyển sang HQ: đóng terminal kia rồi mở phiên ở đây" onClick={() => void takeover()}>
          <ArrowRightLeftIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" className="max-md:hidden" aria-label={maxed ? "Thu nhỏ" : "Phóng to"} aria-pressed={maxed} onClick={() => onMax(pane.id)}>
          {maxed ? <Minimize2Icon /> : <Maximize2Icon />}
        </Button>
        <Button size="icon-sm" variant="ghost" className="max-md:size-11" aria-label="Đóng cửa sổ (phiên vẫn chạy)" title="Đóng cửa sổ (phiên vẫn chạy)" onClick={() => onClose(pane.id)}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2">
        <LiveTerminal key={gen} url={url} token={token} cwd={pane.cwd} />
      </div>
    </div>
  );
}
