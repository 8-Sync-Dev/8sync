"use client";

// Folder choosing for Không gian's composer (the "Chọn thư mục khác…" dialog): the projects HQ already
// knows (search, recent first) or "Duyệt thư mục…" one level at a time; a typed absolute path opens on
// Enter. Rules in lib/omp-workspace.ts.
import { ArrowLeftIcon, ArrowUpIcon, ChevronRightIcon, FolderGit2Icon, FolderIcon, FolderOpenIcon, FolderPlusIcon, HardDriveIcon, HouseIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterProjects, folderName, pathKey, shortPath, type WsProject } from "@/lib/omp-workspace";
import { cn } from "@/lib/utils";

export type Api = <T>(url: string, init?: { method?: string; body?: unknown }) => Promise<T>;
type TreeDir = { name: string; path: string; git: boolean };
export type Listing = { path: string; parent: string | null; roots: string[]; home: string; dirs: TreeDir[] };

const ABS_PATH = /^([a-z]:[\\/]|\/|\\\\)/i;
/** The picker's search box. */
const PROJECT_SEARCH_ID = "ws-project-search";

/** One row style for the picker and the browser: neutral hover, the current one a gray layer. */
const row =
  "group flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/60 aria-[current=true]:bg-accent aria-[current=true]:font-medium motion-reduce:transition-none";

/** Searchable project list (recent, then every repo HQ knows), or the folder browser. A typed absolute path opens on Enter. */
export function ProjectPicker({ api, list, folder, home, browseFrom, onPick }: { api: Api; list: WsProject[]; folder: string | null; home: string | null; browseFrom: string | null; onPick: (p: string) => void }) {
  const [q, setQ] = useState("");
  // "new" = the browser with the "Thư mục mới" form already open.
  const [browsing, setBrowsing] = useState<false | "browse" | "new">(false);
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
          <FolderGit2Icon className="size-4 shrink-0 text-muted-foreground group-aria-[current=true]:text-foreground" aria-hidden />
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
        <FolderBrowser api={api} start={browseFrom} home={home} onPick={onPick} startNew={browsing === "new"} />
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

      <div className="flex shrink-0 gap-1 border-t p-2">
        {browsing ? (
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start max-md:h-11" onClick={() => setBrowsing(false)}>
            <ArrowLeftIcon aria-hidden /> Danh sách dự án
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" size="sm" className="flex-1 justify-start max-md:h-11" onClick={() => setBrowsing("browse")}>
              <FolderOpenIcon aria-hidden /> Duyệt thư mục…
            </Button>
            <Button type="button" variant="ghost" size="sm" className="flex-1 justify-start max-md:h-11" title="Tạo thư mục dự án mới rồi mở phiên trong đó" onClick={() => setBrowsing("new")}>
              <FolderPlusIcon aria-hidden /> Thư mục mới…
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One folder level at a time (GET /api/tree): enter a folder, go up, or choose it. Starts where the projects live, never at a drive.
 * "Thư mục mới" makes an empty project folder here (POST /api/tree, `git init` unless unticked) and chooses it.
 */
function FolderBrowser({ api, start, home, onPick, startNew = false }: { api: Api; start: string | null; home: string | null; onPick: (p: string) => void; startNew?: boolean }) {
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
  const [making, setMaking] = useState(startNew);
  const [name, setName] = useState("");
  const [git, setGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const closeNew = () => {
    setMaking(false);
    setName("");
    setErr(null);
  };
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!listing?.path || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ path: string; git: boolean; gitError?: string }>("/api/tree", { method: "POST", body: { parent: listing.path, name: name.trim(), git } });
      if (git && !r.git) toast.error(`Đã tạo ${folderName(r.path)} nhưng git init lỗi: ${r.gitError ?? ""}`);
      else toast.success(`Đã tạo ${folderName(r.path)}${r.git ? " (git)" : ""}`);
      closeNew();
      onPick(r.path);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
        {dir && listing && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs max-md:h-11" aria-expanded={making} aria-controls="ws-new-folder" title={`Tạo thư mục mới trong ${folderName(listing.path)}`} onClick={() => (making ? closeNew() : setMaking(true))}>
            <FolderPlusIcon aria-hidden /> Thư mục mới
          </Button>
        )}
      </div>
      {making && listing && (
        <form id="ws-new-folder" onSubmit={create} className="mx-2 mb-2 space-y-2 rounded-lg border bg-muted/40 p-2">
          <div className="flex items-center gap-1.5">
            <FolderPlusIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), closeNew())}
              placeholder="ten-du-an"
              aria-label={`Tên thư mục mới trong ${listing.path}`}
              aria-invalid={!!err}
              aria-describedby={err ? "ws-new-folder-err" : undefined}
              maxLength={100}
              spellCheck={false}
              autoComplete="off"
              className="h-8 bg-background font-mono text-xs max-md:h-11"
            />
            <Button type="submit" size="sm" className="h-8 shrink-0 max-md:h-11" disabled={busy || !name.trim()}>
              {busy ? "Đang tạo…" : "Tạo"}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <label className="flex min-h-7 cursor-pointer items-center gap-2 text-muted-foreground select-none max-md:min-h-11">
              <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} className="size-3.5 accent-primary" />
              Khởi tạo git
            </label>
            <button type="button" className="rounded px-1.5 py-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:min-h-11" onClick={closeNew}>
              Huỷ
            </button>
          </div>
          {err && (
            <p id="ws-new-folder-err" role="alert" className="text-xs text-danger">
              {err}
            </p>
          )}
        </form>
      )}
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
