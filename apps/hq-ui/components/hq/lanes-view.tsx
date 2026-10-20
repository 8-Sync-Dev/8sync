"use client";

import { ArrowRightIcon, CheckIcon, ChevronsLeftIcon, ChevronsRightIcon, GitPullRequestIcon, LayersIcon, ListTreeIcon, OctagonAlertIcon, RefreshCwIcon, ShipIcon, Undo2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cardParts, type Kid, nextUp, prRef, splitInto } from "@/lib/card-tags";
import { LANES, boardSummary, claimStale, openCount, rankOf, type Card, type Closed, type LaneKey } from "@/lib/lanes";
import { agoShort, agoVi, roomRole, type Move } from "@/lib/now";
import { rootKey } from "@/lib/preview";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { CardSheet, LabelChip, PrioChip, TagChips, TONE_INK, laneTone } from "./card-sheet";
import { RoleIcon } from "./role-badge";
import { LaneStrip } from "./scroll-strip";
import type { BoardsState } from "./use-board";

/** The project board (`8sync ccc auto board`): which room holds which card, lane by lane. */
export function LanesView({ state, focus }: { state: BoardsState; focus?: { root: string; id: number; n: number } | null }) {
  const { boards, error, moves, at: now, reload: load } = state;
  const [pick, setPick] = useState<string | null>(null);
  // The open card by id, so each poll shows its latest state; the snapshot keeps the sheet filled while it closes.
  const [open, setOpen] = useState<{ root: string; card: Card } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [doneWide, setDoneWide] = useState(false);
  const lanesRef = useRef<HTMLDivElement>(null);

  // "Mở card" from another tab (Preview, Tổng quan): pick that project and open the card once the board has it.
  // Adjusted during render (not in an effect), the React way to react to a changed prop.
  const [handled, setHandled] = useState(0);
  if (focus && focus.n !== handled && boards) {
    const k = rootKey(focus.root);
    const b = boards.find((x) => rootKey(x.root) === k || (x.filed != null && rootKey(x.filed) === k));
    const c = b?.board ? LANES.flatMap((l) => b.board!.lanes[l.key]).find((x) => x.id === focus.id) : undefined;
    setHandled(focus.n);
    if (b) setPick(b.root);
    if (b && c) {
      setOpen({ root: b.root, card: c });
      setSheetOpen(true);
    }
  }

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
  const kids = cur?.board ? splitInto(cur.board.lanes) : null;
  const live = open ? boards?.find((b) => b.root === open.root)?.board : null;
  const shown = open ? ((live ? LANES.flatMap((l) => live.lanes[l.key]).find((c) => c.id === open.card.id) : undefined) ?? open.card) : null;
  const onOpenCard = (c: Card) => {
    if (!cur) return;
    setOpen({ root: cur.root, card: c });
    setSheetOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 max-md:py-1.5 sm:px-6">
        {list.length > 1 ? (
          <Select value={cur?.root ?? ""} onValueChange={setPick}>
            <SelectTrigger size="sm" className="max-w-64 text-xs max-md:min-w-0 max-md:flex-1 max-sm:h-11" aria-label="Dự án">
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
        {/* Phones: project and reload share the first line, the summary takes the next (order-last + basis-full). */}
        <span className="text-xs text-muted-foreground max-md:order-last max-md:basis-full">{cur?.board ? boardSummary(cur.board) : (cur?.error ?? "")}</span>
        {/* Announced once per poll that moved a card; the moved cards carry the same text. */}
        <span role="status" className="min-w-0 truncate text-xs font-medium text-brand-ink max-md:order-last max-md:basis-full max-md:empty:sr-only">
          {movedHere.length > 0 && `Vừa chuyển: ${movedHere.map((m) => `#${m.id} ${laneLabel(m.from)} → ${laneLabel(m.to)}`).join(" · ")}`}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto max-sm:size-11 max-sm:-mr-2" onClick={() => void load()} aria-label="Tải lại board">
          <RefreshCwIcon />
        </Button>
      </div>
      {cur?.error && !cur.board ? (
        <div className="p-4 sm:px-6">
          <ErrorNote what={`board của ${cur.name}`} error={cur.error} onRetry={load} />
        </div>
      ) : (
        <>
          {/* Phones: one lane per screen; the strip names every lane with its count and jumps to it. */}
          <LaneStrip
            scroller={lanesRef}
            label="Cột board"
            className="border-b md:hidden"
            items={LANES.flatMap((l) => {
              const item = { key: l.key, label: l.label, count: cur?.board ? cur.board.lanes[l.key].length : null, style: laneTone(l.key) };
              return l.key === "blocked" ? [{ key: "done", label: "Done", count: cur?.board?.closed ? cur.board.closed.length : null }, item] : [item];
            })}
          />
          <div ref={lanesRef} className="relative min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 overflow-x-auto overflow-y-hidden md:snap-none">
            {/* Done sits between Approved and Blocked: where an approved card goes once merged. Narrow until opened. */}
            {/* Phones: a lane is 88vw so the next one peeks in; 640-767 px (no sidebar yet): two lanes side by side. */}
            <div
              className={cn(
                "grid h-full grid-cols-[repeat(8,88vw)] gap-2.5 px-4 py-3 sm:grid-cols-[repeat(8,minmax(17rem,1fr))] sm:px-6 md:py-4",
                doneWide ? "md:grid-cols-[repeat(6,minmax(10.5rem,1fr))_minmax(15rem,1.3fr)_minmax(10.5rem,1fr)]" : "md:grid-cols-[repeat(6,minmax(10.5rem,1fr))_8.5rem_minmax(10.5rem,1fr)]",
              )}
            >
              {LANES.flatMap((l) => {
                const lane = <Lane key={l.key} lane={l.key} label={l.label} hint={l.hint} cards={cur?.board?.lanes[l.key] ?? null} moveOf={moveOf} kidsOf={(id) => kids?.get(id)} now={now} next={next} onOpen={onOpenCard} />;
                return l.key === "blocked" ? [<DoneLane key="done" closed={cur?.board?.closed ?? null} now={now} wide={doneWide} onWide={setDoneWide} />, lane] : [lane];
              })}
            </div>
          </div>
        </>
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

/** Closed cards the board still lists (the CLI keeps the last 10): one line each, evidence on hover or when widened. */
function DoneLane({ closed, now, wide, onWide }: { closed: Closed[] | null; now: number; wide: boolean; onWide: (v: boolean) => void }) {
  const done = closed?.filter((c) => c.state === "done").length ?? 0;
  return (
    <section aria-labelledby="lane-done" data-lane="done" className="flex min-h-0 snap-start flex-col rounded-xl bg-muted/60">
      <h3 id="lane-done" className="flex items-center gap-1.5 px-3 pt-3 text-[13px] font-semibold">
        <CheckIcon aria-hidden className="size-3.5 text-st-running" strokeWidth={3} />
        <span>Done</span>
        <span className="ml-auto rounded-full bg-background px-1.5 text-[11px] font-semibold text-muted-foreground tabular">
          {closed ? closed.length : ""}
          <span className="sr-only"> card</span>
        </span>
      </h3>
      <div className="flex items-center gap-1 px-3 pt-0.5 pb-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{closed?.length ? `${done} xong gần đây` : "đã merge, đã đóng"}</p>
        <button
          type="button"
          onClick={() => onWide(!wide)}
          aria-expanded={wide}
          aria-label={wide ? "Thu hẹp cột Done" : "Mở rộng cột Done"}
          className="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 md:grid"
        >
          {wide ? <ChevronsLeftIcon className="size-3.5" aria-hidden /> : <ChevronsRightIcon className="size-3.5" aria-hidden />}
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
        {closed === null ? (
          <li>
            <Skeleton className="h-10 rounded-md" />
          </li>
        ) : closed.length === 0 ? (
          <li className="px-1.5 py-3 text-center text-[11px] text-muted-foreground">Chưa có</li>
        ) : (
          closed.map((c) => {
            const { title } = cardParts(c.text);
            const ev = c.evidence ? (c.evidence.length > 60 ? `${c.evidence.slice(0, 60)}…` : c.evidence) : null;
            const dropped = c.state === "dropped";
            return (
              <li
                key={c.id}
                title={`#${c.id} ${title}\n${dropped ? "bỏ" : "xong"} ${agoVi(c.at, now)}${c.by ? ` · ${c.by}` : ""}${c.evidence ? `\n${c.evidence}` : ""}`}
                className={cn("rounded-md px-1.5 py-1 text-[12px] leading-tight hover:bg-background", dropped && "text-muted-foreground")}
              >
                <span className="flex min-w-0 items-baseline gap-1">
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{c.id}</span>
                  <span className={cn("truncate", dropped && "line-through decoration-muted-foreground/50")}>{title}</span>
                </span>
                <span className="block truncate text-[11px] text-muted-foreground tabular">
                  {dropped ? "bỏ" : "xong"} {agoShort(c.at, now)}
                  {wide && ev && <span className="font-mono"> · {ev}</span>}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </section>
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
  kidsOf,
  now,
  next,
  onOpen,
}: {
  lane: LaneKey;
  label: string;
  hint: string;
  cards: Card[] | null;
  moveOf: (id: number) => Move | undefined;
  kidsOf: (id: number) => Kid[] | undefined;
  now: number;
  next: number | null;
  onOpen: (c: Card) => void;
}) {
  const n = cards?.length ?? 0;
  // Ship waits on the owner, Blocked on the lead (it clears them first): both are tinted harder and say so in the header.
  const loud = (lane === "approved" || lane === "blocked") && n > 0;
  return (
    <section
      aria-labelledby={`lane-${lane}`}
      data-lane={lane}
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
            return <CardItem key={m ? `${c.id}:${m.from}` : c.id} c={c} move={m} kids={kidsOf(c.id)} now={now} next={c.id === next && lane === "ready"} onOpen={onOpen} />;
          })
        )}
      </ul>
    </section>
  );
}

/** One card: its chips, the title in up to 3 lines, who holds it, PR, bounces, the cards split off it, a missing check, the last note. A click opens the sheet. */
export function CardItem({ c, move, kids, now, next, onOpen }: { c: Card; move?: Move; kids?: Kid[]; now: number; next: boolean; onOpen: (c: Card) => void }) {
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
          {kids && kids.length > 0 && (
            // An idea split into cards waits in Backlog on purpose (not stuck): owner 2026-10-20 read
            // "đang làm qua #64 #65 … #46" as a hung card.
            <span
              className="inline-flex items-center gap-0.5 text-foreground"
              title={`Ý lớn, không treo: team đang làm nó qua ${kids.length} card con ${kids.map((k) => `#${k.id}`).join(" ")}; lead tách tiếp khi ready cạn và nghiệm thu khi chúng xong`}
            >
              <ListTreeIcon className="size-3" aria-hidden />
              {kidsLine(kids)}
            </span>
          )}
          {noCheck && <span className="font-medium text-destructive">thiếu lệnh check</span>}
        </span>
        {c.note && (
          <span className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
            {c.note.room && <span className="font-medium text-foreground">{c.note.room}: </span>}
            {c.note.text}
            {c.note.at > 0 && <span className="tabular"> · {agoShort(c.note.at, now)}</span>}
          </span>
        )}
      </button>
    </li>
  );
}

/** "13 card con đang chạy · 4 đang build/QA" for an idea's open split-off cards. */
export function kidsLine(kids: Kid[]): string {
  const active = kids.filter((k) => ["building", "qa", "review", "approved"].includes(k.lane)).length;
  return `${kids.length} card con đang chạy${active ? ` · ${active} đang build/QA` : ""}`;
}
