"use client";

// The "Nội dung" calendar (owner 2026-11-04: "lịch kiểu Notion"): Ngày / Tuần / Tháng / Năm over
// `content_items`, placed by `scheduled_at` (else `published_at`). A day opens the sheet; a chip
// opens the sheet on that item.
import { UserRoundIcon } from "lucide-react";
import { useMemo } from "react";
import { addDays, aiReason, dayKey, FORMAT_LABEL, monthGrid, STATUS_LABEL, timeOf, weekStart, whenOf, type CalendarMode, type ContentRow } from "@/lib/content";
import { cn } from "@/lib/utils";
import { assigneeShort, FORMAT_DOT, FORMAT_TONE, STATUS_EDGE, StatusIcon } from "./content-bits";

export const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
/** By `Date.getDay()` (0 = Sunday). */
export const DAY_NAMES = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => `Tháng ${i + 1}`);
/** Chips a month cell shows before "+N". */
const CELL_CHIPS = 3;

/** The period the toolbar names. */
export function periodLabel(mode: CalendarMode, d: Date): string {
  if (mode === "year") return String(d.getFullYear());
  if (mode === "month") return `${MONTH_NAMES[d.getMonth()]}, ${d.getFullYear()}`;
  if (mode === "day") return `${DAY_NAMES[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  const a = weekStart(d);
  const b = addDays(a, 6);
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()}/${b.getMonth() + 1}/${b.getFullYear()}` : `${a.getDate()}/${a.getMonth() + 1} – ${b.getDate()}/${b.getMonth() + 1}/${b.getFullYear()}`;
}

const chipTitle = (it: ContentRow) =>
  [
    `#${it.id} ${it.title}`,
    `${FORMAT_LABEL[it.format]} · ${STATUS_LABEL[it.status]}`,
    it.assignee_session ? `đang xử lý: ${it.assignee_base ?? it.assignee_session}` : null,
    aiReason(it) ? `rủi ro nhãn AI: ${aiReason(it)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

/** One item on the calendar: format hue, status edge, time, title and who holds it. */
export function Chip({ it, onOpen, wide = false }: { it: ContentRow; onOpen: (it: ContentRow) => void; wide?: boolean }) {
  const at = whenOf(it);
  const who = assigneeShort(it);
  return (
    <button
      type="button"
      title={chipTitle(it)}
      aria-label={`${at != null ? `${timeOf(at)}, ` : ""}${it.title}, ${FORMAT_LABEL[it.format]}, ${STATUS_LABEL[it.status]}${who ? `, đang xử lý: ${it.assignee_base ?? who}` : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(it);
      }}
      className={cn(
        "flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md px-1.5 py-0.5 text-left text-[11px] leading-4 outline-none transition-[filter] duration-150 hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none dark:hover:brightness-125",
        FORMAT_TONE[it.format],
        STATUS_EDGE[it.status],
        wide && "py-1 text-xs",
      )}
    >
      <StatusIcon status={it.status} />
      {at != null && <span className="shrink-0 font-mono tabular-nums opacity-80">{timeOf(at)}</span>}
      <span className={cn("min-w-0 flex-1 truncate font-medium", it.status === "rejected" && "line-through")}>{it.title}</span>
      {who && (
        // Narrow cells: the holder gets its own line so the title keeps the width.
        <span className={cn("inline-flex min-w-0 items-center gap-0.5 rounded bg-background/70 px-1 text-[10px] font-normal text-foreground", wide ? "max-w-60 shrink-0" : "basis-full")}>
          <UserRoundIcon aria-hidden className="size-2.5 shrink-0" />
          <span className="truncate">đang xử lý: {wide ? (it.assignee_base ?? who) : who}</span>
        </span>
      )}
    </button>
  );
}

type Open = { day: (key: string) => void; item: (it: ContentRow) => void };

export function ContentCalendar({ mode, cursor, days, today, open, onMonth }: { mode: CalendarMode; cursor: Date; days: Map<string, ContentRow[]>; today: string; open: Open; onMonth: (d: Date) => void }) {
  if (mode === "month") return <Month cursor={cursor} days={days} today={today} open={open} />;
  if (mode === "week") return <Week cursor={cursor} days={days} today={today} open={open} />;
  if (mode === "day") return <Day cursor={cursor} days={days} open={open} />;
  return <Year cursor={cursor} days={days} today={today} open={open} onMonth={onMonth} />;
}

function DayNumber({ d, today, out = false, onOpen }: { d: Date; today: string; out?: boolean; onOpen: () => void }) {
  const isToday = dayKey(d) === today;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`Mở ngày ${d.getDate()}/${d.getMonth() + 1}`}
      aria-current={isToday ? "date" : undefined}
      className={cn(
        "grid size-6 place-items-center rounded-full text-xs tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-8",
        out && "text-muted-foreground",
        isToday && "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
      )}
    >
      {d.getDate()}
    </button>
  );
}

