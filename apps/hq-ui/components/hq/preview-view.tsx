"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  ImageIcon,
  ImageOffIcon,
  KanbanSquareIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cardParts, prRef } from "@/lib/card-tags";
import { LANES, type Board, type LaneKey, type Step } from "@/lib/lanes";
import { agoShort, agoVi } from "@/lib/now";
import { fileName, lastActivity, previewSections, rootKey, type PreviewItem, type ProjectPreviews } from "@/lib/preview";
import type { ProjectBoard } from "@/lib/server/board";
import { boardCard, eyeNote } from "@/lib/eye";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { EmptyState, ErrorNote } from "./bits";
import { LANE_VI, TONE_INK, laneTone } from "./card-sheet";
import { AskImage } from "./ask-image";
import { Switch } from "./machine-view";
import { PlayButton } from "./play-view";
import { makeApi, type Api } from "./use-hq";
import type { Room } from "./use-office";
import { useAuthedImage, useNearView } from "./use-poll";

export type PreviewState = { data: { projects: ProjectPreviews[] } | null; error: string | null; at: number; reload: () => void };

/** Done cards shown before "Xem thêm". */
const DONE_FIRST = 6;
/** Thumbs per card row; the lightbox walks all of the card's images. */
const ROW_SHOTS = 3;

/** The board this project's cards are filed on (a worktree shares its repo's), if read. */
function boardOf(boards: ProjectBoard[] | null, root: string): Board | null {
  const k = rootKey(root);
  return (boards ?? []).find((b) => b.board && (rootKey(b.root) === k || (b.filed && rootKey(b.filed) === k)))?.board ?? null;
}

/** What the board says about a card: its title and lane (or done/dropped). */
export type CardInfo = { title: string; lane: LaneKey | "done" | "dropped" };

/** What the board says about card #id in this project, if known. */
export function cardInfo(boards: ProjectBoard[] | null, root: string, id: number): CardInfo | null {
  const b = boardOf(boards, root);
  if (!b) return null;
  for (const l of LANES) {
    const c = b.lanes[l.key].find((x) => x.id === id);
    if (c) return { title: cardParts(c.text).title, lane: l.key };
  }
  const c = b.closed.find((x) => x.id === id);
  return c ? { title: cardParts(c.text).title, lane: c.state } : null;
}

/**
 * Where the project really is: the cards being worked on with their newest shots, the cards just
 * finished with their evidence, then every other image. Times are commit times (a checkout never
 * moves an old shot to the top); the lightbox walks one card's images.
 */
