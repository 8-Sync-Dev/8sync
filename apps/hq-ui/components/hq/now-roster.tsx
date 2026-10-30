"use client";

import { CoffeeIcon, HandIcon, type LucideIcon } from "lucide-react";
import { NOW_LABEL, agoVi, spanVi, type NowState, type RoomNow } from "@/lib/now";
import { cn } from "@/lib/utils";
import { RoleIcon } from "./role-badge";

/** Amber that passes AA as text on light surfaces (same mix as nav / ask-panel). */
const NEEDS_INK = "text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs";

const STATE_ICON: Record<Exclude<NowState, "working">, LucideIcon> = {
  needs: HandIcon,
  idle: CoffeeIcon,
};

const STATE_INK: Record<NowState, string> = {
  needs: NEEDS_INK,
  working: "text-st-running",
  idle: "text-muted-foreground",
};

/** Working is the only state that moves: three dots typing, because the session is typing right now. */
function WorkingMark() {
  return (
    <span aria-hidden className="flex h-3.5 w-3.5 shrink-0 items-center justify-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-[3px] rounded-full bg-st-running motion-safe:animate-[hq-typing_1.1s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

export function StateTag({ n }: { n: RoomNow }) {
  const Icon = n.state === "working" ? null : STATE_ICON[n.state];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium", STATE_INK[n.state])}>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : <WorkingMark />}
      <span className="truncate">{NOW_LABEL[n.state]}</span>
    </span>
  );
}

/** `modelLabel`: lib/roles.ts roomModelLabel of the room. */
export type RosterRow = RoomNow & { key: string; modelLabel: string | null; waiting: string | null };

/**
 * "Đang làm gì": one line per room in attention order (needs the owner, working, then free).
 * Every state is an icon + words; colour only reinforces it. A row whose state just changed flashes once.
 */
export function NowRoster({
  rows,
  now,
  changed,
  onOpen,
}: {
  rows: RosterRow[];
  now: number;
  /** Rooms whose state changed in the latest poll. */
  changed: Set<string>;
  onOpen: (key: string) => void;
}) {
  return (
    <section aria-labelledby="now-roster" className="space-y-2">
      <h2 id="now-roster" className="text-base font-semibold tracking-tight">
        Đang làm gì
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {rows.map((n) => (
          // A changed row remounts under a new key, so its one flash replays on every real change.
          <li key={changed.has(n.key) ? `${n.key}:${n.state}` : n.key} data-state={n.state}>
            <button
              type="button"
              onClick={() => onOpen(n.key)}
              className={cn(
                "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                "md:grid-cols-[9.5rem_11rem_minmax(0,1fr)] md:items-center",
                n.state === "needs" && "bg-st-needs/8",
                changed.has(n.key) && "motion-safe:animate-[hq-row-changed_1.4s_cubic-bezier(0.22,1,0.36,1)]",
              )}
            >
              {/* Mobile: state + room on one line, time at the right; md+: three columns. */}
              <span className="flex min-w-0 items-center gap-3 md:contents">
                <StateTag n={n} />
                <span className="flex min-w-0 items-center gap-1.5 md:order-none">
                  <RoleIcon role={n.role} className="size-3.5 text-muted-foreground" />
                  <span className="truncate text-sm font-semibold">{n.label}</span>
                  {n.modelLabel && <span className="shrink-0 text-xs text-muted-foreground">{n.modelLabel}</span>}
                </span>
              </span>
              <span className={cn("text-right text-xs text-muted-foreground tabular md:hidden", n.flagged && cn("font-medium", NEEDS_INK))}>
                {rowTime(n, now)}
              </span>
              <span className="col-span-2 flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground md:col-span-1">
                <span className="min-w-0 truncate" title={n.last?.text}>
                  {n.state === "needs" && n.waiting ? n.waiting : (n.last?.text ?? "")}
                </span>
                <span className={cn("ml-auto hidden shrink-0 tabular md:inline", n.flagged && cn("font-medium", NEEDS_INK))}>{rowTime(n, now)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "rảnh 4 phút" for a quiet room, else when it last did something. */
function rowTime(n: RoomNow, now: number): string {
  if (n.flagged && n.quietMs != null) return `rảnh ${spanVi(n.quietMs)}`;
  return agoVi(n.last?.at, now);
}