function Month({ cursor, days, today, open }: { cursor: Date; days: Map<string, ContentRow[]>; today: string; open: Open }) {
  const grid = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-[11px] text-muted-foreground" aria-hidden>
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1 font-medium">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 [&>*:not(:nth-child(7n))]:border-r [&>*:nth-child(n+8)]:border-t">
        {grid.map((d) => {
          const k = dayKey(d);
          const items = days.get(k) ?? [];
          const out = d.getMonth() !== cursor.getMonth();
          return (
            <div
              key={k}
              onClick={() => open.day(k)}
              className={cn("group/cell flex min-h-24 min-w-0 cursor-pointer flex-col gap-0.5 p-1 hover:bg-accent/40 sm:min-h-28", out && "bg-muted/25")}
            >
              <div className="flex items-center justify-between">
                <DayNumber d={d} today={today} out={out} onOpen={() => open.day(k)} />
                {items.length > 0 && <span className="pr-1 text-[10px] text-muted-foreground tabular-nums sm:hidden">{items.length}</span>}
              </div>
              {/* Phones: one dot per item (the sheet carries the words). */}
              <div className="flex flex-wrap gap-0.5 px-1 sm:hidden" aria-hidden>
                {items.slice(0, 6).map((it) => (
                  <span key={it.id} className={cn("size-1.5 rounded-full", FORMAT_DOT[it.format])} />
                ))}
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 max-sm:hidden">
                {items.slice(0, CELL_CHIPS).map((it) => (
                  <Chip key={it.id} it={it} onOpen={open.item} />
                ))}
                {items.length > CELL_CHIPS && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      open.day(k);
                    }}
                    className="rounded px-1.5 text-left text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    +{items.length - CELL_CHIPS} bài nữa
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Week({ cursor, days, today, open }: { cursor: Date; days: Map<string, ContentRow[]>; today: string; open: Open }) {
  const start = weekStart(cursor);
  return (
    <div className="grid overflow-hidden rounded-lg border sm:grid-cols-7 max-sm:divide-y sm:[&>*:not(:last-child)]:border-r">
      {WEEKDAYS.map((w, i) => {
        const d = addDays(start, i);
        const k = dayKey(d);
        const items = days.get(k) ?? [];
        return (
          <section key={k} aria-label={`${w} ${d.getDate()}/${d.getMonth() + 1}`} onClick={() => open.day(k)} className="flex min-h-20 min-w-0 cursor-pointer flex-col gap-1 p-1.5 hover:bg-accent/30 sm:min-h-72">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium">{w}</span>
              <DayNumber d={d} today={today} onOpen={() => open.day(k)} />
            </div>
            {items.map((it) => (
              <Chip key={it.id} it={it} onOpen={open.item} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Day({ cursor, days, open }: { cursor: Date; days: Map<string, ContentRow[]>; open: Open }) {
  const k = dayKey(cursor);
  const items = days.get(k) ?? [];
  if (items.length === 0)
    return (
      <div className="rounded-lg border px-3 py-6 text-center text-xs text-muted-foreground">
        Không có bài nào ngày này.{" "}
        <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => open.day(k)}>
          Mở ngày
        </button>
      </div>
    );
  return (
    <ol className="space-y-1.5 rounded-lg border p-2" aria-label="Bài trong ngày">
      {items.map((it) => (
        <li key={it.id}>
          <Chip it={it} onOpen={open.item} wide />
        </li>
      ))}
    </ol>
  );
}

function Year({ cursor, days, today, open, onMonth }: { cursor: Date; days: Map<string, ContentRow[]>; today: string; open: Open; onMonth: (d: Date) => void }) {
  const year = cursor.getFullYear();
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
      {MONTH_NAMES.map((name, m) => {
        const first = new Date(year, m, 1);
        const lead = (first.getDay() + 6) % 7;
        const count = new Date(year, m + 1, 0).getDate();
        return (
          <section key={name} aria-label={`${name}, ${year}`} className="rounded-lg border p-2">
            <button type="button" className="mb-1 rounded px-1 text-xs font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60" onClick={() => onMonth(first)}>
              {name}
            </button>
            <div className="grid grid-cols-7 gap-px text-center text-[10px]">
              {WEEKDAYS.map((w) => (
                <span key={w} aria-hidden className="text-muted-foreground">
                  {w}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`l${i}`} aria-hidden />
              ))}
              {Array.from({ length: count }, (_, i) => {
                const d = new Date(year, m, i + 1);
                const k = dayKey(d);
                const items = days.get(k) ?? [];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => open.day(k)}
                    aria-label={`${i + 1}/${m + 1}: ${items.length ? `${items.length} bài` : "trống"}`}
                    className={cn(
                      "relative grid aspect-square place-items-center rounded tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
                      items.length > 0 && "bg-primary/10 font-semibold",
                      k === today && "ring-1 ring-primary",
                    )}
                  >
                    {i + 1}
                    {items.length > 0 && <span aria-hidden className={cn("absolute bottom-0.5 size-1 rounded-full", FORMAT_DOT[items[0].format])} />}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
