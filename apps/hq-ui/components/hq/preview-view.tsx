"use client";

import { ChevronLeftIcon, ChevronRightIcon, GitBranchIcon, ImageIcon, ImageOffIcon, KanbanSquareIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cardParts } from "@/lib/card-tags";
import { LANES, type LaneKey } from "@/lib/lanes";
import { agoShort, agoVi } from "@/lib/now";
import { fileName, groupByCard, rootKey, type PreviewItem, type ProjectPreviews } from "@/lib/preview";
import type { ProjectBoard } from "@/lib/server/board";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { LANE_VI, TONE_INK, laneTone } from "./card-sheet";
import { useAuthedImage, useNearView } from "./use-poll";

export type PreviewState = { data: { projects: ProjectPreviews[] } | null; error: string | null; at: number; reload: () => void };

/** What the board says about card #id in this project: its title and lane (or done/dropped), if known. */
export function cardInfo(boards: ProjectBoard[] | null, root: string, id: number): { title: string; lane: LaneKey | "done" | "dropped" } | null {
  const k = rootKey(root);
  for (const b of boards ?? []) {
    if (!b.board || (rootKey(b.root) !== k && (!b.filed || rootKey(b.filed) !== k))) continue;
    for (const l of LANES) {
      const c = b.board.lanes[l.key].find((x) => x.id === id);
      if (c) return { title: cardParts(c.text).title, lane: l.key };
    }
    const c = b.board.closed.find((x) => x.id === id);
    if (c) return { title: cardParts(c.text).title, lane: c.state };
  }
  return null;
}

