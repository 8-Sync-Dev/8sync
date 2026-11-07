"use client";

import { PlusIcon, RotateCwIcon, SearchIcon, XIcon } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFlip } from "@/hooks/use-flip";
import { BOT_STATUS_LABEL, botCounts, stepKey, type Bot, type BotFilter } from "@/lib/bots";
import { BUILT_IN_TEMPLATES, SUGGESTED_TEMPLATE_IDS } from "@/lib/templates";
import { agoShort } from "@/lib/now";
import { cn } from "@/lib/utils";
import { BotAvatar, StatusPill } from "./bot-avatar";
import { TEMPLATE_TINT } from "./new-bot-sheet";

const FILTERS: BotFilter[] = ["all", "needs", "working", "idle", "error"];

/**
 * The bot list: search, a status filter with counts, then one row per bot in attention order. ↑/↓ move
 * between rows, Enter opens one (a row is a button). A bot that climbs (it got busy or asks the owner)
 * slides up to its place and the rows it passes shift down, Messenger style (hooks/use-flip.ts); the
 * scroll position holds for a reader further down.
 */
export function BotList({
  all,
  bots,
  selected,
  now,
  query,
  onQuery,
  filter,
  onFilter,
  onOpen,
  loading,
  error,
  onRetry,
  onNew,
  chief = null,
}: {
  /** Every live bot (the counts); `bots` is what the search and filter leave. */
  all: Bot[];
  bots: Bot[];
  selected: string | null;
  now: number;
  query: string;
  onQuery: (q: string) => void;
  filter: BotFilter;
  onFilter: (f: BotFilter) => void;
  onOpen: (key: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** "Bot mới": the sheet, with a template already picked when given (an empty-state card). */
  onNew: (templateId?: string) => void;
  /** The Chief of Staff's bot key (pinned first by the caller), shown with a "Chief" badge. */
  chief?: string | null;
}) {
  const list = useRef<HTMLUListElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useFlip(list, scroller);
  const counts = botCounts(all);
  const keys = bots.map((b) => b.key);

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const focused = (document.activeElement as HTMLElement | null)?.dataset.bot ?? selected;
    const next = e.key === "Home" ? keys[0] : e.key === "End" ? keys.at(-1) : stepKey(keys, focused, e.key === "ArrowDown" ? 1 : -1);
    if (next) list.current?.querySelector<HTMLElement>(`[data-bot="${CSS.escape(next)}"]`)?.focus();
  };

  return (
    <section aria-label="Danh sách bot" className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 space-y-2 border-b px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                onQuery("");
              } else if (e.key === "ArrowDown" && keys.length) {
                e.preventDefault();
                list.current?.querySelector<HTMLElement>("[data-bot]")?.focus();
              }
            }}
            placeholder="Tìm bot, dự án, việc đang làm…"
            aria-label="Tìm bot"
            className="h-9 pr-9 pl-8 max-md:h-11 [&::-webkit-search-cancel-button]:hidden"
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Xoá ô tìm"
              className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:size-9"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          )}
        </div>
          <Button size="sm" onClick={() => onNew()} className="h-9 shrink-0 max-md:h-11">
            <PlusIcon aria-hidden /> Bot mới
          </Button>
        </div>
        <div role="group" aria-label="Lọc theo trạng thái" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
          {FILTERS.filter((f) => f === "all" || f !== "error" || counts.error > 0).map((f) => {
            const n = f === "all" ? all.length : counts[f];
            const on = filter === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => onFilter(on && f !== "all" ? "all" : f)}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none max-md:h-11 max-md:px-3.5",
                  on ? "border-foreground/80 bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {f === "all" ? "Tất cả" : BOT_STATUS_LABEL[f]}
                {!loading && <span className={cn("tabular", on ? "opacity-80" : "opacity-70")}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]">
        {loading ? (
          <ListSkeleton />
        ) : error && !all.length ? (
          <div role="alert" className="space-y-3 px-4 py-6 text-sm">
            <p className="font-medium">Không đọc được danh sách bot.</p>
            <p className="text-muted-foreground">HQ hỏi /api/office và nhận lỗi: {error}</p>
            <Button size="sm" variant="outline" onClick={onRetry} className="max-md:h-11">
              <RotateCwIcon aria-hidden /> Thử lại
            </Button>
          </div>
        ) : !all.length ? (
          <div className="space-y-4 px-4 py-8 text-sm">
            <div className="space-y-1.5">
              <p className="font-medium">Chưa có bot nào.</p>
              <p className="text-pretty text-muted-foreground">Tạo bot đầu tiên từ một mẫu: mỗi bot làm việc trong một thư mục.</p>
            </div>
            <Button size="sm" onClick={() => onNew()} className="max-md:h-11">
              <PlusIcon aria-hidden /> Bot mới
            </Button>
            <ul aria-label="Mẫu gợi ý" className="space-y-1.5">
              {SUGGESTED_TEMPLATE_IDS.map((id) => BUILT_IN_TEMPLATES.find((t) => t.id === id)!).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onNew(t.id)}
                    className="flex w-full items-center gap-3 rounded-xl border bg-card p-2.5 text-left outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none max-md:min-h-14"
                  >
                    <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-lg text-base ring-1", TEMPLATE_TINT[t.color])}>
                      {t.emoji}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{t.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{t.purpose}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : !bots.length ? (
          <div className="space-y-3 px-4 py-8 text-sm">
            <p className="text-muted-foreground">Không bot nào khớp {query ? `“${query}”` : "bộ lọc này"}.</p>
            <Button
              size="sm"
              variant="outline"
              className="max-md:h-11"
              onClick={() => {
                onQuery("");
                onFilter("all");
              }}
            >
              Xem tất cả bot
            </Button>
          </div>
        ) : (
          <ul ref={list} onKeyDown={onKey} aria-label="Bot" className="py-1">
            {bots.map((b) => (
              <li key={b.key} data-flip={b.key} className="relative bg-background">
                <BotRow b={b} now={now} current={b.key === selected} chief={b.key === chief} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BotRow({ b, now, current, chief, onOpen }: { b: Bot; now: number; current: boolean; chief: boolean; onOpen: (key: string) => void }) {
  const sub = [b.qualifier ?? b.project, b.branch].filter(Boolean).join(" · ");
  const ago = agoShort(b.at, now);
  return (
    <button
      type="button"
      data-bot={b.key}
      onClick={() => onOpen(b.key)}
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset motion-reduce:transition-none max-md:min-h-[72px]",
        current && "bg-muted",
      )}
    >
      <BotAvatar id={b.key} status={b.status} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[15px] font-semibold tracking-tight">{b.name}</span>
          {chief && <ChiefBadge />}
          {sub && (
            <span className="min-w-0 truncate text-xs text-muted-foreground" title={sub}>
              {sub}
            </span>
          )}
          {ago && <span className="ml-auto shrink-0 pl-1 text-xs text-muted-foreground tabular">{ago}</span>}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <StatusPill status={b.status} />
          <span className={cn("min-w-0 truncate text-[13px]", b.status === "needs" ? "text-foreground" : "text-muted-foreground")}>{b.preview}</span>
        </span>
      </span>
    </button>
  );
}

/** Marks the Chief of Staff's row and thread. */
export function ChiefBadge() {
  return <span className="shrink-0 self-center rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-primary uppercase">Chief</span>;
}

function ListSkeleton() {
  return (
    <div aria-busy aria-label="Đang tải danh sách bot" className="space-y-1 py-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-11 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
