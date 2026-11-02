"use client";

// Không gian's launcher (owner 2026-11-02: "học theo UI/UX Claude Code Desktop"): pick a project from the
// ones HQ already knows (search, recent first; "Duyệt thư mục…" as the fallback), then a centered start
// composer for that project over its omp sessions to resume. Rules in lib/omp-workspace.ts.
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ChevronRightIcon, ChevronsUpDownIcon, FolderGit2Icon, FolderIcon, FolderOpenIcon, HardDriveIcon, HouseIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OMP_STATUS_WORD, agoVi, filterProjects, folderName, isOmpModel, isOmpSessionName, pathKey, shortPath, tokensShort, type OmpSessionRow, type Pane, type WsProject } from "@/lib/omp-workspace";
import { cn } from "@/lib/utils";
import { StatusDot } from "./bits";
import type { SessionStatus } from "./types";

export type Api = <T>(url: string, init?: { method?: string; body?: unknown }) => Promise<T>;
type TreeDir = { name: string; path: string; git: boolean };
export type Listing = { path: string; parent: string | null; roots: string[]; home: string; dirs: TreeDir[] };

const SESSIONS_POLL_MS = 10_000;
const ABS_PATH = /^([a-z]:[\\/]|\/|\\\\)/i;
/** The picker's search box: the composer's project chip focuses it on wide screens. */
export const PROJECT_SEARCH_ID = "ws-project-search";

export const statusOf = (s: string | null | undefined): SessionStatus => (s === "running" || s === "needs_input" || s === "ended" ? s : "idle");

const STATUS_INK: Record<SessionStatus, string> = { running: "text-success", needs_input: "text-warning font-medium", idle: "text-muted-foreground", ended: "text-muted-foreground" };

/** One row style for the picker, the browser and the session list: neutral hover, the current one in a brand wash. */
const row =
  "group flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/60 aria-[current=true]:bg-primary/10 aria-[current=true]:ring-1 aria-[current=true]:ring-primary/30 motion-reduce:transition-none";