/** Screenshots rooms saved while they work, grouped by the card they belong to. */
export function PreviewView({
  state,
  boards,
  token,
  onOpenCard,
}: {
  state: PreviewState;
  boards: ProjectBoard[] | null;
  token: string;
  onOpenCard: (root: string, id: number) => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  const list = useMemo(() => [...(state.data?.projects ?? [])].sort((a, b) => (b.items[0]?.mtime ?? 0) - (a.items[0]?.mtime ?? 0)), [state.data]);
  const cur = list.find((p) => p.root === pick) ?? list[0];
  const groups = useMemo(() => groupByCard(cur?.items ?? []), [cur]);
  // Viewer order = screen order: group by group, newest first.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // The poll clock: relative times move with each answer, never with a render.
  const now = state.at;

  if (state.error && !state.data) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="ảnh preview" error={state.error} onRetry={state.reload} />
      </div>
    );
  }

  const total = cur?.items.length ?? 0;
  const cards = groups.filter((g) => g.card != null).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 sm:px-6">
        {list.length > 1 ? (
          <Select value={cur?.root ?? ""} onValueChange={setPick}>
            <SelectTrigger size="sm" className="max-w-64 text-xs" aria-label="Dự án">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map((p) => (
                <SelectItem key={p.root} value={p.root} className="text-xs">
                  {p.name}
                  <span className="text-muted-foreground tabular"> · {p.items.length}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : cur ? (
          <span className="text-sm font-medium">{cur.name}</span>
        ) : state.data ? null : (
          <Skeleton className="h-4 w-32" />
        )}
        {cur && (
          <span className="text-xs text-muted-foreground tabular">
            {total ? `${total} ảnh · ${cards} card${groups.some((g) => g.card == null) ? " · có ảnh chưa gắn card" : ""}` : "chưa có ảnh"}
            {cur.items[0] && ` · mới nhất ${agoVi(cur.items[0].mtime, now)}`}
          </span>
        )}
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" onClick={state.reload} aria-label="Tải lại ảnh">
          <RefreshCwIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!state.data ? (
          <ThumbGridSkeleton />
        ) : !cur ? (
          <PreviewEmpty title="Chưa có phòng nào đang chạy" />
        ) : total === 0 ? (
          <PreviewEmpty title={`${cur.name} chưa có ảnh chụp nào`} />
        ) : (
          <div className="space-y-6 px-4 py-4 sm:px-6">
            {groups.map((g) => {
              const info = g.card != null ? cardInfo(boards, cur.root, g.card) : null;
              return (
                <section key={g.card ?? "none"} aria-labelledby={`pv-${g.card ?? "none"}`} className="space-y-2.5">
                  <h2 id={`pv-${g.card ?? "none"}`} className="flex min-w-0 items-baseline gap-x-2 text-sm">
                    {g.card != null ? (
                      <>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">#{g.card}</span>
                        <span className="min-w-0 truncate font-semibold" title={info?.title}>
                          {info?.title ?? "Card không còn trên board"}
                        </span>
                        {info && (
                          <span className="shrink-0">
                            <LaneChip lane={info.lane} />
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="font-semibold">Không gắn card</span>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      {g.items.length} ảnh · {agoShort(g.at, now)}
                    </span>
                    {g.card != null && info && isOpenLane(info.lane) && (
                      <Button type="button" variant="link" size="sm" className="h-auto shrink-0 p-0 text-xs" onClick={() => onOpenCard(cur.root, g.card!)}>
                        Mở card
                      </Button>
                    )}
                  </h2>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-3">
                    {g.items.map((i) => (
                      <li key={i.id}>
                        <Thumb item={i} token={token} now={now} onOpen={() => setView(i.id)} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Viewer
        items={flat}
        id={view}
        token={token}
        now={now}
        onId={setView}
        cardInfo={(id) => (cur ? cardInfo(boards, cur.root, id) : null)}
        onOpenCard={(id) => {
          if (!cur) return;
          setView(null);
          onOpenCard(cur.root, id);
        }}
      />
    </div>
  );
}

/** The file's path as the OS writes it (a Windows root keeps its backslashes). */
const fullPath = (i: PreviewItem) => {
  const sep = i.root.includes("\\") ? "\\" : "/";
  return `${i.root.replace(/[\\/]+$/, "")}${sep}${i.rel.split("/").join(sep)}`;
};

const isOpenLane = (l: LaneKey | "done" | "dropped"): l is LaneKey => l !== "done" && l !== "dropped";

export function LaneChip({ lane }: { lane: LaneKey | "done" | "dropped" }) {
  if (lane === "done" || lane === "dropped") {
    return <span className="rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">{lane === "done" ? "Xong" : "Bỏ"}</span>;
  }
  return (
    <span style={laneTone(lane)} className={cn("inline-flex items-center gap-1 rounded-md bg-[color-mix(in_oklch,var(--tone)_14%,transparent)] px-1.5 py-px text-[11px] font-medium", TONE_INK)}>
      <span aria-hidden className="size-1.5 rounded-full bg-(--tone)" />
      {LANE_VI[lane]}
    </span>
  );
}

function PreviewEmpty({ title }: { title: string }) {
  return (
    <EmptyState icon={<ImageIcon />} title={title} className="max-w-md">
      <p>
        Phòng qa/ui lưu ảnh chụp vào <code className="font-mono text-foreground">qa/evidence/card-&lt;số&gt;-&lt;mô tả&gt;.png</code>, ảnh hiện ở đây theo card.
      </p>
      <p className="mt-2">Chụp một trang:</p>
      <code className="mt-1 block rounded-md bg-muted px-2 py-1.5 text-left font-mono text-xs break-all text-foreground">8sync shot &lt;url&gt; -o qa/evidence/card-7-home.png</code>
      <p className="mt-2 text-xs">
        HQ cũng đọc <code className="font-mono">evidence/</code>, <code className="font-mono">screenshots/</code>, <code className="font-mono">su-code/shots/</code>,{" "}
        <code className="font-mono">docs/screenshots/</code> ở gốc dự án và mỗi worktree.
      </p>
    </EmptyState>
  );
}

export function ThumbGridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <ul aria-label="Đang tải ảnh" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-3 px-4 py-4 sm:px-6">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="space-y-1.5">
          <Skeleton className="aspect-[16/10] w-full rounded-lg" />
          <Skeleton className="h-3 w-2/3" />
        </li>
      ))}
    </ul>
  );
}

/** The image itself on a neutral surface; fetched with the token only once it scrolls near view. */
export function PreviewImage({ id, token, alt, className, eager }: { id: string; token: string; alt: string; className?: string; eager?: boolean }) {
  const [ref, near] = useNearView<HTMLDivElement>();
  const { src, failed } = useAuthedImage(token, id, eager || near);
  return (
    <div ref={ref} className={cn("relative grid place-items-center overflow-hidden bg-muted", className)}>
      {src ? (
        // An object URL from an authed fetch: next/image cannot load it, a plain img is right here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="absolute inset-0 size-full object-contain" draggable={false} />
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

function Thumb({ item, token, now, onOpen }: { item: PreviewItem; token: string; now: number; onOpen: () => void }) {
  const name = fileName(item.rel);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="group block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <PreviewImage
        id={item.id}
        token={token}
        alt={name}
        className="aspect-[16/10] w-full rounded-lg border transition-[border-color] duration-150 group-hover:border-foreground/25 motion-reduce:transition-none"
      />
      <span className="mt-1.5 block truncate text-[13px] font-medium" title={item.rel}>
        {name}
      </span>
      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="shrink-0 tabular">{agoVi(item.mtime, now)}</span>
        {(item.worktree || item.branch) && <BranchChip item={item} />}
      </span>
    </button>
  );
}

function BranchChip({ item }: { item: PreviewItem }) {
  const label = item.branch ?? item.worktree;
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5 rounded-md bg-muted px-1.5 py-px font-mono text-[11px] text-foreground" title={item.worktree ? `worktree ${item.worktree}${item.branch ? ` · nhánh ${item.branch}` : ""}` : `nhánh ${item.branch}`}>
      <GitBranchIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Large view with prev/next (buttons and ← →), the full path and a link to the card. */
function Viewer({
  items,
  id,
  token,
  now,
  onId,
  cardInfo: infoOf,
  onOpenCard,
}: {
  items: PreviewItem[];
  id: string | null;
  token: string;
  now: number;
  onId: (id: string | null) => void;
  cardInfo: (id: number) => ReturnType<typeof cardInfo>;
  onOpenCard: (id: number) => void;
}) {
  const i = id ? items.findIndex((x) => x.id === id) : -1;
  const item = i >= 0 ? items[i] : null;
  const go = (d: number) => {
    if (i < 0 || !items.length) return;
    onId(items[(i + d + items.length) % items.length].id);
  };
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const info = item?.card != null ? infoOf(item.card) : null;
  const title = info?.title ?? null;
  const canOpen = !!info && isOpenLane(info.lane);
  return (
    <Dialog open={item != null} onOpenChange={(o) => !o && onId(null)}>
      <DialogContent className="grid max-h-[94dvh] w-[min(96vw,1400px)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-4 sm:max-w-none sm:p-5">
        {item && (
          <>
            <div className="flex min-w-0 items-baseline gap-2 pr-10">
              <DialogTitle className="min-w-0 truncate text-base font-semibold">{fileName(item.rel)}</DialogTitle>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {i + 1}/{items.length} · {agoVi(item.mtime, now)}
              </span>
            </div>
            <div className="relative min-h-0">
              <PreviewImage key={item.id} id={item.id} token={token} alt={item.rel} eager className="h-[min(72dvh,900px)] w-full rounded-lg" />
              {items.length > 1 && (
                <>
                  <Button type="button" size="icon" variant="secondary" className="absolute top-1/2 left-2 -translate-y-1/2 shadow-sm" onClick={() => go(-1)} aria-label="Ảnh trước (←)">
                    <ChevronLeftIcon />
                  </Button>
                  <Button type="button" size="icon" variant="secondary" className="absolute top-1/2 right-2 -translate-y-1/2 shadow-sm" onClick={() => go(1)} aria-label="Ảnh sau (→)">
                    <ChevronRightIcon />
                  </Button>
                </>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <DialogDescription asChild>
                <code className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground">
                  {fullPath(item)}
                </code>
              </DialogDescription>
              {item.card != null && (
                <Button type="button" size="sm" variant="outline" onClick={() => onOpenCard(item.card!)} disabled={!canOpen} title={canOpen ? undefined : info ? "Card đã đóng" : "Card không còn trên board"}>
                  <KanbanSquareIcon /> Mở card #{item.card}
                  {title && <span className="max-w-56 truncate font-normal text-muted-foreground">{title}</span>}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
