"use client";

import { ArrowRightLeftIcon, FolderGit2Icon, LayoutGridIcon, Maximize2Icon, Minimize2Icon, PlusIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  EMPTY_WORKSPACE,
  browseStart,
  closePane,
  folderName,
  mergeProjects,
  openPane,
  paneGrid,
  pathKey,
  pushRecent,
  readWorkspace,
  type OmpSessionRow,
  type Pane,
  type WorkspaceState,
  type WsProject,
} from "@/lib/omp-workspace";
import { cn } from "@/lib/utils";
import { StatusDot } from "./bits";
import { PROJECT_SEARCH_ID, ProjectPicker, StartPanel, statusOf, type Listing } from "./workspace-launcher";

// xterm touches `window`: the terminal loads in the page only.
const LiveTerminal = dynamic(() => import("./live-terminal").then((m) => m.LiveTerminal), { ssr: false });

const PANES_KEY = "hq.workspace.panes";
const RECENT_KEY = "hq.workspace.recent";
const FOLDER_KEY = "hq.workspace.folder";
/** Below Tailwind `md` the panes become tabs and the picker takes the whole screen: one thing at a time. */
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

function readList(key: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

/**
 * Không gian (owner 2026-11-02, omp-first; "học theo Claude Code Desktop"): pick a project (the one
 * selected in the sidebar by default) → a start composer and that project's omp sessions (`8sync . ls`)
 * → open one or start a new one, up to four side by side. Once a pane is open the launcher folds into
 * "Mở phiên", drawn over the panes so no terminal is resized. A pane is the session's own terminal
 * (`8sync ccc term omp-<id>`); "Chuyển sang HQ" (takeover) only on the owner's click.
 */
export function WorkspaceView({ token, projects, selected }: { token: string; projects: WsProject[]; selected: string | null }) {
  const small = useSyncExternalStore(subscribeSmall, isSmall, () => false);
  const [ws, setWs] = useState<WorkspaceState>(EMPTY_WORKSPACE);
  const [recent, setRecent] = useState<string[]>([]);
  // The folder picked in this tab, the last one saved, and the sidebar's project: picked > sidebar > saved.
  const [chosen, setChosen] = useState<string | null>(null);
  const [stored, setStored] = useState<string | null>(null);
  const [lastSelected, setLastSelected] = useState(selected);
  if (selected !== lastSelected) {
    // A new sidebar pick wins over the one made here.
    setLastSelected(selected);
    setChosen(null);
  }
  const folder = chosen ?? selected ?? stored;
  const [loaded, setLoaded] = useState(false);
  // Panes open: the launcher shows over them only on "Mở phiên".
  const [launcher, setLauncher] = useState(false);
  // Small screens: the project list instead of the start screen.
  const [picking, setPicking] = useState(false);
  const [home, setHome] = useState<string | null>(null);
  // The last row seen for each open session, for the pane header's status.
  const [rows, setRows] = useState<Record<string, OmpSessionRow>>({});

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

  // localStorage after mount (the server render has none); saved only once read, so a first render never wipes it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists on the client
    setWs(readWorkspace(localStorage.getItem(PANES_KEY)));
    setRecent(readList(RECENT_KEY));
    setStored(localStorage.getItem(FOLDER_KEY));
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(PANES_KEY, JSON.stringify(ws));
  }, [ws, loaded]);
  // The home folder: `~\…` paths in the picker, and where browsing falls back to.
  useEffect(() => {
    api<Listing>("/api/tree?path=")
      .then((l) => setHome(l.home || null))
      .catch(() => {});
  }, [api]);

  const list = useMemo(() => mergeProjects(recent, projects), [recent, projects]);
  const browseFrom = useMemo(() => browseStart(list.map((p) => p.path), home), [list, home]);
  const folderLabel = folder ? (list.find((p) => pathKey(p.path) === pathKey(folder))?.name ?? folderName(folder)) : "";

  const pickFolder = useCallback((p: string) => {
    setChosen(p);
    setStored(p);
    setPicking(false);
    localStorage.setItem(FOLDER_KEY, p);
    setRecent((r) => {
      const next = pushRecent(r, p);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const switchProject = useCallback(() => {
    if (small) setPicking(true);
    else document.getElementById(PROJECT_SEARCH_ID)?.focus();
  }, [small]);

  const open = useCallback((p: Pane) => {
    setWs((s) => openPane(s, p));
    setLauncher(false);
  }, []);
  const close = useCallback(
    (id: string) => {
      setWs((s) => closePane(s, id));
      // Frees the bridge only: the omp session keeps running and opens again from the list.
      void fetch(`/api/sessions/${encodeURIComponent(id)}/term`, { method: "DELETE", headers: { "x-hq-token": token } }).catch(() => {});
    },
    [token],
  );
  const seen = useCallback((l: OmpSessionRow[]) => {
    setRows((r) => {
      const next = { ...r };
      for (const x of l) if (x.inbox_id) next[x.inbox_id] = x;
      return next;
    });
  }, []);

  const hasPanes = ws.panes.length > 0;
  const showLauncher = !hasPanes || launcher;
  const showList = !small || picking || !folder;
  const showStart = !small || (!picking && !!folder);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasPanes && (
        <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5 md:px-3" role="tablist" aria-label="Không gian">
          <Button size="sm" variant={launcher ? "ghost" : "secondary"} className="max-md:h-11 max-md:flex-1" role="tab" aria-selected={!launcher} onClick={() => setLauncher(false)}>
            <LayoutGridIcon aria-hidden /> Cửa sổ <span className="font-mono text-xs text-muted-foreground tabular">{ws.panes.length}</span>
          </Button>
          <Button size="sm" variant={launcher ? "secondary" : "ghost"} className="max-md:h-11 max-md:flex-1" role="tab" aria-selected={launcher} onClick={() => setLauncher(true)}>
            <PlusIcon aria-hidden /> Mở phiên
          </Button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {hasPanes && (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col p-2 md:p-3" aria-label="Cửa sổ phiên" inert={launcher}>
            <Panes ws={ws} small={small} token={token} rows={rows} onFocus={(id) => setWs((s) => ({ ...s, active: id }))} onClose={close} onMax={(id) => setWs((s) => ({ ...s, active: id, max: s.max === id ? null : id }))} />
          </section>
        )}
        {/* Kept mounted while hidden: the session list keeps the pane headers' status fresh, and the search stays. */}
        <div
          className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-background md:flex-row", hasPanes && "absolute inset-0 z-10", !showLauncher && "hidden")}
          onKeyDown={(e) => {
            if (e.key === "Escape" && hasPanes) setLauncher(false);
          }}
        >
          {showList && (
            <aside className="flex min-h-0 flex-1 flex-col md:w-72 md:flex-none md:border-r" aria-label="Chọn dự án">
              <ProjectPicker api={api} list={list} folder={folder} home={home} browseFrom={browseFrom} onPick={pickFolder} />
            </aside>
          )}
          {showStart && (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              {folder ? (
                <StartPanel key={folder} api={api} cwd={folder} name={folderLabel} home={home} openIds={ws.panes.map((p) => p.id)} onOpen={open} onRows={seen} onSwitch={switchProject} />
              ) : (
                <div className="grid h-full place-items-center p-6">
                  <div className="flex max-w-sm flex-col items-center gap-2 text-center">
                    <FolderGit2Icon className="size-6 text-muted-foreground" aria-hidden />
                    <p className="text-base font-semibold">Chọn một dự án để bắt đầu</p>
                    <p className="text-sm text-muted-foreground">Bên trái là các repo HQ đã biết trên máy. Không thấy? Dán đường dẫn vào ô tìm, hoặc Duyệt thư mục.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type PaneActions = { onFocus: (id: string) => void; onClose: (id: string) => void; onMax: (id: string) => void };

/** 1-4 windows (never 0: the launcher shows instead): side by side, 1+2, or 2×2, resizable; one maximized; tabs on a phone. */
function Panes({ ws, small, token, rows, ...act }: { ws: WorkspaceState; small: boolean; token: string; rows: Record<string, OmpSessionRow> } & PaneActions) {
  const grid = useMemo(() => paneGrid(ws.panes.length), [ws.panes.length]);

  const view = (p: Pane) => <PaneView key={p.id} pane={p} token={token} row={rows[p.id]} active={ws.active === p.id} maxed={ws.max === p.id} {...act} />;

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
function PaneView({ pane, token, row, active, maxed, onFocus, onClose, onMax }: { pane: Pane; token: string; row?: OmpSessionRow; active: boolean; maxed: boolean } & PaneActions) {
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
        {row && <StatusDot status={statusOf(row.status)} />}
        <p className="min-w-0 flex-1 truncate text-xs" title={`${pane.cwd} · ${pane.name}`}>
          <span className="text-muted-foreground">{folderName(pane.cwd)} /</span> <span className="font-mono text-foreground">{pane.name}</span>
          {row?.doing && <span className="text-muted-foreground"> · {row.doing}</span>}
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
        <LiveTerminal key={gen} url={url} token={token} compact />
      </div>
    </div>
  );
}
