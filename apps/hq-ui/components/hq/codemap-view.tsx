"use client";

import { ArrowLeftIcon, FileCodeIcon, FlameIcon, FolderIcon, HammerIcon, LoaderIcon, MapIcon, NetworkIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton as Bone } from "@/components/ui/skeleton";
import { graphSrcDoc, QUERY_MAX, type CodeMap, type CodemapStatus, type MapHub, type SearchMode, type SearchResult, type Skeleton } from "@/lib/codemap";
import { bytes } from "@/lib/disk";
import { useFollowRepo } from "@/lib/follow-repo";
import { agoVi } from "@/lib/now";
import { rootKey } from "@/lib/preview";
import { cn } from "@/lib/utils";
import { EmptyState } from "./bits";
import { makeApi, type Api } from "./use-hq";
import { usePoll } from "./use-poll";
import type { Project } from "./types";

const IDLE_POLL_MS = 30_000;
const BUILD_POLL_MS = 1_500;
const HOTSPOTS_SHOWN = 8;
const n = (v: number) => v.toLocaleString("vi-VN");

/** What the right-hand panel shows: one file's skeleton, or the graphify graph. */
type Side = { kind: "skeleton"; file: string; line: number | null } | { kind: "graph" };
type Loaded<T> = { key: string; data: T | null; error: string | null };

/**
 * "Bản đồ code" tab: a registered project as trail sees it (`<repo>/.trail/cache`): whether it is
 * indexed and when, its modules → folders/files → symbol counts, `trail ask` / `trail grep` with
 * file:line hits, a file's skeleton beside the list, "Index ngay" (`trail build`), and graphify's
 * graph.html when the repo has one. Every call is by project id; the server runs trail.
 * Repos on the machine that are not in HQ yet (`others`) are listed under the registered ones;
 * picking one adds it to HQ first (POST /api/projects, as "Dự án trên máy" in the sidebar does).
 */
