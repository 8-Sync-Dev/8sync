"use client";

import { ArrowRightIcon, GitPullRequestIcon, LayersIcon, OctagonAlertIcon, RefreshCwIcon, ShipIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LANES, boardSummary, claimStale, openCount, type Card, type LaneKey } from "@/lib/lanes";
import { agoShort, agoVi, roomRole, type Move } from "@/lib/now";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { RoleIcon } from "./role-badge";
import type { BoardsState } from "./use-board";

/** The project board (`8sync ccc auto board`): which room holds which card, lane by lane. */
export function LanesView({ state }: { state: BoardsState }) {
  const { boards, error, moves, at: now, reload: load } = state;
  const [pick, setPick] = useState<string | null>(null);

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
          <div className="grid h-full grid-cols-[repeat(7,minmax(min(80vw,15rem),1fr))] gap-2.5 md:grid-cols-[repeat(7,minmax(9.5rem,1fr))] px-4 py-4 sm:px-6">
            {LANES.map((l) => (
              <Lane key={l.key} lane={l.key} label={l.label} hint={l.hint} cards={cur?.board?.lanes[l.key] ?? null} moveOf={moveOf} now={now} />
            ))}
          </div>
        </div>
      )}
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
}: {
  lane: LaneKey;
  label: string;
  hint: string;
  cards: Card[] | null;
  moveOf: (id: number) => Move | undefined;
  now: number;
}) {
  const ship = lane === "approved" && (cards?.length ?? 0) > 0;
  const blocked = lane === "blocked" && (cards?.length ?? 0) > 0;
  return (
    <section aria-labelledby={`lane-${lane}`} className="flex min-h-0 snap-start flex-col rounded-xl bg-muted/60">
      <h3 id={`lane-${lane}`} className="flex items-center gap-1.5 px-3 pt-3 text-[13px] font-semibold">
        {ship && <ShipIcon className="size-3.5 text-st-needs" aria-hidden />}
        {blocked && <OctagonAlertIcon className="size-3.5 text-destructive" aria-hidden />}
        {label}
        <span className="ml-auto rounded-full bg-background px-1.5 text-[11px] font-medium text-muted-foreground tabular">{cards ? cards.length : ""}</span>
      </h3>
      <p className={cn("px-3 pt-0.5 pb-2 text-[11px] text-muted-foreground", ship && cn("font-medium", NEEDS_INK))}>{hint}</p>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-2">
        {cards === null ? (
          [0, 1].map((i) => (
            <li key={i}>
              <Skeleton className="h-16 rounded-lg" />
            </li>
          ))
        ) : cards.length === 0 ? (
          <li className="px-1.5 py-3 text-center text-[11px] text-muted-foreground">Trống</li>
        ) : (
          // Keyed on the move too: the highlight replays only when the card changes lane again.
          cards.map((c) => {
            const m = moveOf(c.id);
            return <CardItem key={m ? `${c.id}:${m.from}` : c.id} c={c} move={m} now={now} />;
          })
        )}
      </ul>
    </section>
  );
}

const LABEL_STYLE: Record<string, string> = {
  bug: "border-destructive/40 text-destructive",
  qa: cn("border-st-needs/40", NEEDS_INK),
};

function CardItem({ c, move, now }: { c: Card; move: Move | undefined; now: number }) {
  const stale = claimStale(c, now);
  const who = c.claim ? roomRole(c.claim.room) : null;
  return (
    <li
      data-moved={move ? "" : undefined}
      className={cn(
        "rounded-lg border bg-card px-2.5 py-2",
        // State-driven: only a card whose lane changed in the latest poll; reduced motion keeps the ring, drops the flash.
        move && "ring-2 ring-brand-ink/45 motion-safe:animate-[hq-card-moved_1.4s_cubic-bezier(0.22,1,0.36,1)]",
      )}
    >
      {move && (
        <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand-ink">
          <ArrowRightIcon className="size-3" aria-hidden />
          vừa chuyển từ {laneLabel(move.from)}
        </p>
      )}
      <p className="text-[13px] leading-snug text-pretty">
        <span className="mr-1 font-mono text-[11px] text-muted-foreground">#{c.id}</span>
        {c.text}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {c.label && <span className={cn("rounded border px-1 leading-4", LABEL_STYLE[c.label])}>{c.label}</span>}
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
          <span className="inline-flex items-center gap-0.5">
            <GitPullRequestIcon className="size-3" aria-hidden />
            {c.pr.replace(/^#/, "")}
          </span>
        )}
        {c.sha && <span className="font-mono">{c.sha.slice(0, 7)}</span>}
        {c.bounces > 0 && (
          <span className="inline-flex items-center gap-0.5" title={`bị trả về ${c.bounces} lần`}>
            <Undo2Icon className="size-3" aria-hidden />
            {c.bounces}
          </span>
        )}
        {!c.check && c.lane !== "backlog" && <span className="text-destructive">chưa có lệnh check</span>}
      </div>
      {c.note && (
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground" title={c.note.text}>
          {c.note.room && <span className="font-medium text-foreground">{c.note.room}: </span>}
          {c.note.text}
          {c.note.at > 0 && <span className="tabular"> · {agoVi(c.note.at, now)}</span>}
        </p>
      )}
    </li>
  );
}
