"use client";

import { ArrowRightLeftIcon, ChevronRightIcon, FolderGit2Icon, FolderIcon, HardDriveIcon, Maximize2Icon, Minimize2Icon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  EMPTY_WORKSPACE,
  MAX_PANES,
  agoVi,
  closePane,
  folderName,
  isOmpModel,
  isOmpSessionName,
  openPane,
  paneGrid,
  pushRecent,
  readWorkspace,
  tokensShort,
  type OmpSessionRow,
  type Pane,
  type WorkspaceState,
} from "@/lib/omp-workspace";
import { cn } from "@/lib/utils";
import { StatusDot } from "./bits";
import type { SessionStatus } from "./types";

// xterm touches `window`: the terminal loads in the page only.
const LiveTerminal = dynamic(() => import("./live-terminal").then((m) => m.LiveTerminal), { ssr: false });

type TreeDir = { name: string; path: string; git: boolean };
type Listing = { path: string; parent: string | null; roots: string[]; dirs: TreeDir[] };

const PANES_KEY = "hq.workspace.panes";
const RECENT_KEY = "hq.workspace.recent";
const FOLDER_KEY = "hq.workspace.folder";
const SESSIONS_POLL_MS = 10_000;
/** Below Tailwind `md` the panes become tabs: one window at a time. */
const SMALL_QUERY = "(max-width: 767px)";
const subscribeSmall = (cb: () => void) => {
  const m = window.matchMedia(SMALL_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const isSmall = () => window.matchMedia(SMALL_QUERY).matches;
const ABS_PATH = /^([a-z]:[\\/]|\/|\\\\)/i;

const statusOf = (s: string | null | undefined): SessionStatus => (s === "running" || s === "needs_input" || s === "ended" ? s : "idle");

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
 * Không gian (owner 2026-11-02, omp-first): every folder on the machine → its omp sessions
 * (`8sync . ls`) → open one or start a new one, up to four side by side. A pane is the session's
 * own terminal (`8sync ccc term omp-<id>`); "Chuyển sang HQ" (takeover) only on the owner's click.
 */
export function WorkspaceView({ token }: { token: string }) {
  const small = useSyncExternalStore(subscribeSmall, isSmall, () => false);
  const [ws, setWs] = useState<WorkspaceState>(EMPTY_WORKSPACE);
  const [recent, setRecent] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Small screens: the folder side or the windows, one at a time.
  const [side, setSide] = useState<"folders" | "panes">("folders");
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
    const w = readWorkspace(localStorage.getItem(PANES_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists on the client
    setWs(w);
    setRecent(readList(RECENT_KEY));
    setFolder(localStorage.getItem(FOLDER_KEY));
    if (w.panes.length) setSide("panes");
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(PANES_KEY, JSON.stringify(ws));
  }, [ws, loaded]);

  const pickFolder = useCallback((p: string) => {
    setFolder(p);
    localStorage.setItem(FOLDER_KEY, p);
    setRecent((r) => {
      const next = pushRecent(r, p);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const open = useCallback((p: Pane) => {
    setWs((s) => openPane(s, p));
    setSide("panes");
  }, []);
  const close = useCallback(
    (id: string) => {
      setWs((s) => closePane(s, id));
      // Frees the bridge only: the omp session keeps running and opens again from the list.
      void fetch(`/api/sessions/${encodeURIComponent(id)}/term`, { method: "DELETE", headers: { "x-hq-token": token } }).catch(() => {});
    },
    [token],
  );
  const seen = useCallback((list: OmpSessionRow[]) => {
    setRows((r) => {
      const next = { ...r };
      for (const x of list) if (x.inbox_id) next[x.inbox_id] = x;
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {small && (
        <div className="flex shrink-0 gap-1 border-b px-3 py-2" role="tablist" aria-label="Không gian">
          <Button size="sm" variant={side === "folders" ? "secondary" : "ghost"} className="min-h-11 flex-1" role="tab" aria-selected={side === "folders"} onClick={() => setSide("folders")}>
            Thư mục
          </Button>
          <Button size="sm" variant={side === "panes" ? "secondary" : "ghost"} className="min-h-11 flex-1" role="tab" aria-selected={side === "panes"} onClick={() => setSide("panes")}>
            Cửa sổ <span className="font-mono text-xs text-muted-foreground tabular">{ws.panes.length}</span>
          </Button>
        </div>
      )}
      {(!small || side === "folders") && (
        <aside className="flex min-h-0 flex-1 flex-col border-b md:w-80 md:flex-none md:border-r md:border-b-0">
          <FolderTree api={api} folder={folder} recent={recent} onPick={pickFolder} />
          {folder && <SessionList key={folder} api={api} cwd={folder} openIds={ws.panes.map((p) => p.id)} onOpen={open} onRows={seen} />}
        </aside>
      )}
      {(!small || side === "panes") && (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col p-2 md:p-3" aria-label="Cửa sổ phiên">
          <Panes ws={ws} small={small} token={token} rows={rows} onFocus={(id) => setWs((s) => ({ ...s, active: id }))} onClose={close} onMax={(id) => setWs((s) => ({ ...s, active: id, max: s.max === id ? null : id }))} />
        </section>
      )}
    </div>
  );
}

type Api = <T>(url: string, init?: { method?: string; body?: unknown }) => Promise<T>;

/** The machine's folders, one level per click (GET /api/tree); a path typed into the box opens directly. */
function FolderTree({ api, folder, recent, onPick }: { api: Api; folder: string | null; recent: string[]; onPick: (p: string) => void }) {
  const [roots, setRoots] = useState<TreeDir[] | null>(null);
  const [kids, setKids] = useState<Record<string, TreeDir[] | "loading" | string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Listing>("/api/tree?path=")
      .then((l) => setRoots(l.dirs))
      .catch((e: Error) => setError(e.message));
  }, [api]);

  const load = useCallback(
    (p: string) => {
      setKids((k) => ({ ...k, [p]: "loading" }));
      api<Listing>(`/api/tree?path=${encodeURIComponent(p)}`)
        .then((l) => setKids((k) => ({ ...k, [p]: l.dirs })))
        .catch((e: Error) => setKids((k) => ({ ...k, [p]: e.message })));
    },
    [api],
  );
  const toggle = (p: string) => {
    const opening = !expanded.has(p);
    // A folder that failed to read (or never did) is read again on open.
    if (opening && (kids[p] === undefined || (typeof kids[p] === "string" && kids[p] !== "loading"))) load(p);
    setExpanded((s) => {
      const n = new Set(s);
      if (opening) n.add(p);
      else n.delete(p);
      return n;
    });
  };
  const pick = (p: string) => {
    onPick(p);
    if (!expanded.has(p)) toggle(p);
  };

  const q = filter.trim().toLowerCase();
  const typedPath = ABS_PATH.test(filter.trim());
  const shows = (d: TreeDir) => !q || typedPath || expanded.has(d.path) || d.name.toLowerCase().includes(q);

  const branch = (dirs: TreeDir[], depth: number): ReactNode =>
    dirs.filter(shows).map((d) => {
      const isOpen = expanded.has(d.path);
      const k = kids[d.path];
      const Icon = depth === 0 ? HardDriveIcon : d.git ? FolderGit2Icon : FolderIcon;
      return (
        <li key={d.path}>
          <div
            className={cn("group flex items-center rounded-md pr-1 text-sm hover:bg-muted/60", folder === d.path && "bg-muted text-foreground")}
            style={{ paddingLeft: depth * 12 }}
          >
            <button type="button" className="grid size-7 shrink-0 place-items-center text-muted-foreground max-md:size-10" aria-label={isOpen ? `Thu ${d.name}` : `Mở ${d.name}`} aria-expanded={isOpen} onClick={() => toggle(d.path)}>
              <ChevronRightIcon className={cn("size-3.5 transition-transform motion-reduce:transition-none", isOpen && "rotate-90")} />
            </button>
            <button type="button" className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 text-left max-md:min-h-10" title={d.path} onClick={() => pick(d.path)}>
              <Icon className={cn("size-3.5 shrink-0", d.git ? "text-primary" : "text-muted-foreground")} aria-hidden />
              <span className="truncate">{d.name}</span>
              {d.git && <span className="sr-only">(git)</span>}
            </button>
          </div>
          {isOpen && (
            <ul>
              {k === "loading" && <li className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 12 + 28 }}>Đang đọc…</li>}
              {typeof k === "string" && k !== "loading" && <li className="py-1 text-xs text-danger" style={{ paddingLeft: depth * 12 + 28 }}>{k}</li>}
              {Array.isArray(k) && (k.length ? branch(k, depth + 1) : <li className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 12 + 28 }}>Không có thư mục con</li>)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const p = filter.trim();
          if (ABS_PATH.test(p)) {
            onPick(p);
            setFilter("");
          }
        }}
      >
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Lọc tên, hoặc dán đường dẫn rồi Enter" aria-label="Lọc thư mục" className="h-8 text-sm max-md:h-11" spellCheck={false} autoComplete="off" />
      </form>
      {recent.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="neon-label">Gần đây</p>
          <div className="flex flex-wrap gap-1">
            {recent.map((p) => (
              <button
                key={p}
                type="button"
                title={p}
                onClick={() => onPick(p)}
                className={cn("max-w-40 truncate rounded-md border px-2 py-0.5 text-xs hover:border-primary/60 max-md:py-2", folder === p ? "border-primary text-foreground" : "text-muted-foreground")}
              >
                {folderName(p)}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="neon-label">Máy này</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="text-xs text-danger">{error}</p> : roots == null ? <p className="text-xs text-muted-foreground">Đang đọc ổ đĩa…</p> : <ul>{branch(roots, 0)}</ul>}
      </div>
    </div>
  );
}

/** The omp sessions of `cwd` (GET /api/omp/sessions), refreshed while shown, and a new one (POST). */
function SessionList({ api, cwd, openIds, onOpen, onRows }: { api: Api; cwd: string; openIds: string[]; onOpen: (p: Pane) => void; onRows: (r: OmpSessionRow[]) => void }) {
  const [list, setList] = useState<OmpSessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ cwd: string; sessions: OmpSessionRow[] }>(`/api/omp/sessions?cwd=${encodeURIComponent(cwd)}`);
      setList(r.sessions);
      onRows(r.sessions);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setNow(Date.now());
  }, [api, cwd, onRows]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first fetch on mount; state is set after the await
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, SESSIONS_POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const nameOk = isOmpSessionName(name);
  const modelOk = model.trim() === "" || isOmpModel(model.trim());
  const create = async () => {
    if (!nameOk || !modelOk) return;
    setBusy(true);
    try {
      const r = await api<{ id: string; name: string; cwd: string }>("/api/omp/sessions", { method: "POST", body: { cwd, name, ...(model.trim() ? { model: model.trim() } : {}) } });
      onOpen({ id: r.id, name: r.name, cwd: r.cwd });
      setName("");
      setError(null);
      setTimeout(() => void refresh(), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="neon-panel m-3 mt-0 flex max-h-[45%] min-h-0 shrink-0 flex-col gap-2 p-3 max-md:max-h-none">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{folderName(cwd)}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={cwd}>
            {cwd}
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" className="max-md:size-11" aria-label="Tải lại danh sách phiên" onClick={() => void refresh()}>
          <RefreshCwIcon />
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {list == null && !error && <li className="text-xs text-muted-foreground">Đang đọc phiên…</li>}
        {list?.length === 0 && <li className="text-xs text-muted-foreground">Chưa có phiên omp nào ở đây.</li>}
        {list?.map((r) => {
          const id = r.inbox_id ?? null;
          const isOpen = id != null && openIds.includes(id);
          const line = r.doing || r.title || "";
          return (
            <li key={r.name}>
              <button
                type="button"
                disabled={!id}
                onClick={() => id && onOpen({ id, name: r.name, cwd })}
                className={cn("flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 disabled:opacity-50 max-md:py-2.5", isOpen && "bg-muted")}
              >
                <span className="flex items-center gap-2 text-sm">
                  <StatusDot status={statusOf(r.status)} />
                  <span className="truncate font-mono">{r.name}</span>
                  {isOpen && <span className="text-[11px] text-primary">đang mở</span>}
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground tabular">
                    {[agoVi(r.last_active, now), tokensShort(r.tokens)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {line && <span className="truncate pl-4 text-xs text-muted-foreground">{line}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      <form
        className="flex flex-col gap-1.5 border-t pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <p className="neon-label">Phiên mới</p>
        <div className="flex gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="tên, vd fix-login" aria-label="Tên phiên mới" aria-invalid={name !== "" && !nameOk} className="h-8 min-w-0 flex-1 font-mono text-sm max-md:h-11" spellCheck={false} autoComplete="off" />
          <Button type="submit" size="sm" className="h-8 max-md:h-11" disabled={!nameOk || !modelOk || busy} aria-busy={busy}>
            <PlusIcon /> Mở
          </Button>
        </div>
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model (tuỳ chọn)" aria-label="Model cho phiên mới" aria-invalid={!modelOk} className="h-8 font-mono text-xs max-md:h-11" spellCheck={false} autoComplete="off" />
      </form>
    </div>
  );
}

type PaneActions = { onFocus: (id: string) => void; onClose: (id: string) => void; onMax: (id: string) => void };

/** 1-4 windows: side by side, 1+2, or 2×2, resizable; one maximized; tabs on a phone. */
function Panes({ ws, small, token, rows, ...act }: { ws: WorkspaceState; small: boolean; token: string; rows: Record<string, OmpSessionRow> } & PaneActions) {
  const grid = useMemo(() => paneGrid(ws.panes.length), [ws.panes.length]);
  if (!ws.panes.length)
    return (
      <div className="grid h-full place-items-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <p className="max-w-sm">Chọn một thư mục, rồi mở phiên omp có sẵn hoặc tạo phiên mới. Mở được tới {MAX_PANES} cửa sổ cạnh nhau.</p>
      </div>
    );

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
