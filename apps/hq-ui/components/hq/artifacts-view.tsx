"use client";

import { ArrowLeftIcon, DownloadIcon, FileIcon, FileTextIcon, FilmIcon, GlobeIcon, ImageIcon, InboxIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { KIND_LABEL, TEXT_INLINE_MAX, artifactFileUrl, baseName, groupArtifacts, type Artifact, type ArtifactKind } from "@/lib/artifacts";
import { bytes } from "@/lib/disk";
import { useFollowRepo } from "@/lib/follow-repo";
import { agoShort, agoVi } from "@/lib/now";
import { rootKey } from "@/lib/preview";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { makeApi } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 15_000;
const ALL = "__all";

const KIND_ICON: Record<ArtifactKind, typeof FileIcon> = {
  image: ImageIcon,
  video: FilmIcon,
  pdf: FileTextIcon,
  html: GlobeIcon,
  markdown: FileTextIcon,
  text: FileIcon,
};

/** Kinds read as text: shown in a `<pre>` (HTML in a sandboxed srcdoc frame), offered as a download past TEXT_INLINE_MAX. */
const TEXT_KINDS: Record<ArtifactKind, boolean> = { image: false, video: false, pdf: false, html: true, markdown: true, text: true };

/**
 * "Kết quả" tab: the files rooms registered for the owner (POST /api/artifacts), newest first, one
 * block per project. A row opens the file beside the list (over it on a phone); removing one only
 * takes it off the list, the file on disk stays.
 */
export function ArtifactsView({ token, active, repo = null }: { token: string; active: boolean; repo?: string | null }) {
  const api = useMemo(() => makeApi(token), [token]);
  const list = usePoll<{ artifacts: Artifact[]; at: number }>(api, "/api/artifacts", POLL_MS, active);
  const [pick, setPick] = useState(ALL);
  useFollowRepo(repo, (r) => setPick(rootKey(r)));
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => groupArtifacts(list.data?.artifacts ?? []), [list.data]);
  // The sidebar's repo with nothing registered yet: show every project rather than an empty pick.
  const cur = groups.some((g) => g.key === pick) ? pick : ALL;
  const shown = cur === ALL ? groups : groups.filter((g) => g.key === cur);
  const open = list.data?.artifacts.find((a) => a.id === openId) ?? null;
  const now = list.at;
  const { reload } = list;
  const remove = useCallback(
    async (a: Artifact) => {
      if (!window.confirm(`Bỏ «${a.title}» khỏi Kết quả? File trên máy vẫn giữ nguyên.`)) return;
      try {
        await api(`/api/artifacts/${a.id}`, { method: "DELETE" });
        setOpenId((id) => (id === a.id ? null : id));
        reload();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [api, reload],
  );

  if (list.error && !list.data) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="kết quả" error={list.error} onRetry={list.reload} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 sm:px-6">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <InboxIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Kết quả
          <span className="text-xs font-normal text-muted-foreground max-sm:hidden">file các phòng đăng cho anh xem</span>
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {groups.length > 1 && (
            <Select value={cur} onValueChange={setPick}>
              <SelectTrigger size="sm" className="max-w-64 text-xs" aria-label="Dự án">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-xs">
                  Tất cả dự án
                </SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.key} value={g.key} className="text-xs">
                    {g.project}
                    <span className="text-muted-foreground tabular"> · {g.items.length}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant="ghost" size="icon-sm" onClick={list.reload} aria-label="Tải lại kết quả">
            <RefreshCwIcon />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
        <div className={cn("min-h-0 overflow-y-auto lg:border-r", open && "max-lg:hidden")}>
          {!list.data ? (
            <ListSkeleton />
          ) : groups.length === 0 ? (
            <Empty />
          ) : (
            shown.map((g) => (
              <section key={g.key} aria-label={g.project}>
                {cur === ALL && (
                  <h3 className="sticky top-0 z-10 flex items-baseline gap-1.5 border-b bg-background/95 px-4 py-1.5 text-xs font-semibold backdrop-blur sm:px-6" title={g.root}>
                    {g.project}
                    <span className="font-normal text-muted-foreground tabular">{g.items.length}</span>
                  </h3>
                )}
                <ul className="divide-y">
                  {g.items.map((a) => (
                    <Row key={a.id} a={a} now={now} current={a.id === openId} onOpen={() => setOpenId(a.id)} onRemove={() => remove(a)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className={cn("min-h-0", !open && "max-lg:hidden")}>
          {open ? (
            <Viewer key={open.id} a={open} token={token} now={now} onClose={() => setOpenId(null)} onRemove={() => remove(open)} />
          ) : (
            list.data &&
            groups.length > 0 && <p className="grid h-full place-items-center px-6 text-sm text-muted-foreground">Chọn một kết quả để mở.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ a, now, current, onOpen, onRemove }: { a: Artifact; now: number; current: boolean; onOpen: () => void; onRemove: () => void }) {
  const Icon = KIND_ICON[a.kind];
  return (
    <li className={cn("group/row flex items-start gap-1 py-1 pr-2 pl-2 sm:pr-4 sm:pl-4", current ? "bg-muted" : "hover:bg-muted/50")}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={current || undefined}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", a.missing ? "text-muted-foreground/50" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13px] font-medium", a.missing && "text-muted-foreground line-through")}>{a.title}</span>
          {a.note && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.note}</span>}
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground tabular">
            <span>{KIND_LABEL[a.kind]}</span>
            {a.missing ? <span className="font-medium text-destructive">mất file</span> : a.size != null && <span>{bytes(a.size)}</span>}
            {a.branch && <span className="max-w-32 truncate font-mono">{a.branch}</span>}
            <span title={new Date(a.updated_at).toLocaleString()}>{agoShort(a.updated_at, now)}</span>
          </span>
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="mt-1 shrink-0 text-muted-foreground opacity-60 group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:size-10"
        onClick={onRemove}
        aria-label={`Bỏ ${a.title} khỏi Kết quả`}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

/** One artifact opened: its name, where it is, and the file itself. */
function Viewer({ a, token, now, onClose, onRemove }: { a: Artifact; token: string; now: number; onClose: () => void; onRemove: () => void }) {
  const save = async () => {
    try {
      const r = await fetch(artifactFileUrl(a.id, true), { headers: { "x-hq-token": token }, cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "file không còn mở được" : `HTTP ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = baseName(a.path);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error(`Tải ${a.title}: ${(e as Error).message}`);
    }
  };
  return (
    <article aria-label={a.title} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start gap-2 border-b px-4 py-2.5 sm:px-6">
        <Button type="button" variant="ghost" size="icon-sm" className="-ml-1.5 shrink-0 lg:hidden max-sm:size-10" onClick={onClose} aria-label="Về danh sách">
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="truncate text-sm font-semibold">{a.title}</h3>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular">
            <span>{a.project}</span>
            {a.branch && <span className="font-mono">{a.branch}</span>}
            <span>{KIND_LABEL[a.kind]}</span>
            {a.size != null && <span>{bytes(a.size)}</span>}
            <span title={new Date(a.updated_at).toLocaleString()}>đăng {agoVi(a.updated_at, now)}</span>
            {a.session && (
              <span className="max-w-40 truncate font-mono" title={`phòng ${a.session}`}>
                {a.session}
              </span>
            )}
          </p>
          {a.note && <p className="text-xs text-foreground/80">{a.note}</p>}
          <code className="block font-mono text-[11px] break-all text-muted-foreground">{a.path}</code>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!a.missing && (
            <Button type="button" variant="outline" size="sm" className="text-xs max-sm:h-10" onClick={save}>
              <DownloadIcon /> Tải về
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" className="max-sm:size-10" onClick={onRemove} aria-label={`Bỏ ${a.title} khỏi Kết quả`}>
            <Trash2Icon />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="max-lg:hidden" onClick={onClose} aria-label="Đóng">
            <XIcon />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <Body a={a} token={token} />
      </div>
    </article>
  );
}

type Loaded = { key: string; url: string | null; text: string | null; failed: boolean };

/** The file's bytes with the token: text for the text kinds, an object URL for the rest; refetched when the file changes. */
function useArtifactFile(token: string, a: Artifact, skip: boolean): Loaded | null {
  const asText = TEXT_KINDS[a.kind];
  const key = `${a.id}:${a.mtime ?? 0}:${a.updated_at}`;
  const [st, setSt] = useState<Loaded | null>(null);
  useEffect(() => {
    if (skip) return;
    const ac = new AbortController();
    let obj: string | null = null;
    fetch(artifactFileUrl(a.id), { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        if (asText) {
          setSt({ key, url: null, text: await r.text(), failed: false });
          return;
        }
        obj = URL.createObjectURL(await r.blob());
        setSt({ key, url: obj, text: null, failed: false });
      })
      .catch(() => {
        if (!ac.signal.aborted) setSt({ key, url: null, text: null, failed: true });
      });
    return () => {
      ac.abort();
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [token, a.id, key, asText, skip]);
  return st && st.key === key ? st : null;
}

function Body({ a, token }: { a: Artifact; token: string }) {
  const big = TEXT_KINDS[a.kind] && (a.size ?? 0) > TEXT_INLINE_MAX;
  const f = useArtifactFile(token, a, a.missing || big);
  if (a.missing) return <Note title="File không còn ở đường dẫn này">Phòng đã xoá hoặc dời nó. Bỏ khỏi danh sách, hoặc nhờ phòng đăng lại.</Note>;
  if (big) return <Note title="File chữ quá dài để xem ở đây">Bấm “Tải về” để mở bằng ứng dụng trên máy.</Note>;
  if (!f) return <Skeleton className="h-[min(70dvh,40rem)] w-full rounded-lg" />;
  if (f.failed) return <Note title="Không mở được file">HQ không đọc được nó lúc này (file đổi loại, quá cỡ hoặc ra ngoài dự án). Tải lại hoặc nhờ phòng đăng lại.</Note>;
  const frame = "h-[min(78dvh,60rem)] w-full rounded-lg border";
  switch (a.kind) {
    case "image":
      // An object URL from an authed fetch: next/image cannot load it. SVG as <img> runs no script.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={f.url ?? ""} alt={a.title} className="mx-auto max-h-[78dvh] max-w-full rounded-lg border bg-muted object-contain" />;
    case "video":
      return <video src={f.url ?? ""} controls playsInline preload="metadata" className="mx-auto max-h-[78dvh] max-w-full rounded-lg border bg-black" aria-label={a.title} />;
    case "pdf":
      // The browser's PDF viewer refuses a sandboxed frame; a PDF is not HTML and gets no HQ script access.
      return <iframe src={f.url ?? ""} title={a.title} className={frame} />;
    case "html":
      // srcdoc without allow-same-origin: the page runs in an opaque origin, never as HQ (no token, no cookies).
      return <iframe srcDoc={f.text ?? ""} sandbox="allow-scripts allow-popups" referrerPolicy="no-referrer" title={a.title} className={cn(frame, "bg-white")} />;
    default:
      return <pre className="min-h-full rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{f.text}</pre>;
  }
}

function Note({ title, children }: { title: string; children: string }) {
  return (
    <EmptyState icon={<FileIcon />} title={title} className="max-w-md">
      <p>{children}</p>
    </EmptyState>
  );
}

function Empty() {
  return (
    <EmptyState icon={<InboxIcon />} title="Chưa có kết quả nào" className="max-w-md">
      <p>Phòng làm xong một báo cáo, PDF, ảnh hay demo thì đăng nó lên đây; HQ giữ đường dẫn, file vẫn nằm trên máy.</p>
      <code className="mt-2 block rounded-md bg-muted px-2 py-1.5 text-left font-mono text-xs break-all text-foreground">
        node &lt;skill hq-control&gt;/scripts/hq.mjs artifact add &lt;file&gt; --title &quot;…&quot;
      </code>
    </EmptyState>
  );
}

function ListSkeleton() {
  return (
    <ul aria-label="Đang tải kết quả" className="divide-y">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="space-y-1.5 px-6 py-3">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </li>
      ))}
    </ul>
  );
}
