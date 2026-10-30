"use client";

import { ChevronLeftIcon, ChevronRightIcon, GitBranchIcon, GitCommitHorizontalIcon, ImageIcon, ImageOffIcon, MessageSquarePlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { agoShort, agoVi } from "@/lib/now";
import { fileName, isVideo, type PreviewItem, type ProjectPreviews } from "@/lib/preview";
import { entryFor, useFollowRepo } from "@/lib/follow-repo";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { AskImage } from "./ask-image";
import { PlayButton } from "./play-view";
import { makeApi, type Api } from "./use-hq";
import type { Room } from "./use-office";
import { previewFileUrl, useAuthedImage, useNearView } from "./use-poll";

export type PreviewState = { data: { projects: ProjectPreviews[] } | null; error: string | null; at: number; reload: () => void };

/**
 * Where the project really is: every screenshot and demo video the rooms saved, newest first. Times
 * are commit times (a checkout never moves an old shot to the top); the lightbox walks the list.
 */
export function PreviewView({
  state,
  token,
  rooms,
  repo = null,
}: {
  state: PreviewState;
  token: string;
  /** Office rooms: who "Hỏi về ảnh này" can send to. */
  rooms: Room[];
  /** The repo picked in the sidebar: the picker follows it. */
  repo?: string | null;
}) {
  const [pick, setPick] = useState<string | null>(repo);
  useFollowRepo(repo, setPick);
  /** The open image. */
  const [view, setView] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const api = useMemo(() => makeApi(token), [token]);
  const list = useMemo(() => [...(state.data?.projects ?? [])].sort((a, b) => (b.items[0]?.at ?? 0) - (a.items[0]?.at ?? 0)), [state.data]);
  const cur = (pick ? entryFor(list, pick) : undefined) ?? list[0];
  // The poll clock: relative times move with each answer, never with a render.
  const now = state.at;
  const items = useMemo(() => [...(cur?.items ?? [])].sort((a, b) => b.at - a.at), [cur]);

  if (state.error && !state.data) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="ảnh preview" error={state.error} onRetry={state.reload} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 sm:px-6">
        {list.length > 1 ? (
          <Select value={cur?.root ?? ""} onValueChange={setPick}>
            <SelectTrigger size="sm" className="max-w-64 text-xs" aria-label="Dự án">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map((p) => (
                <SelectItem key={p.root} value={p.root} className="text-xs">
                  {p.name}
                  <span className="text-muted-foreground tabular"> · {p.items.length} ảnh</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : cur ? (
          <span className="text-sm font-medium">{cur.name}</span>
        ) : state.data ? null : (
          <Skeleton className="h-4 w-32" />
        )}
        <div className="ml-auto flex items-center gap-2">
          {cur && <PlayButton key={cur.root} root={cur.root} name={cur.name} token={token} />}
          <Button type="button" variant="ghost" size="icon-sm" onClick={state.reload} aria-label="Tải lại ảnh">
            <RefreshCwIcon />
          </Button>
        </div>
        {cur?.main && (
          <p className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular">
            <span className="inline-flex items-center gap-1" title={`${cur.main.ref} · ${cur.main.subject} · ${agoVi(cur.main.at, now)}`}>
              <GitCommitHorizontalIcon aria-hidden className="size-3.5" />
              main <code className="font-mono text-foreground">{cur.main.sha.slice(0, 7)}</code>
              <span>{agoShort(cur.main.at, now)}</span>
            </span>
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!state.data ? (
          <RowsSkeleton />
        ) : !cur ? (
          <PreviewEmpty title="Chưa có phòng nào đang chạy" />
        ) : items.length === 0 ? (
          <PreviewEmpty title={`${cur.name} chưa có ảnh chụp nào`} />
        ) : (
          <ul aria-label="Ảnh, mới nhất trước" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-3 px-4 py-4 sm:px-6">
            {items.map((i) => (
              <li key={i.id}>
                <Thumb item={i} token={token} now={now} onOpen={() => setView(i.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Viewer
        items={items}
        id={view}
        token={token}
        now={now}
        onId={(id) => {
          setView(id);
          if (!id) setAsk(false);
        }}
        ask={ask}
        onAsk={setAsk}
        api={api}
        rooms={rooms}
      />
    </div>
  );
}

/** The file's path as the OS writes it (a Windows root keeps its backslashes); a main-tree image as `ref:path`. */
const fullPath = (i: PreviewItem) => {
  if (i.ref) return `${i.ref}:${i.rel}`;
  const sep = i.root.includes("\\") ? "\\" : "/";
  return `${i.root.replace(/[\\/]+$/, "")}${sep}${i.rel.split("/").join(sep)}`;
};

/** "commit 3 giờ trước" / "tệp chưa commit, 2 phút trước": which clock `at` is. */
const timeLabel = (i: PreviewItem, now: number) => (i.timeFrom === "commit" ? `commit ${agoVi(i.at, now)}` : `tệp chưa commit, ${agoVi(i.at, now)}`);

function PreviewEmpty({ title }: { title: string }) {
  return (
    <EmptyState icon={<ImageIcon />} title={title} className="max-w-md">
      <p>
        Phòng lưu ảnh chụp vào <code className="font-mono text-foreground">qa/evidence/&lt;mô tả&gt;.png</code>, ảnh hiện ở đây, mới nhất trước.
      </p>
      <p className="mt-2">Chụp một trang:</p>
      <code className="mt-1 block rounded-md bg-muted px-2 py-1.5 text-left font-mono text-xs break-all text-foreground">8sync shot &lt;url&gt; -o qa/evidence/home.png</code>
      <p className="mt-2 text-xs">
        HQ cũng đọc <code className="font-mono">evidence/</code>, <code className="font-mono">screenshots/</code>, <code className="font-mono">su-code/shots/</code>,{" "}
        <code className="font-mono">docs/screenshots/</code> ở gốc dự án, mỗi worktree và nhánh main.
      </p>
    </EmptyState>
  );
}

function RowsSkeleton() {
  return (
    <ul aria-label="Đang tải ảnh" className="divide-y px-4 py-4 sm:px-6">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="grid gap-x-5 gap-y-2.5 py-3 sm:grid-cols-[minmax(0,1fr)_25.5rem]">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }, (_, k) => (
              <Skeleton key={k} className="aspect-[16/10] w-full rounded-md" />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The image itself on a neutral surface; fetched with the token only once it scrolls near view. */
export function PreviewImage({ id, token, alt, className, eager, video = false }: { id: string; token: string; alt: string; className?: string; eager?: boolean; video?: boolean }) {
  const [ref, near] = useNearView<HTMLDivElement>();
  const { src, failed } = useAuthedImage(token, previewFileUrl(id), eager || near);
  return (
    <div ref={ref} className={cn("relative grid place-items-center overflow-hidden bg-muted", className)}>
      {src ? (
        video ? (
          // A demo recording: the first frame in a list, playable with controls when opened.
          <video src={src} className="absolute inset-0 size-full object-contain" muted={!eager} controls={eager} playsInline preload="metadata" aria-label={alt || "video demo"} />
        ) : (
          // An object URL from an authed fetch: next/image cannot load it, a plain img is right here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="absolute inset-0 size-full object-contain" draggable={false} />
        )
      ) : failed ? (
        <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <ImageOffIcon aria-hidden className="size-4" />
          Không mở được ảnh
        </span>
      ) : (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
    </div>
  );
}

/** A fixed 16:10 box (no layout shift while it loads), its name and true time under it. */
function Thumb({ item, token, now, onOpen }: { item: PreviewItem; token: string; now: number; onOpen: () => void }) {
  const name = fileName(item.rel);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${name}, ${timeLabel(item, now)}`}
      title={`${name} · ${timeLabel(item, now)}`}
      className="group block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <PreviewImage
        id={item.id}
        token={token}
        alt=""
        video={isVideo(item.rel)}
        className="aspect-[16/10] w-full rounded-md border transition-[border-color] duration-150 group-hover:border-foreground/25 motion-reduce:transition-none"
      />
      <span className="mt-1.5 block truncate text-[13px] font-medium">{name}</span>
      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        <span className="shrink-0 tabular">{agoShort(item.at, now)}</span>
        {item.timeFrom === "file" && <span className="truncate">chưa commit</span>}
      </span>
    </button>
  );
}

/** Where the bytes come from: the main tree, a worktree (and its branch) or the project root. */
function SourceChip({ item }: { item: PreviewItem }) {
  // The checkout itself (a worktree folder, the root) or the ref; the branch sits in the tooltip.
  const label = item.ref ?? (item.worktree ? `worktree ${item.worktree}` : "gốc dự án");
  const title = item.ref
    ? `nhánh ${item.ref} (không checkout nào có ảnh này)`
    : item.worktree
      ? `worktree ${item.worktree}${item.branch ? ` · nhánh ${item.branch}` : ""}`
      : `gốc dự án${item.branch ? ` · nhánh ${item.branch}` : ""}`;
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5 rounded-md bg-muted px-1.5 py-px font-mono text-[11px] text-foreground" title={title}>
      <GitBranchIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Swipe on the big image: left/right walks, down closes. Touch and pen only; a mouse drags nothing. */
function useSwipe(onMove: (d: number) => void, onClose: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== "mouse") start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) onMove(dx < 0 ? 1 : -1);
      else if (dy > 80 && dy > Math.abs(dx)) onClose();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

/** Full-size view of the images: prev/next (buttons, ← →, swipe), name, true time, source, "Hỏi về ảnh này". */
function Viewer({
  items,
  id,
  token,
  now,
  onId,
  ask,
  onAsk,
  api,
  rooms,
}: {
  items: PreviewItem[];
  id: string | null;
  token: string;
  now: number;
  onId: (id: string | null) => void;
  /** Pins + composer instead of prev/next. */
  ask: boolean;
  onAsk: (on: boolean) => void;
  api: Api;
  rooms: Room[];
}) {
  const i = id ? items.findIndex((x) => x.id === id) : -1;
  const item = i >= 0 ? items[i] : null;
  const go = (d: number) => {
    if (i < 0 || !items.length) return;
    onId(items[(i + d + items.length) % items.length].id);
  };
  const swipe = useSwipe(go, () => onId(null));
  useEffect(() => {
    // While asking, arrows belong to the pins and the text boxes.
    if (!item || ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <Dialog open={item != null} onOpenChange={(o) => !o && onId(null)}>
      <DialogContent
        className={cn(
          "grid max-h-[94dvh] w-[min(96vw,1400px)] max-w-none gap-3 p-4 sm:max-w-none sm:p-5",
          ask
            ? // Phones: a bottom sheet that scrolls as one; large screens: image left, pins and composer right.
              "grid-rows-[auto_auto_minmax(0,1fr)] max-lg:h-[94dvh] max-lg:grid-rows-none max-lg:content-start max-lg:overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:h-[96dvh] max-sm:max-h-[96dvh] max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:overscroll-contain max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
            : "grid-rows-[auto_minmax(0,1fr)_auto] max-sm:w-full max-sm:p-3",
        )}
      >
        {item && ask && (
          <>
            <div className="flex min-w-0 items-center gap-2 pr-10">
              <DialogTitle className="min-w-0 truncate text-base font-semibold">Hỏi về {fileName(item.rel)}</DialogTitle>
              <Button type="button" size="sm" variant="ghost" className="ml-auto shrink-0 max-sm:h-11" onClick={() => onAsk(false)}>
                <XIcon /> Thôi hỏi
              </Button>
            </div>
            <DialogDescription asChild>
              <code className="min-w-0 font-mono text-xs break-all text-muted-foreground">{fullPath(item)}</code>
            </DialogDescription>
            <AskImage key={item.id} item={item} path={fullPath(item)} token={token} api={api} rooms={rooms} onDone={() => onAsk(false)} />
          </>
        )}
        {item && !ask && (
          <>
            <div className="min-w-0 space-y-1 pr-10">
              <DialogTitle className="min-w-0 truncate text-base font-semibold">{fileName(item.rel)}</DialogTitle>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {items.length > 1 && (
                  <span className="tabular">
                    {i + 1}/{items.length}
                  </span>
                )}
                <span className="tabular" title={new Date(item.at).toLocaleString()}>
                  {timeLabel(item, now)}
                </span>
                <SourceChip item={item} />
              </div>
            </div>
            <div className="relative min-h-0 touch-none select-none" {...swipe}>
              <PreviewImage key={item.id} id={item.id} token={token} alt={item.rel} eager video={isVideo(item.rel)} className="h-[min(72dvh,900px)] w-full rounded-lg max-sm:h-[min(52dvh,900px)]" />
              {items.length > 1 && (
                <>
                  <Button type="button" size="icon" variant="secondary" className="absolute top-1/2 left-2 -translate-y-1/2 shadow-sm max-sm:size-11" onClick={() => go(-1)} aria-label="Ảnh trước (←)">
                    <ChevronLeftIcon />
                  </Button>
                  <Button type="button" size="icon" variant="secondary" className="absolute top-1/2 right-2 -translate-y-1/2 shadow-sm max-sm:size-11" onClick={() => go(1)} aria-label="Ảnh sau (→)">
                    <ChevronRightIcon />
                  </Button>
                </>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <DialogDescription asChild>
                <code className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground max-sm:basis-full">{fullPath(item)}</code>
              </DialogDescription>
              <Button type="button" size="sm" className="max-sm:h-11" onClick={() => onAsk(true)}>
                <MessageSquarePlusIcon /> Hỏi về ảnh này
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
