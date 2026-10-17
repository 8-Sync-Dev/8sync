"use client";

import { ArrowRightIcon, GitPullRequestIcon, LayersIcon, OctagonAlertIcon, RefreshCwIcon, ShipIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cardParts, nextUp, prRef } from "@/lib/card-tags";
import { LANES, boardSummary, claimStale, openCount, rankOf, type Card, type LaneKey } from "@/lib/lanes";
import { agoShort, agoVi, roomRole, type Move } from "@/lib/now";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { CardSheet, LabelChip, PrioChip, TagChips, TONE_INK, laneTone } from "./card-sheet";
import { RoleIcon } from "./role-badge";
import type { BoardsState } from "./use-board";

/** The project board (`8sync ccc auto board`): which room holds which card, lane by lane. */
export function LanesView({ state }: { state: BoardsState }) {
  const { boards, error, moves, at: now, reload: load } = state;
  const [pick, setPick] = useState<string | null>(null);
  // The open card by id, so each poll shows its latest state; the snapshot keeps the sheet filled while it closes.
  const [open, setOpen] = useState<{ root: string; card: Card } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (error && !boards) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="board" error={error} onRetry={load} />
      </div>
    );
  }
  // Busiest project first; the owner's pick wins while it still has a live room.
  const list = [...(boards ?? [])].sort((a, b) => (b.board ? openCount(b.board) : -1) - (a.board ? openCount(a.board) : -1));
  const cur = list.find((b) => b.root === pick) ?? list[0];

  if (boards && !cur) {
    return (
      <EmptyState icon={<LayersIcon />} title="Chưa có phòng nào đang chạy">
        Ở tab Văn phòng, bấm “Mở team” cạnh dự án (thêm thư mục ở mục Projects nếu chưa có), rồi bấm “Giao việc” ở góc trên để đưa card vào board.
      </EmptyState>
    );
  }

  const prefix = cur ? `${cur.root}#` : null;
  const movedHere = prefix ? [...moves].filter(([k]) => k.startsWith(prefix)).map(([k, m]) => ({ id: k.slice(prefix.length), ...m })) : [];
  const moveOf = (id: number) => (prefix ? moves.get(`${prefix}${id}`) : undefined);
  const next = cur?.board ? nextUp(cur.board.lanes.ready) : null;
  const live = open ? boards?.find((b) => b.root === open.root)?.board : null;
  const shown = open ? ((live ? LANES.flatMap((l) => live.lanes[l.key]).find((c) => c.id === open.card.id) : undefined) ?? open.card) : null;
  const onOpenCard = (c: Card) => {
    if (!cur) return;
    setOpen({ root: cur.root, card: c });
    setSheetOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 sm:px-6">
        {list.length > 1 ? (
          <Select value={cur?.root ?? ""} onValueChange={setPick}>
            <SelectTrigger size="sm" className="max-w-64 text-xs" aria-label="Dự án">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map((b) => (
                <SelectItem key={b.root} value={b.root} className="text-xs">
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : cur ? (
          <span className="text-sm font-medium">{cur.name}</span>
        ) : (
          <Skeleton className="h-4 w-32" />
        )}
        <span className="text-xs text-muted-foreground">{cur?.board ? boardSummary(cur.board) : (cur?.error ?? "")}</span>
        {/* Announced once per poll that moved a card; the moved cards carry the same text. */}
        <span role="status" className="min-w-0 truncate text-xs font-medium text-brand-ink">
          {movedHere.length > 0 && `Vừa chuyển: ${movedHere.map((m) => `#${m.id} ${laneLabel(m.from)} → ${laneLabel(m.to)}`).join(" · ")}`}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" onClick={() => void load()} aria-label="Tải lại board">
          <RefreshCwIcon />
        </Button>
      </div>
      {cur?.error && !cur.board ? (
        <div className="p-4 sm:px-6">
          <ErrorNote what={`board của ${cur.name}`} error={cur.error} onRetry={load} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 overflow-x-auto overflow-y-hidden md:snap-none">
          <div className="grid h-full grid-cols-[repeat(7,minmax(min(82vw,16rem),1fr))] gap-2.5 px-4 py-4 sm:px-6 md:grid-cols-[repeat(7,minmax(11rem,1fr))]">
            {LANES.map((l) => (
              <Lane key={l.key} lane={l.key} label={l.label} hint={l.hint} cards={cur?.board?.lanes[l.key] ?? null} moveOf={moveOf} now={now} next={next} onOpen={onOpenCard} />
            ))}
          </div>
        </div>
      )}
      <CardSheet
        c={shown}
        open={sheetOpen}
        now={now}
        next={shown != null && shown.id === next && shown.lane === "ready"}
        onClose={() => setSheetOpen(false)}
        onPrio={open && shown ? (prio) => state.setPrio(open.root, shown.id, prio) : undefined}
      />
    </div>
  );
}

const laneLabel = (k: string) => LANES.find((l) => l.key === k)?.label ?? (k === "done" ? "Done" : k === "dropped" ? "Bỏ" : k);

/** Amber text that passes AA on light surfaces (same mix as idle-chip). */
const NEEDS_INK = "text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs";

function Lane({
  lane,
  label,
  hint,
  cards,
  moveOf,
  now,
  next,
  onOpen,
}: {
  lane: LaneKey;
  label: string;
  hint: string;
  cards: Card[] | null;
  moveOf: (id: number) => Move | undefined;
  now: number;
  next: number | null;
  onOpen: (c: Card) => void;
}) {
  const n = cards?.length ?? 0;
  // Ship and Blocked wait on the owner: their lane is tinted harder and says so in its header.
  const loud = (lane === "approved" || lane === "blocked") && n > 0;
  return (
    <section
      aria-labelledby={`lane-${lane}`}
      style={laneTone(lane)}
      className={cn(
        "flex min-h-0 snap-start flex-col rounded-xl",
        loud
          ? "bg-[color-mix(in_oklch,var(--tone)_11%,var(--muted))] ring-1 ring-[color-mix(in_oklch,var(--tone)_35%,transparent)] ring-inset"
          : "bg-[color-mix(in_oklch,var(--tone)_4%,var(--muted))]",
      )}
    >
      <h3 id={`lane-${lane}`} className="flex items-center gap-1.5 px-3 pt-3 text-[13px] font-semibold">
        {lane === "approved" && loud ? (
          <ShipIcon className={cn("size-3.5", TONE_INK)} aria-hidden />
        ) : lane === "blocked" && loud ? (
          <OctagonAlertIcon className={cn("size-3.5", TONE_INK)} aria-hidden />
        ) : (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--tone)" />
        )}
        <span className={cn(loud && TONE_INK)}>{label}</span>
        <span className={cn("ml-auto rounded-full px-1.5 text-[11px] font-semibold tabular", loud ? "bg-(--tone) text-background" : "bg-background text-muted-foreground")}>
          {cards ? n : ""}
          <span className="sr-only"> card</span>
        </span>
      </h3>
      <p className={cn("px-3 pt-0.5 pb-2 text-[11px] text-muted-foreground", loud && cn("font-medium", TONE_INK))}>{hint}</p>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-2">
        {cards === null ? (
          [0, 1].map((i) => (
            <li key={i}>
              <Skeleton className="h-20 rounded-lg" />
            </li>
          ))
        ) : cards.length === 0 ? (
          <li className="px-1.5 py-3 text-center text-[11px] text-muted-foreground">Trống</li>
        ) : (
          // The order rooms claim in: most urgent first, queue order within a priority (sort is stable).
          // Keyed on the move too: the highlight replays only when the card changes lane again.
          [...cards].sort((a, b) => rankOf(a) - rankOf(b)).map((c) => {
            const m = moveOf(c.id);
            return <CardItem key={m ? `${c.id}:${m.from}` : c.id} c={c} move={m} now={now} next={c.id === next && lane === "ready"} onOpen={onOpen} />;
          })
        )}
      </ul>
    </section>
  );
}

/** One card: its chips, the title in up to 3 lines, who holds it, PR, bounces, a missing check, the last note. A click opens the sheet. */
export function CardItem({ c, move, now, next, onOpen }: { c: Card; move?: Move; now: number; next: boolean; onOpen: (c: Card) => void }) {
  const stale = claimStale(c, now);
  const who = c.claim ? roomRole(c.claim.room) : null;
  const { title, tags } = cardParts(c.text);
  const noCheck = !c.check && c.lane !== "backlog";
  return (
    <li data-moved={move ? "" : undefined}>
      <button
        type="button"
        onClick={() => onOpen(c)}
        aria-haspopup="dialog"
        className={cn(
          "block w-full rounded-lg border bg-card px-2.5 py-2 text-left transition-[border-color] duration-150 outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
          // State-driven: only a card whose lane changed in the latest poll; reduced motion keeps the ring, drops the flash.
          move && "ring-2 ring-brand-ink/45 motion-safe:animate-[hq-card-moved_1.4s_cubic-bezier(0.22,1,0.36,1)]",
        )}
      >
        {move && (
          <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-brand-ink">
            <ArrowRightIcon className="size-3" aria-hidden />
            vừa chuyển từ {laneLabel(move.from)}
          </span>
        )}
        {(c.label || tags.length > 0 || next || (c.prio != null && c.prio !== 2)) && (
          <span className="mb-1.5 flex flex-wrap items-center gap-1">
            <PrioChip prio={c.prio} />
            {next && (
              <span className="inline-flex items-center rounded-md bg-brand/25 px-1.5 py-px text-[11px] leading-4 font-semibold text-brand-ink dark:text-brand" title="Phòng dev rảnh kế tiếp sẽ nhận card này (thứ tự hàng đợi)">
                Kế tiếp
              </span>
            )}
            {c.label && <LabelChip label={c.label} />}
            <TagChips tags={tags} />
          </span>
        )}
        <span className="line-clamp-3 text-[13px] leading-snug font-medium text-pretty">
          <span className="mr-1 font-mono text-[11px] font-normal text-muted-foreground">#{c.id}</span>
          {title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {c.claim && (
            <span
              className={cn("inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 whitespace-nowrap text-foreground", stale && "bg-st-needs/15")}
              title={stale ? "im quá 2 giờ: claim kế sẽ thu hồi" : `${c.claim.room} nhận card ${agoVi(c.claim.at, now)}`}
            >
              <RoleIcon role={who?.role ?? null} />
              <span className="font-medium">{c.claim.room}</span>
              <span className="text-muted-foreground tabular">{agoShort(c.claim.at, now)}</span>
            </span>
          )}
          {c.pr && (
            <span className="inline-flex items-center gap-0.5 text-foreground">
              <GitPullRequestIcon className="size-3" aria-hidden />
              {prRef(c.pr).text}
            </span>
          )}
          {c.bounces > 0 && (
            <span className={cn("inline-flex items-center gap-0.5 tabular", c.bounces >= 2 && cn("font-semibold", NEEDS_INK))} title={`bị trả về ${c.bounces} lần`}>
              <Undo2Icon className="size-3" aria-hidden />
              {c.bounces}
              <span className="sr-only"> lần bị trả về</span>
            </span>
          )}
          {noCheck && <span className="font-medium text-destructive">thiếu lệnh check</span>}
        </span>
        {c.note && (
          <span className="mt-1 line-clamp-1 block text-[11px] text-muted-foreground">
            {c.note.room && <span className="font-medium text-foreground">{c.note.room}: </span>}
            {c.note.text}
            {c.note.at > 0 && <span className="tabular"> · {agoShort(c.note.at, now)}</span>}
          </span>
        )}
      </button>
    </li>
  );
}