/** Searchable project list (recent, then every repo HQ knows), or the folder browser. A typed absolute path opens on Enter. */
export function ProjectPicker({ api, list, folder, home, browseFrom, onPick }: { api: Api; list: WsProject[]; folder: string | null; home: string | null; browseFrom: string | null; onPick: (p: string) => void }) {
  const [q, setQ] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const typed = q.trim();
  const isPath = ABS_PATH.test(typed);
  const shown = useMemo(() => filterProjects(list, isPath ? "" : q), [list, q, isPath]);
  const recent = shown.filter((p) => p.recent);
  const rest = shown.filter((p) => !p.recent);
  const cur = folder ? pathKey(folder) : null;

  const item = (p: WsProject) => {
    const active = cur === pathKey(p.path);
    return (
      <li key={p.path}>
        <button type="button" aria-current={active} className={cn(row, "py-1.5 max-md:py-2.5")} title={p.path} onClick={() => onPick(p.path)}>
          <FolderGit2Icon className="size-4 shrink-0 text-muted-foreground group-aria-[current=true]:text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{p.name}</span>
            {/* Where it lives (the name already says which folder); a long one loses its start, not the useful end. */}
            <span className="block truncate text-left font-mono text-[11px] leading-4 text-muted-foreground [direction:rtl]">
              <bdi>{shortPath(p.path.replace(/[\\/]+[^\\/]+[\\/]*$/, ""), home)}</bdi>
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 p-3 pb-2">
        <h2 className="text-sm font-semibold">Dự án</h2>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const pick = isPath ? typed : shown[0]?.path;
            if (!pick) return;
            onPick(pick);
            setQ("");
            setBrowsing(false);
          }}
        >
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id={PROJECT_SEARCH_ID}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (e.target.value) setBrowsing(false);
              }}
              placeholder="Tìm dự án, hoặc dán đường dẫn"
              aria-label="Tìm dự án hoặc dán đường dẫn thư mục"
              className="h-9 bg-card pl-8 text-sm max-md:h-11"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </form>
      </div>

      {browsing ? (
        <FolderBrowser api={api} start={browseFrom} home={home} onPick={onPick} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {isPath && (
            <button
              type="button"
              className={cn(row, "mb-2 py-2")}
              onClick={() => {
                onPick(typed);
                setQ("");
              }}
            >
              <FolderOpenIcon className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">
                Mở <span className="font-mono">{typed}</span>
              </span>
              <span className="neon-label">Enter</span>
            </button>
          )}
          {!isPath && shown.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {q ? (
                <>
                  Không có dự án nào khớp “{q}”. Dán đường dẫn đầy đủ rồi Enter, hoặc duyệt thư mục.
                </>
              ) : (
                "HQ chưa biết dự án nào. Duyệt thư mục để chọn một cái."
              )}
            </p>
          )}
          {recent.length > 0 && (
            <section aria-labelledby="ws-recent" className="mb-3">
              <h3 id="ws-recent" className="neon-heading px-2 pb-1">
                Gần đây
              </h3>
              <ul className="space-y-0.5">{recent.map(item)}</ul>
            </section>
          )}
          {rest.length > 0 && (
            <section aria-labelledby="ws-all">
              <h3 id="ws-all" className="neon-heading px-2 pb-1">
                {q ? "Kết quả" : "Tất cả dự án"} <span className="font-mono text-[11px] font-normal tabular">{rest.length}</span>
              </h3>
              <ul className="space-y-0.5">{rest.map(item)}</ul>
            </section>
          )}
        </div>
      )}

      <div className="shrink-0 border-t p-2">
        <Button type="button" variant="ghost" size="sm" className="w-full justify-start max-md:h-11" aria-pressed={browsing} onClick={() => setBrowsing((b) => !b)}>
          {browsing ? (
            <>
              <ArrowLeftIcon aria-hidden /> Danh sách dự án
            </>
          ) : (
            <>
              <FolderOpenIcon aria-hidden /> Duyệt thư mục…
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/** One folder level at a time (GET /api/tree): enter a folder, go up, or choose it. Starts where the projects live, never at a drive. */
function FolderBrowser({ api, start, home, onPick }: { api: Api; start: string | null; home: string | null; onPick: (p: string) => void }) {
  const [dir, setDir] = useState(start ?? home ?? "");
  // The answer is kept with the folder it is for: a different `dir` reads as loading.
  const [got, setGot] = useState<{ dir: string; listing: Listing | null; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    api<Listing>(`/api/tree?path=${encodeURIComponent(dir)}`)
      .then((l) => live && setGot({ dir, listing: l, error: null }))
      .catch((e: Error) => live && setGot({ dir, listing: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [api, dir]);

  const ready = got?.dir === dir ? got : null;
  const listing = ready?.listing ?? null;
  const here = listing?.path || dir;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-2">
        <Button size="icon-sm" variant="ghost" className="max-md:size-11" aria-label="Lên thư mục cha" title="Lên thư mục cha" disabled={!dir} onClick={() => setDir(listing?.parent ?? "")}>
          <ArrowUpIcon />
        </Button>
        <p className="min-w-0 flex-1 truncate font-mono text-xs" title={here || "Máy này"}>
          {here ? shortPath(here, home) : "Máy này"}
        </p>
        {home && (
          <Button size="icon-sm" variant="ghost" className="max-md:size-11" aria-label="Về thư mục nhà" title="Về thư mục nhà" onClick={() => setDir(home)}>
            <HouseIcon />
          </Button>
        )}
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" aria-busy={!ready}>
        {!ready && [0, 1, 2, 3].map((i) => <li key={i} className="mx-2 my-2 h-4 animate-pulse rounded bg-muted" style={{ width: `${70 - i * 12}%` }} />)}
        {ready?.error && (
          <li className="px-2 py-2 text-xs text-danger" role="alert">
            {ready.error}
          </li>
        )}
        {listing && listing.dirs.length === 0 && <li className="px-2 py-4 text-center text-xs text-muted-foreground">Không có thư mục con.</li>}
        {listing?.dirs.map((d) => {
          const Icon = !dir ? HardDriveIcon : d.git ? FolderGit2Icon : FolderIcon;
          return (
            <li key={d.path} className="group/dir flex items-center gap-1">
              <button type="button" className={cn(row, "min-h-8 flex-1 py-1 text-sm max-md:min-h-11")} title={d.path} onClick={() => setDir(d.path)}>
                <Icon className={cn("size-4 shrink-0", d.git ? "text-primary" : "text-muted-foreground")} aria-hidden />
                <span className="truncate">{d.name}</span>
                {d.git && (
                  <span className="neon-pill" data-tone="accent">
                    git
                  </span>
                )}
                <ChevronRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
              {dir && (
                <Button size="xs" variant="outline" className="shrink-0 md:opacity-0 md:group-hover/dir:opacity-100 md:focus-visible:opacity-100 max-md:h-11" aria-label={`Chọn ${d.name}`} onClick={() => onPick(d.path)}>
                  Chọn
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {dir && listing && (
        <div className="shrink-0 px-2 pb-2">
          <Button size="sm" variant="secondary" className="w-full max-md:h-11" onClick={() => onPick(listing.path)}>
            Chọn {folderName(listing.path)}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The chosen project's start screen: a centered composer (project chip, session name, optional model,
 * "Bắt đầu") over that folder's omp sessions (GET /api/omp/sessions, refreshed while shown) to resume.
 */
export function StartPanel({
  api,
  cwd,
  name,
  home,
  openIds,
  onOpen,
  onRows,
  onSwitch,
}: {
  api: Api;
  cwd: string;
  name: string;
  home: string | null;
  openIds: string[];
  onOpen: (p: Pane) => void;
  onRows: (r: OmpSessionRow[]) => void;
  onSwitch: () => void;
}) {
  const [list, setList] = useState<OmpSessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState("");
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

  const nameOk = isOmpSessionName(session);
  const modelOk = model.trim() === "" || isOmpModel(model.trim());
  const taken = list?.some((r) => r.name === session) ?? false;
  const create = async () => {
    if (!nameOk || !modelOk) return;
    setBusy(true);
    try {
      const r = await api<{ id: string; name: string; cwd: string }>("/api/omp/sessions", { method: "POST", body: { cwd, name: session, ...(model.trim() ? { model: model.trim() } : {}) } });
      onOpen({ id: r.id, name: r.name, cwd: r.cwd });
      setSession("");
      setError(null);
      setTimeout(() => void refresh(), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 md:px-8 md:py-[12vh]">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h2 className="text-center text-xl font-semibold text-balance md:text-2xl">Bắt đầu phiên omp</h2>
        <div className="neon-panel flex flex-col gap-1 p-2">
          <label htmlFor="ws-new-name" className="sr-only">
            Tên phiên mới
          </label>
          <Input
            id="ws-new-name"
            value={session}
            onChange={(e) => setSession(e.target.value.toLowerCase())}
            placeholder="Tên phiên, vd fix-login"
            aria-invalid={session !== "" && !nameOk}
            aria-describedby="ws-new-hint"
            className="h-12 border-0 bg-transparent px-3 font-mono text-base shadow-none focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex flex-wrap items-center gap-2 border-t px-1 pt-2">
            <button
              type="button"
              onClick={onSwitch}
              title={cwd}
              aria-label={`Dự án: ${name}. Đổi dự án`}
              className="inline-flex h-8 max-w-[16rem] min-w-0 items-center gap-1.5 rounded-md border bg-muted/60 px-2.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none max-md:h-11"
            >
              <FolderGit2Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
              <span className="truncate font-medium">{name}</span>
              <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model (tuỳ chọn)"
              aria-label="Model cho phiên mới (tuỳ chọn)"
              aria-invalid={!modelOk}
              className="h-8 w-44 font-mono text-xs max-md:order-last max-md:h-11 max-md:w-full"
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" className="ml-auto max-md:h-11" disabled={!nameOk || !modelOk || busy} aria-busy={busy}>
              {taken ? "Mở lại" : "Bắt đầu"} <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Button>
          </div>
        </div>
        <p id="ws-new-hint" className={cn("px-1 text-xs", session !== "" && !nameOk ? "text-danger" : "text-muted-foreground")}>
          {session !== "" && !nameOk ? "Tên: chữ thường, số và . _ - (tối đa 48 ký tự), không trùng lệnh của 8sync." : (
            <>
              Chạy <span className="font-mono">8sync . {session || "<tên>"}</span> trong <span className="font-mono">{shortPath(cwd, home)}</span>. Trùng tên phiên có sẵn thì mở lại phiên đó.
            </>
          )}
        </p>
      </form>

      <section aria-labelledby="ws-sessions" className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <h3 id="ws-sessions" className="neon-heading">
            Phiên trong {name}
            {list && <span className="ml-1.5 font-mono text-[11px] font-normal tabular">{list.length}</span>}
          </h3>
          <Button size="icon-sm" variant="ghost" className="ml-auto text-muted-foreground max-md:size-11" aria-label="Tải lại danh sách phiên" title="Tải lại" onClick={() => void refresh()}>
            <RefreshCwIcon />
          </Button>
        </div>
        {error && (
          <p className="px-1 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        {list == null && !error && (
          <div className="neon-panel divide-y" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <span className="size-2 rounded-full bg-muted" />
                <span className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${40 - i * 8}%` }} />
              </div>
            ))}
          </div>
        )}
        {list?.length === 0 && <p className="neon-empty">Chưa có phiên omp nào trong {name}. Đặt tên ở trên rồi Bắt đầu.</p>}
        {list != null && list.length > 0 && (
          <ul className="neon-panel divide-y overflow-hidden">
            {list.map((r) => {
              const id = r.inbox_id ?? null;
              const isOpen = id != null && openIds.includes(id);
              const st = statusOf(r.status);
              const line = r.doing || r.title || "";
              const tok = tokensShort(r.tokens);
              return (
                <li key={r.name}>
                  <button
                    type="button"
                    disabled={!id}
                    title={id ? `Mở ${r.name}` : "Phiên chưa có id: mở bằng 8sync . trong terminal"}
                    onClick={() => id && onOpen({ id, name: r.name, cwd })}
                    className="group flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset disabled:opacity-60 motion-reduce:transition-none max-md:py-3"
                  >
                    <StatusDot status={st} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-sm font-medium">{r.name}</span>
                        {isOpen && (
                          <span className="neon-pill" data-tone="accent">
                            Đang mở
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className={STATUS_INK[st]}>{OMP_STATUS_WORD[st]}</span>
                        {line && ` · ${line}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5 font-mono text-[11px] text-muted-foreground tabular">
                      {r.last_active ? <span>{agoVi(r.last_active, now)}</span> : null}
                      {tok && <span>{tok} tok</span>}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
