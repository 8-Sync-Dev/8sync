"use client";

import { ChevronDownIcon, EllipsisIcon, EyeIcon, EyeOffIcon, PinIcon, PinOffIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useFlip } from "@/hooks/use-flip";
import { BOT_STATUS_LABEL, stepKey } from "@/lib/bots";
import { agoShort } from "@/lib/now";
import type { RosterBot, RosterSection } from "@/lib/roster";
import { BUILT_IN_TEMPLATES, SUGGESTED_TEMPLATE_IDS } from "@/lib/templates";
import { cn } from "@/lib/utils";
import type { Room } from "../use-office";
import { BotAvatar } from "./bot-avatar";
import { TEMPLATE_TINT } from "./template-bits";
import type { Roster } from "./use-roster";

/** The state as a dot beside its word: the word carries it, the colour only reinforces. */
const DOT: Record<RosterBot["status"], string> = {
  needs: "bg-st-needs",
  error: "bg-destructive",
  working: "bg-st-running",
  idle: "bg-muted-foreground/40",
};

/**
 * The roster (owner 2026-11-07, Grok Bot style): one row per bot (face, a name no other row shares,
 * role, state, unseen dot) in sections: Chờ anh, the Primary Bot, the owner's pins, one per project,
 * then "Bot ẩn" folded. Never a session, worktree or subagent: those are a bot's history. ↑/↓ (Home/
 * End) move between rows; each row's ⋯ pins or hides it (this browser). `dense`: the desktop sidebar
 * (no preview line); a phone's full-screen list shows what each bot says last.
 */
export function BotRoster({
  roster,
  selected,
  onOpen,
  onNew,
  dense = false,
}: {
  roster: Roster;
  /** The open bot's key (aria-current). */
  selected: string | null;
  onOpen: (key: string) => void;
  /** "Bot mới", with a template picked from the empty state. */
  onNew: (template?: string) => void;
  dense?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const { sections, loading, error } = roster;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset.bot;
    if (focused == null) return;
    e.preventDefault();
    const shown = [...(scroller.current?.querySelectorAll<HTMLElement>("[data-bot]") ?? [])].map((x) => x.dataset.bot!);
    const next = e.key === "Home" ? shown[0] : e.key === "End" ? shown.at(-1) : stepKey(shown, focused, e.key === "ArrowDown" ? 1 : -1);
    if (next) scroller.current?.querySelector<HTMLElement>(`[data-bot="${CSS.escape(next)}"]`)?.focus();
  };

  if (loading) return <ListSkeleton />;
  if (error && !roster.all.length)
    return (
      <div role="alert" className="space-y-3 px-4 py-6 text-sm">
        <p className="font-medium">Không đọc được danh sách bot.</p>
        <p className="text-muted-foreground">HQ hỏi /api/office và nhận lỗi: {error}</p>
        <Button size="sm" variant="outline" onClick={roster.retry} className="max-md:h-11">
          <RotateCwIcon aria-hidden /> Thử lại
        </Button>
      </div>
    );
  if (!roster.bots.length)
    return (
      <div className="space-y-4 px-4 py-8 text-sm">
        <div className="space-y-1.5">
          <p className="font-medium">Chưa có bot nào.</p>
          <p className="text-pretty text-muted-foreground">Tạo bot đầu tiên từ một mẫu: mỗi bot làm việc trong một thư mục.</p>
        </div>
        <Button size="sm" onClick={() => onNew()} className="max-md:h-11">
          <PlusIcon aria-hidden /> Tạo bot
        </Button>
        <ul aria-label="Mẫu gợi ý" className={cn("grid gap-2", !dense && "min-[360px]:grid-cols-2")}>
          {SUGGESTED_TEMPLATE_IDS.map((id) => BUILT_IN_TEMPLATES.find((t) => t.id === id)!).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onNew(t.id)}
                className="flex h-full w-full flex-col items-start gap-1.5 rounded-xl border bg-card p-3 text-left outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
              >
                <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-base ring-1", TEMPLATE_TINT[t.color])}>
                  {t.emoji}
                </span>
                <span className="font-medium">{t.name}</span>
                <span className="line-clamp-2 text-xs text-pretty text-muted-foreground">{t.purpose}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div ref={scroller} onKeyDown={onKey} className="relative space-y-3 pb-2 [overflow-anchor:none]">
      {sections.map((s) => (
        <Section key={s.id} s={s} roster={roster} scroller={scroller} selected={selected} onOpen={onOpen} dense={dense} />
      ))}
    </div>
  );
}