export function PreviewView({
  state,
  boards,
  token,
  rooms,
  onOpenCard,
}: {
  state: PreviewState;
  boards: ProjectBoard[] | null;
  token: string;
  /** Office rooms: who "Hỏi về ảnh này" can send to. */
  rooms: Room[];
  onOpenCard: (root: string, id: number) => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  /** The open image and the list prev/next walks: one card's images, or "other". */
  const [view, setView] = useState<{ scope: number | "other"; id: string } | null>(null);
  const [ask, setAsk] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [otherOpen, setOtherOpen] = useState<boolean | null>(null);
  const api = useMemo(() => makeApi(token), [token]);
  const list = useMemo(() => [...(state.data?.projects ?? [])].sort((a, b) => (b.items[0]?.at ?? 0) - (a.items[0]?.at ?? 0)), [state.data]);
  const cur = list.find((p) => p.root === pick) ?? list[0];
  // The poll clock: relative times move with each answer, never with a render.
  const now = state.at;
  const board = cur ? boardOf(boards, cur.root) : null;
  const sec = useMemo(() => previewSections(cur?.items ?? [], board, now), [cur, board, now]);

  if (state.error && !state.data) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="ảnh preview" error={state.error} onRetry={state.reload} />
      </div>
    );
  }

  const viewItems =
    view == null ? [] : view.scope === "other" ? sec.other : [...sec.working, ...sec.done].find((r) => r.card.id === view.scope)?.items ?? cur?.items.filter((i) => i.card === view.scope) ?? [];
  const open = (scope: number | "other", id: string) => setView({ scope, id });
  const doneShown = allDone ? sec.done : sec.done.slice(0, DONE_FIRST);
  // Without a board every image is "other": show them open.
  const showOther = otherOpen ?? !board;
  const empty = !!cur && cur.items.length === 0 && sec.working.length === 0 && sec.done.length === 0;

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
          {cur && <EyeToggle key={cur.root} root={cur.root} since={cur.eye ?? null} api={api} onChanged={state.reload} />}
          {cur && <PlayButton key={cur.root} root={cur.root} name={cur.name} token={token} />}
          <Button type="button" variant="ghost" size="icon-sm" onClick={state.reload} aria-label="Tải lại ảnh">
            <RefreshCwIcon />
          </Button>
        </div>
        {cur && (
          <p className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular">
            {cur.main && (
              <span className="inline-flex items-center gap-1" title={`${cur.main.ref} · ${cur.main.subject} · ${agoVi(cur.main.at, now)}`}>
                <GitCommitHorizontalIcon aria-hidden className="size-3.5" />
                main <code className="font-mono text-foreground">{cur.main.sha.slice(0, 7)}</code>
                <span>{agoShort(cur.main.at, now)}</span>
              </span>
            )}
            {cur.main && <span aria-hidden>·</span>}
            {board ? (
              <>
                <span>
                  <span className="font-medium text-foreground">{sec.working.length}</span> card đang chạy
                </span>
                <span aria-hidden>·</span>
                <span>
                  <span className="font-medium text-foreground">{sec.done24h}</span> xong 24h
                </span>
              </>
            ) : (
              <span>{boards ? "chưa đọc được board" : "đang đọc board…"}</span>
            )}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!state.data ? (
          <RowsSkeleton />
        ) : !cur ? (
          <PreviewEmpty title="Chưa có phòng nào đang chạy" />
        ) : empty ? (
          <PreviewEmpty title={`${cur.name} chưa có ảnh chụp nào`} />
        ) : (
          <div className="space-y-7 px-4 py-4 sm:px-6">
            {board && (
              <Section id="pv-work" title="Đang làm" count={sec.working.length}>
                {sec.working.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Không card nào ở Building, QA, Review hay Approved.</p>
                ) : (
                  <ul className="divide-y">
                    {sec.working.map(({ card: c, items }) => {
                      const pr = c.pr ? prRef(c.pr) : null;
                      return (
                        <CardRow
                          key={c.id}
                          id={c.id}
                          title={cardParts(c.text).title}
                          onTitle={() => onOpenCard(cur.root, c.id)}
                          items={items}
                          token={token}
                          now={now}
                          onOpen={(id) => open(c.id, id)}
                          meta={
                            <>
                              <LaneChip lane={c.lane} />
                              {c.claim && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-px font-medium text-foreground" title={`${c.claim.room} nhận card ${agoVi(c.claim.at, now)}`}>
                                  <UserIcon aria-hidden className="size-3" />
                                  {c.claim.room}
                                </span>
                              )}
                              {pr &&
                                (pr.href ? (
                                  <a href={pr.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline">
                                    <GitPullRequestIcon aria-hidden className="size-3" />
                                    {pr.text}
                                  </a>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-foreground">
                                    <GitPullRequestIcon aria-hidden className="size-3" />
                                    {pr.text}
                                  </span>
                                ))}
                              <span className="tabular" title={`hoạt động cuối ${agoVi(lastActivity(c), now)}`}>
                                {agoShort(lastActivity(c), now)}
                              </span>
                            </>
                          }
                          note={c.note ? `${c.note.room ? `${c.note.room}: ` : ""}${c.note.text}` : null}
                        />
                      );
                    })}
                  </ul>
                )}
              </Section>
            )}

            {board && sec.done.length > 0 && (
              <Section id="pv-done" title="Xong gần đây" count={sec.done.length}>
                <ul className="divide-y">
                  {doneShown.map(({ card: c, items }) => (
                    <CardRow
                      key={c.id}
                      id={c.id}
                      title={cardParts(c.text).title}
                      items={items}
                      token={token}
                      now={now}
                      onOpen={(id) => open(c.id, id)}
                      meta={
                        <>
                          <LaneChip lane="done" />
                          {c.at != null && (
                            <span className="tabular" title={agoVi(c.at, now)}>
                              xong {agoShort(c.at, now)}
                            </span>
                          )}
                          {c.evidence && <span className="min-w-0 truncate font-mono">{c.evidence}</span>}
                        </>
                      }
                      note={null}
                    />
                  ))}
                </ul>
                {sec.done.length > DONE_FIRST && (
                  <Button type="button" variant="ghost" size="sm" className="mt-1 max-sm:h-11" onClick={() => setAllDone((v) => !v)} aria-expanded={allDone}>
                    {allDone ? "Thu gọn" : `Xem thêm ${sec.done.length - DONE_FIRST} card`}
                  </Button>
                )}
              </Section>
            )}

            {sec.other.length > 0 && (
              <section aria-labelledby="pv-other" className="space-y-2.5">
                <h2 id="pv-other" className="text-sm">
                  <button
                    type="button"
                    onClick={() => setOtherOpen(!showOther)}
                    aria-expanded={showOther}
                    aria-controls="pv-other-list"
                    className="-mx-1 inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 font-semibold outline-none hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:min-h-11"
                  >
                    <ChevronDownIcon aria-hidden className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", !showOther && "-rotate-90")} />
                    Khác
                    <span className="font-normal text-muted-foreground tabular">{sec.other.length} ảnh</span>
                  </button>
                  <span className="ml-2 text-xs font-normal text-muted-foreground">không gắn card, hoặc card không ở hai mục trên</span>
                </h2>
                {showOther && (
                  <ul id="pv-other-list" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-3">
                    {sec.other.map((i) => (
                      <li key={i.id}>
                        <Thumb item={i} token={token} now={now} onOpen={() => open("other", i.id)} caption />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      <Viewer
        items={viewItems}
        id={view?.id ?? null}
        token={token}
        now={now}
        onId={(id) => {
          setView(id && view ? { scope: view.scope, id } : null);
          if (!id) setAsk(false);
        }}
        ask={ask}
        onAsk={setAsk}
        api={api}
        rooms={rooms}
        boards={boards}
        cardInfo={(id) => (cur ? cardInfo(boards, cur.root, id) : null)}
        onOpenCard={(id) => {
          if (!cur) return;
          setView(null);
          setAsk(false);
          onOpenCard(cur.root, id);
        }}
      />
    </div>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        <span className="text-xs font-normal text-muted-foreground tabular">{count}</span>
      </h2>
      {children}
    </section>
  );
}

/** One card: what it is and where it stands on the left, its newest shots on the right (below on a phone). */
function CardRow({
  id,
  title,
  onTitle,
  meta,
  note,
  items,
  token,
  now,
  onOpen,
}: {
  id: number;
  title: string;
  onTitle?: () => void;
  meta: ReactNode;
  note: string | null;
  items: PreviewItem[];
  token: string;
  now: number;
  onOpen: (id: string) => void;
}) {
  const shots = items.slice(0, ROW_SHOTS);
  const more = items.length - shots.length;
  const label = (
    <>
      <span className="mr-1 font-mono text-[11px] font-normal text-muted-foreground">#{id}</span>
      {title}
    </>
  );
  return (
    <li className="grid gap-x-5 gap-y-2.5 py-3 sm:grid-cols-[minmax(0,1fr)_25.5rem]">
      <div className="min-w-0 space-y-1.5">
        {onTitle ? (
          <button
            type="button"
            onClick={onTitle}
            aria-haspopup="dialog"
            title="Mở card"
            className="line-clamp-2 rounded-sm text-left text-[13px] leading-snug font-medium text-pretty outline-none hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {label}
          </button>
        ) : (
          <p className="line-clamp-2 text-[13px] leading-snug font-medium text-pretty">{label}</p>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">{meta}</div>
        {note && <p className="line-clamp-1 text-[11px] text-muted-foreground">{note}</p>}
      </div>
      {shots.length ? (
        <ul className="grid grid-cols-3 gap-2" aria-label={`Ảnh của card #${id}, mới nhất trước`}>
          {shots.map((i, k) => (
            <li key={i.id} className="relative">
              <Thumb item={i} token={token} now={now} onOpen={() => onOpen(i.id)} />
              {k === shots.length - 1 && more > 0 && (
                <span className="pointer-events-none absolute top-1 right-1 rounded-md bg-background/90 px-1.5 py-px text-[11px] font-medium tabular shadow-sm">+{more}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground sm:hidden">
            <ImageIcon aria-hidden className="size-3.5" />
            chưa có ảnh
          </p>
          {/* Same slot as a first thumb: the column stays aligned, the state reads at a glance. */}
          <div className="grid grid-cols-3 gap-2 max-sm:hidden">
            <p className="flex aspect-[16/10] flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[11px] text-muted-foreground">
              <ImageIcon aria-hidden className="size-3.5" />
              chưa có ảnh
            </p>
          </div>
        </>
      )}
    </li>
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

/** A fixed 16:10 box (no layout shift while it loads), its true time under it; `caption` adds the name and card. */
function Thumb({ item, token, now, onOpen, caption }: { item: PreviewItem; token: string; now: number; onOpen: () => void; caption?: boolean }) {
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
        className="aspect-[16/10] w-full rounded-md border transition-[border-color] duration-150 group-hover:border-foreground/25 motion-reduce:transition-none"
      />
      {caption && <span className="mt-1.5 block truncate text-[13px] font-medium">{name}</span>}
      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        {caption && item.card != null && <span className="shrink-0 font-mono">#{item.card}</span>}
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

/** Full-size view of one card's images: prev/next (buttons, ← →, swipe), name, card, true time, source, "Hỏi về ảnh này". */
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
  boards,
  cardInfo: infoOf,
  onOpenCard,
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
  boards: ProjectBoard[] | null;
  cardInfo: (id: number) => CardInfo | null;
  onOpenCard: (id: number) => void;
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
  const info = item?.card != null ? infoOf(item.card) : null;
  const canOpen = !!info && isOpenLane(info.lane);
  // The eye room's latest `[soi ảnh]` note on this card, from the board HQ already reads.
  const note = item?.card != null ? eyeNote(boardCard(boardOf(boards, item.root), item.card)?.card) : null;
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
            <AskImage key={item.id} item={item} path={fullPath(item)} token={token} api={api} rooms={rooms} boards={boards} onDone={() => onAsk(false)} />
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
                {item.card != null && (
                  <span className="min-w-0 truncate">
                    <span className="font-mono">#{item.card}</span>
                    {info && <span className="text-foreground"> {info.title}</span>}
                  </span>
                )}
                <span className="tabular" title={new Date(item.at).toLocaleString()}>
                  {timeLabel(item, now)}
                </span>
                <SourceChip item={item} />
              </div>
            </div>
            <div className="relative min-h-0 touch-none select-none" {...swipe}>
              <PreviewImage key={item.id} id={item.id} token={token} alt={item.rel} eager className="h-[min(72dvh,900px)] w-full rounded-lg max-sm:h-[min(52dvh,900px)]" />
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
              {note && <EyeNoteBox step={note} now={now} />}
              <DialogDescription asChild>
                <code className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground max-sm:basis-full">{fullPath(item)}</code>
              </DialogDescription>
              {item.card != null && (
                <Button type="button" size="sm" variant="outline" className="max-sm:h-11" onClick={() => onOpenCard(item.card!)} disabled={!canOpen} title={canOpen ? undefined : info ? "Card đã đóng" : "Card không còn trên board"}>
                  <KanbanSquareIcon /> Mở card #{item.card}
                </Button>
              )}
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

/** The eye room's `[soi ảnh]` note on the open image's card: who, when, the note itself. */
export function EyeNoteBox({ step, now }: { step: Step; now: number }) {
  return (
    <p role="note" aria-label="Nhận xét soi ảnh" className="max-h-28 basis-full overflow-y-auto rounded-md bg-muted/60 px-2.5 py-1.5 text-xs leading-snug break-words whitespace-pre-wrap">
      <span className="text-muted-foreground">
        {step.room ?? "owner"} · <span className="tabular">{agoShort(step.at, now)}</span> ·{" "}
      </span>
      {step.text}
    </p>
  );
}

/**
 * "Tự soi ảnh" for this project: on adds the `eye` room to the running team (`auto up --add eye`),
 * which reviews each card's new screenshots; off stops that room only. `since`: when it went on.
 */
function EyeToggle({ root, since, api, onChanged }: { root: string; since: number | null; api: Api; onChanged: () => void }) {
  // The state asked for, while the poll still shows the `since` it was asked from.
  const [want, setWant] = useState<{ on: boolean; from: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const on = want && want.from === since ? want.on : since != null;

  async function flip(next: boolean) {
    setBusy(true);
    setWant({ on: next, from: since });
    try {
      await api("/api/preview/eye", { method: "POST", body: { root, on: next } });
      toast.success(next ? "Đã bật tự soi ảnh" : "Đã tắt tự soi ảnh", { description: next ? "Phòng eye soi ảnh mới của card đang mở, ghi note [soi ảnh] và báo lead khi lệch AC." : "Đã dừng riêng phòng eye; các phòng khác vẫn chạy." });
      onChanged();
    } catch (e) {
      setWant(null);
      toast.error(next ? "Chưa bật được tự soi ảnh" : "Chưa tắt được tự soi ảnh", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs" title="Phòng eye soi ảnh mới của card đang mở so với AC và ghi note [soi ảnh]">
      <span className={cn(on ? "text-foreground" : "text-muted-foreground")}>Tự soi ảnh: {on ? "bật" : "tắt"}</span>
      <Switch on={on} busy={busy} label="Tự soi ảnh" onChange={(v) => void flip(v)} />
    </span>
  );
}