export function CodemapView({
  token,
  projects,
  others,
  onAdded,
  repo = null,
  active,
}: {
  token: string;
  projects: Project[];
  others: { path: string; name: string }[];
  onAdded: () => Promise<unknown>;
  repo?: string | null;
  active: boolean;
}) {
  const api = useMemo(() => makeApi(token), [token]);
  const live = useMemo(() => projects.filter((p) => !p.missing), [projects]);
  const addable = useMemo(() => {
    const seen = new Set(projects.map((p) => rootKey(p.path)));
    return others.filter((o) => {
      const k = rootKey(o.path);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [projects, others]);
  const [adding, setAdding] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  useFollowRepo(repo, (r) => {
    const hit = live.find((p) => rootKey(p.path) === rootKey(r));
    if (hit) setPick(hit.id);
  });
  const id = live.some((p) => p.id === pick) ? pick : (live.find((p) => repo && rootKey(p.path) === rootKey(repo))?.id ?? live[0]?.id ?? null);

  const [fast, setFast] = useState(false);
  const status = usePoll<CodemapStatus>(api, `/api/codemap?project=${id ?? 0}`, fast ? BUILD_POLL_MS : IDLE_POLL_MS, active && id != null);
  const st = status.data?.project.id === id ? status.data : null;
  const building = st?.build?.state === "running";
  // Poll fast only while a build runs (set from the poll's own answer, not in an effect).
  if (st && building !== fast) setFast(building);

  const mapKey = id != null && st?.index.indexed ? `${id}:${st.index.builtAt}` : null;
  const [map, setMap] = useState<Loaded<CodeMap> | null>(null);
  const [mapNonce, setMapNonce] = useState(0);
  useEffect(() => {
    if (!mapKey || !active) return;
    const ac = new AbortController();
    api<{ map: CodeMap }>(`/api/codemap/map?project=${id}`, { signal: ac.signal }).then(
      (r) => setMap({ key: mapKey, data: r.map, error: null }),
      (e: Error) => {
        if (!ac.signal.aborted) setMap({ key: mapKey, data: null, error: e.message });
      },
    );
    return () => ac.abort();
  }, [api, id, mapKey, active, mapNonce]);
  const mapNow = map?.key === mapKey ? map : null;

  const [side, setSide] = useState<(Side & { project: number }) | null>(null);
  const sideNow = side?.project === id ? side : null;
  const openFile = (file: string, line: number | null) => id != null && setSide({ kind: "skeleton", file, line, project: id });

  const build = async () => {
    if (id == null) return;
    try {
      await api(`/api/codemap/build`, { method: "POST", body: { project: id } });
      setFast(true);
      status.reload();
    } catch (e) {
      toast.error(`Index: ${(e as Error).message}`);
    }
  };

  const choose = async (v: string) => {
    if (!v.startsWith("add:")) return setPick(Number(v));
    const path = v.slice(4);
    setAdding(path);
    try {
      const r = await api<{ project: Project }>("/api/projects", { method: "POST", body: { path } });
      await onAdded();
      setPick(r.project.id);
      toast.success(`Đã thêm ${r.project.name} vào HQ`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(null);
    }
  };

  if (!live.length && !addable.length) {
    return (
      <EmptyState icon={<MapIcon />} title="Chưa có dự án nào trong HQ" className="h-full justify-center">
        Thêm một dự án ở thanh bên (+ Dự án) để xem bản đồ code của nó.
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 sm:px-6">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <MapIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Bản đồ code
          <span className="text-xs font-normal text-muted-foreground max-sm:hidden">trail đọc cấu trúc repo, không gọi model</span>
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <Select value={id != null ? String(id) : ""} onValueChange={(v) => void choose(v)} disabled={adding != null}>
            <SelectTrigger size="sm" className="max-w-64 text-xs" aria-label="Dự án">
              <SelectValue placeholder={adding ? "Đang thêm…" : "Chọn dự án"} />
            </SelectTrigger>
            <SelectContent>
              {live.map((p) => (
                <SelectItem key={p.id} value={String(p.id)} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
              {addable.length > 0 && (
                <>
                  {live.length > 0 && <SelectSeparator />}
                  <SelectGroup>
                    <SelectLabel className="text-[11px]">Trên máy, chưa có trong HQ: chọn để thêm</SelectLabel>
                    {addable.map((o) => (
                      <SelectItem key={o.path} value={`add:${o.path}`} className="text-xs" title={o.path}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              status.reload();
              setMapNonce((x) => x + 1);
            }}
            aria-label="Tải lại bản đồ code"
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </div>

      {sideNow?.kind === "graph" ? (
        <GraphFrame key={id} token={token} project={id!} name={st?.project.name ?? ""} onClose={() => setSide(null)} />
      ) : (
        <div className={cn("grid min-h-0 flex-1", sideNow && "lg:grid-cols-[minmax(0,1fr)_minmax(20rem,30rem)]")}>
          <div className={cn("min-h-0 overflow-y-auto", sideNow && "max-lg:hidden lg:border-r")}>
            <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-4 sm:px-6">
              {id == null ? (
                <p className="text-sm text-muted-foreground">Chọn một repo ở góc phải để thêm vào HQ và xem bản đồ code của nó.</p>
              ) : status.error && !st ? (
                <Problem text={status.error} onRetry={status.reload} />
              ) : !st ? (
                <Bone className="h-16 w-full" />
              ) : (
                <StatusStrip st={st} now={status.at} totals={mapNow?.data?.totals ?? null} onBuild={build} />
              )}
              {st?.index.indexed && id != null && <SearchBox key={id} api={api} project={id} onOpen={openFile} />}
              {st?.index.indexed &&
                (mapNow?.error ? (
                  <Problem text={mapNow.error} onRetry={() => setMapNonce((x) => x + 1)} />
                ) : !mapNow?.data ? (
                  <div className="space-y-2" aria-busy="true" aria-label="Đang đọc bản đồ">
                    <Bone className="h-24 w-full" />
                    <Bone className="h-24 w-full" />
                  </div>
                ) : (
                  <MapTree map={mapNow.data} onOpen={openFile} />
                ))}
              {st?.graph.dir && <GraphNote st={st} now={status.at} onOpen={() => id != null && setSide({ kind: "graph", project: id })} />}
            </div>
          </div>
          {sideNow?.kind === "skeleton" && (
            <div className="min-h-0">
              <SkeletonPanel key={`${id}:${sideNow.file}`} api={api} project={id!} file={sideNow.file} line={sideNow.line} onClose={() => setSide(null)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Problem({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

/** Indexed or not, when, the counts, and "Index ngay" with its progress while it runs. */
function StatusStrip({ st, now, totals, onBuild }: { st: CodemapStatus; now: number; totals: CodeMap["totals"] | null; onBuild: () => void }) {
  const b = st.build;
  const running = b?.state === "running";
  const pct = b?.progress && b.progress.total > 0 ? Math.min(100, Math.round((b.progress.done / b.progress.total) * 100)) : null;
  return (
    <section aria-label="Trạng thái code map" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", !st.index.indexed && "text-muted-foreground")}>
          <span aria-hidden className={cn("size-2 rounded-full", st.index.indexed ? "bg-st-working" : "bg-muted-foreground/40")} />
          {st.index.indexed ? "Đã index" : "Chưa index"}
        </span>
        {st.index.builtAt != null && (
          <span className="text-xs text-muted-foreground" title={new Date(st.index.builtAt).toLocaleString()}>
            build {agoVi(st.index.builtAt, now || st.index.builtAt)}
          </span>
        )}
        {totals && (
          <span className="text-xs text-muted-foreground tabular">
            {n(totals.files)} file · {n(totals.symbols)} symbol · {n(totals.edges)} liên kết
            {totals.languages.length > 0 && <span className="max-sm:hidden"> · {totals.languages.join(", ")}</span>}
          </span>
        )}
        <Button type="button" size="sm" variant={st.index.indexed ? "outline" : "default"} className="ml-auto max-sm:h-10" disabled={running || !st.trail} onClick={onBuild}>
          {running ? <LoaderIcon className="animate-spin motion-reduce:animate-none" /> : <HammerIcon />}
          {running ? "Đang index…" : "Index ngay"}
        </Button>
      </div>
      {!st.trail && <p className="text-xs text-destructive">Không tìm thấy lệnh trail trên máy chạy HQ, nên chưa index được.</p>}
      {!st.index.indexed && st.trail && !running && <p className="text-sm text-muted-foreground">Dự án chưa có code map trong .trail/cache. Bấm Index ngay để trail đọc repo (không gọi model, thường vài giây đến vài phút).</p>}
      {running && (
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-label="Tiến độ index"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className={cn("h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none", pct == null && "w-1/4 animate-pulse")} style={pct != null ? { width: `${pct}%` } : undefined} />
          </div>
          <p className="text-xs text-muted-foreground tabular" aria-live="polite">
            {b.progress ? `Đọc file ${n(b.progress.done)}/${n(b.progress.total)}` : "Đang bắt đầu…"}
          </p>
        </div>
      )}
      {b && !running && (
        <div className={cn("rounded-lg border px-3 py-2 text-xs", b.state === "failed" ? "border-destructive/30 bg-destructive/5" : "bg-muted/40")} aria-live="polite">
          <p className="font-medium">
            {b.state === "failed" ? `Index lỗi: ${b.error}` : `Index xong ${agoVi(b.endedAt, now || b.endedAt || 0)}`}
            {b.endedAt != null && <span className="font-normal text-muted-foreground"> · mất {Math.max(1, Math.round((b.endedAt - b.startedAt) / 1000))} s</span>}
          </p>
          {b.tail && <pre className="mt-1 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{b.tail}</pre>}
        </div>
      )}
    </section>
  );
}

/** `trail ask` (plain words, ranked) or `trail grep` (regex, every line), hits with file:line. */
function SearchBox({ api, project, onOpen }: { api: Api; project: number; onOpen: (file: string, line: number | null) => void }) {
  const [mode, setMode] = useState<SearchMode>("ask");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ result: SearchResult | null; error: string | null; q: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await api<SearchResult>(`/api/codemap/search?project=${project}&mode=${mode}&q=${encodeURIComponent(text)}`);
      setRes({ result: r, error: null, q: text });
    } catch (err) {
      setRes({ result: null, error: (err as Error).message, q: text });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Tìm trong code" className="space-y-2">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Cách tìm" className="inline-flex rounded-lg border p-0.5">
          {(
            [
              ["ask", "Hỏi"],
              ["grep", "Grep"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-checked:bg-muted aria-checked:text-foreground motion-reduce:transition-none max-sm:py-2"
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={QUERY_MAX}
          placeholder={mode === "ask" ? "Hỏi bằng lời: chỗ nào xử lý đăng nhập?" : "Mẫu regex: childEnv|binFor"}
          aria-label={mode === "ask" ? "Câu hỏi cho trail ask" : "Mẫu cho trail grep"}
          className={cn("h-8 min-w-48 flex-1 text-sm max-sm:h-10", mode === "grep" && "font-mono")}
        />
        <Button type="submit" size="sm" disabled={busy || !q.trim()} className="max-sm:h-10">
          {busy ? <LoaderIcon className="animate-spin motion-reduce:animate-none" /> : <SearchIcon />}
          Tìm
        </Button>
      </form>
      {res?.error && <Problem text={res.error} />}
      {res?.result && (
        <div className="rounded-lg border">
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground tabular">
            {res.result.hits.length === 0
              ? `Không có kết quả cho «${res.q}»`
              : res.result.mode === "grep" && res.result.total > res.result.hits.length
                ? `${n(res.result.hits.length)} / ${n(res.result.total)} dòng khớp «${res.q}»`
                : `${n(res.result.hits.length)} kết quả cho «${res.q}»`}
          </p>
          {res.result.hits.length > 0 && (
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {res.result.hits.map((h, i) => (
                <li key={`${h.file}:${h.line}:${i}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(h.file, h.line)}
                    className="block w-full min-w-0 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium">{h.title}</span>
                      {h.kind && <span className="shrink-0 text-[11px] text-muted-foreground">{h.kind}</span>}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {h.file}
                      {h.line != null && `:${h.line}`}
                    </span>
                    {h.text && <code className="mt-0.5 block truncate font-mono text-xs text-foreground/80">{h.text.trim()}</code>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Modules (trail scopes) → folders and files with their symbol counts and hubs; then the repo's hotspots. */
function MapTree({ map, onOpen }: { map: CodeMap; onOpen: (file: string, line: number | null) => void }) {
  if (!map.scopes.length) return <p className="text-sm text-muted-foreground">trail chưa thấy file code nào trong dự án này.</p>;
  return (
    <section aria-label="Bản đồ module" className="space-y-3">
      {map.scopes.map((s, i) => (
        <details key={s.scope} open={i < 3} className="group rounded-lg border">
          <summary className="flex cursor-pointer list-none items-baseline gap-2 rounded-lg px-3 py-2 outline-none select-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-[10px] text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none">
              ▶
            </span>
            <span className="min-w-0 truncate font-mono text-[13px] font-semibold">{s.scope}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">
              {n(s.files)} file · {n(s.symbols)} symbol
            </span>
          </summary>
          <ul className="divide-y border-t">
            {s.entries.map((e) => {
              const Icon = e.isFile ? FileCodeIcon : FolderIcon;
              const name = (
                <>
                  <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-mono text-xs">{e.label}</span>
                </>
              );
              return (
                <li key={e.path} className="px-3 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    {e.isFile ? (
                      <button type="button" onClick={() => onOpen(e.path, null)} className="flex min-w-0 items-center gap-1.5 rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60" title={`Xem khung ${e.path}`}>
                        {name}
                      </button>
                    ) : (
                      <span className="flex min-w-0 items-center gap-1.5" title={e.path}>
                        {name}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular">
                      {e.isFile ? "" : `${n(e.files)} file · `}
                      {n(e.symbols)} symbol
                    </span>
                  </div>
                  {e.hubs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-5">
                      {e.hubs.map((h) => (
                        <HubChip key={`${h.path}:${h.name}:${h.line}`} h={h} onOpen={onOpen} />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {s.dropped > 0 && <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">+{n(s.dropped)} mục nhỏ hơn không liệt kê</p>}
        </details>
      ))}
      {map.hotspots.length > 0 && (
        <div className="rounded-lg border px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <FlameIcon aria-hidden className="size-3.5 text-muted-foreground" />
            Điểm nóng: symbol được gọi nhiều nhất
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {map.hotspots.slice(0, HOTSPOTS_SHOWN).map((h) => (
              <HubChip key={`${h.path}:${h.name}:${h.line}`} h={h} onOpen={onOpen} withFile />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function HubChip({ h, onOpen, withFile = false }: { h: MapHub; onOpen: (file: string, line: number | null) => void; withFile?: boolean }) {
  const base = h.path.split("/").pop() ?? h.path;
  return (
    <button
      type="button"
      onClick={() => onOpen(h.path, h.line)}
      title={`${h.kind} ${h.name} · ${h.path}${h.line != null ? `:${h.line}` : ""} · ${h.inDegree} nơi gọi`}
      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/30 px-1.5 py-0.5 font-mono text-[11px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:py-1.5"
    >
      <span className="truncate">{h.name}</span>
      {withFile && <span className="truncate text-muted-foreground">{base}</span>}
      <span className="shrink-0 text-muted-foreground tabular" aria-label={`${h.inDegree} nơi gọi`}>
        {h.inDegree}←
      </span>
    </button>
  );
}

/** `trail skeleton <file>`: the file's signatures, the line the owner came from marked. */
function SkeletonPanel({ api, project, file, line, onClose }: { api: Api; project: number; file: string; line: number | null; onClose: () => void }) {
  const [st, setSt] = useState<Loaded<Skeleton> | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api<{ skeleton: Skeleton }>(`/api/codemap/skeleton?project=${project}&file=${encodeURIComponent(file)}`, { signal: ac.signal }).then(
      (r) => setSt({ key: file, data: r.skeleton, error: null }),
      (e: Error) => {
        if (!ac.signal.aborted) setSt({ key: file, data: null, error: e.message });
      },
    );
    return () => ac.abort();
  }, [api, project, file]);
  // The entry that holds the line the owner came from (the last one starting at or before it).
  const at = line != null && st?.data ? st.data.entries.reduce<number | null>((best, e, i) => (e.line != null && e.line <= line ? i : best), null) : null;
  return (
    <article aria-label={`Khung ${file}`} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <Button type="button" variant="ghost" size="icon-sm" className="-ml-1.5 shrink-0 lg:hidden max-sm:size-10" onClick={onClose} aria-label="Về bản đồ">
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold">Khung file</h3>
          <code className="block truncate font-mono text-[11px] text-muted-foreground" title={file}>
            {file}
            {line != null && `:${line}`}
          </code>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" className="max-lg:hidden" onClick={onClose} aria-label="Đóng khung file">
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!st ? (
          <div className="space-y-2" aria-busy="true" aria-label="Đang đọc khung file">
            <Bone className="h-4 w-3/4" />
            <Bone className="h-4 w-2/3" />
            <Bone className="h-4 w-4/5" />
          </div>
        ) : st.error ? (
          <Problem text={st.error} />
        ) : st.data && st.data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{st.data.note ?? "trail không thấy định nghĩa nào trong file này."}</p>
        ) : (
          <ol className="space-y-0.5">
            {st.data?.entries.map((e, i) => (
              <li key={`${e.name}:${e.line}:${i}`} className={cn("rounded-md px-2 py-1", i === at && "bg-primary/10 ring-1 ring-primary/30")}>
                <span className="flex items-baseline gap-2 text-[11px] text-muted-foreground tabular">
                  <span>{e.kind}</span>
                  {e.line != null && <span>dòng {e.line}</span>}
                </span>
                <code className="block font-mono text-xs break-words whitespace-pre-wrap">{e.signature}</code>
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}

/** graphify-out/ of the repo: a link to its graph.html when graphify wrote one. */
function GraphNote({ st, now, onOpen }: { st: CodemapStatus; now: number; onOpen: () => void }) {
  const h = st.graph.html;
  return (
    <section aria-label="Đồ thị graphify" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2">
      <NetworkIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium">Đồ thị graphify</span>
      {h ? (
        <>
          <span className="text-xs text-muted-foreground tabular">
            graph.html · {bytes(h.size)} · {agoVi(h.mtime, now || h.mtime)}
          </span>
          <Button type="button" size="sm" variant="outline" className="ml-auto max-sm:h-10" onClick={onOpen}>
            Xem đồ thị
          </Button>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">graphify-out/ có nhưng chưa có graph.html để xem.</span>
      )}
    </section>
  );
}

/** graph.html in a sandboxed srcdoc frame under GRAPH_CSP: its scripts run in an opaque origin, never as HQ. */
function GraphFrame({ token, project, name, onClose }: { token: string; project: number; name: string; onClose: () => void }) {
  const [st, setSt] = useState<{ html: string | null; error: string | null } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/codemap/graph?project=${project}`, { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const body: unknown = await r.json().catch(() => null);
          throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `HTTP ${r.status}`);
        }
        setSt({ html: graphSrcDoc(await r.text()), error: null });
      })
      .catch((e: Error) => {
        if (!ac.signal.aborted) setSt({ html: null, error: e.message });
      });
    return () => ac.abort();
  }, [token, project]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 sm:px-6">
        <Button type="button" variant="ghost" size="sm" className="-ml-2 max-sm:h-10" onClick={onClose}>
          <ArrowLeftIcon /> Về bản đồ
        </Button>
        <span className="min-w-0 truncate text-xs text-muted-foreground">graphify-out/graph.html · {name}</span>
        <span className="ml-auto shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">Nội dung từ repo: không nhập key vào đây</span>
      </div>
      <div className="min-h-0 flex-1 p-2 sm:p-3">
        {!st ? (
          <Bone className="h-full w-full" />
        ) : st.error ? (
          <Problem text={st.error} />
        ) : (
          <iframe srcDoc={st.html ?? ""} sandbox="allow-scripts" referrerPolicy="no-referrer" title={`Đồ thị graphify của ${name}`} className="h-full w-full rounded-lg border bg-white" />
        )}
      </div>
    </div>
  );
}