function Section({
  s,
  roster,
  scroller,
  selected,
  onOpen,
  dense,
}: {
  s: RosterSection<RosterBot<Room>>;
  roster: Roster;
  scroller: RefObject<HTMLDivElement | null>;
  selected: string | null;
  onOpen: (key: string) => void;
  dense: boolean;
}) {
  const list = useRef<HTMLUListElement>(null);
  useFlip(list, scroller);
  // "Bot ẩn" stays folded unless the owner opens it, or the open bot is in it.
  const [open, setOpen] = useState(false);
  const foldable = s.id === "hidden";
  const shown = !foldable || open || s.bots.some((b) => b.key === selected);
  const id = `${useId()}roster`;
  return (
    <section aria-labelledby={`${id}-h`}>
      {foldable ? (
        <h3 id={`${id}-h`} className="px-1">
          <button
            type="button"
            aria-expanded={shown}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
            className="flex h-8 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-11"
          >
            <ChevronDownIcon aria-hidden className={cn("size-3.5 transition-transform motion-reduce:transition-none", !shown && "-rotate-90")} />
            {s.title}
            <span className="tabular">{s.bots.length}</span>
          </button>
        </h3>
      ) : (
        <h3 id={`${id}-h`} className={cn("flex h-7 items-center gap-1.5 px-3 text-xs font-medium", s.id === "needs" ? "text-[color-mix(in_oklch,var(--st-needs),black_42%)] dark:text-st-needs" : "text-muted-foreground")}>
          <span className="truncate">{s.title}</span>
          {s.bots.length > 1 && <span className="tabular opacity-80">{s.bots.length}</span>}
        </h3>
      )}
      <ul ref={list} id={id} hidden={!shown} className="space-y-px">
        {s.bots.map((b) => (
          <li key={b.key} data-flip={b.key} className="group/row relative">
            <BotRow
              b={b}
              now={roster.now}
              current={b.key === selected}
              badge={b.key === roster.chief ? "chief" : b.key === roster.primary ? "primary" : null}
              unread={roster.unread.has(b.key) && b.key !== selected}
              dense={dense}
              onOpen={onOpen}
            />
            <RowMenu b={b} pinned={roster.pins.includes(b.id)} hidden={roster.hidden.includes(b.id)} onPin={roster.togglePin} onHide={roster.toggleHidden} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BotRow({
  b,
  now,
  current,
  badge,
  unread,
  dense,
  onOpen,
}: {
  b: RosterBot;
  now: number;
  current: boolean;
  badge: "chief" | "primary" | null;
  unread: boolean;
  dense: boolean;
  onOpen: (key: string) => void;
}) {
  const ago = agoShort(b.at, now);
  return (
    <button
      type="button"
      data-bot={b.key}
      onClick={() => onOpen(b.key)}
      aria-current={current ? "true" : undefined}
      aria-label={`${b.display}, ${b.role}, ${BOT_STATUS_LABEL[b.status]}${unread ? ", có tin chưa xem" : ""}`}
      title={b.preview}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-lg py-2 pr-10 text-left outline-none transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset motion-reduce:transition-none",
        dense ? "min-h-12 pl-2" : "min-h-[68px] pl-3",
        current && "bg-muted",
      )}
    >
      <BotAvatar id={b.key} status={b.status} size={dense ? 36 : 44} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 truncate font-semibold tracking-tight", dense ? "text-sm" : "text-[15px]")}>{b.display}</span>
          {badge === "chief" ? <ChiefBadge /> : badge === "primary" ? <PrimaryBadge /> : null}
          {unread && <span aria-hidden className="size-2 shrink-0 rounded-full bg-st-unread" />}
          {ago && <span className="ml-auto shrink-0 pl-1 text-xs text-muted-foreground tabular">{ago}</span>}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[b.status], b.status === "working" && "motion-safe:animate-pulse")} />
          <span className={cn("shrink-0", b.status === "needs" && "font-medium text-[color-mix(in_oklch,var(--st-needs),black_42%)] dark:text-st-needs", b.status === "error" && "font-medium text-destructive")}>
            {BOT_STATUS_LABEL[b.status]}
          </span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{b.role}</span>
        </span>
        {!dense && <span className={cn("mt-0.5 block truncate text-[13px]", b.status === "needs" ? "text-foreground" : "text-muted-foreground")}>{b.preview}</span>}
      </span>
    </button>
  );
}

/** ⋯ on a row: pin it to the top, or hide it in "Bot ẩn" (this browser only; a waiting bot still floats up). */
function RowMenu({ b, pinned, hidden, onPin, onHide }: { b: RosterBot; pinned: boolean; hidden: boolean; onPin: (id: string) => void; onHide: (id: string) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Thao tác với bot ${b.display}`}
        className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-black/5 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:opacity-100 motion-reduce:transition-none max-md:size-11 max-md:opacity-100 dark:hover:bg-white/10 [@media(hover:none)]:opacity-100"
      >
        <EllipsisIcon aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 data-closed:animate-none!">
        <DropdownMenuItem className="max-md:min-h-11" onSelect={() => onPin(b.id)}>
          {pinned ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />} {pinned ? "Bỏ ghim" : "Ghim lên đầu"}
        </DropdownMenuItem>
        <DropdownMenuItem className="max-md:min-h-11" onSelect={() => onHide(b.id)}>
          {hidden ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />} {hidden ? "Hiện lại" : "Ẩn khỏi danh sách"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Marks the Chief of Staff's row and thread. */
export function ChiefBadge() {
  return <span className="shrink-0 self-center rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-primary uppercase">Chief</span>;
}

/** Marks the Primary Bot: the one that coordinates the others (lib/roster primaryKey). */
export function PrimaryBadge() {
  return <span className="shrink-0 self-center rounded-full bg-foreground px-1.5 py-px text-[10px] font-semibold tracking-wide text-background">Chính</span>;
}

function ListSkeleton() {
  return (
    <div aria-busy aria-label="Đang tải danh sách bot" className="space-y-1 py-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-10 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
