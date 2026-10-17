"use client";

import { CoffeeIcon, HandIcon, HourglassIcon, OctagonAlertIcon, PauseIcon, type LucideIcon } from "lucide-react";
import { LANES } from "@/lib/lanes";
import { NOW_LABEL, agoVi, spanVi, type NowState, type RoomNow } from "@/lib/now";
import { modelShort } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { RoleIcon } from "./role-badge";

/** Amber that passes AA as text on light surfaces (same mix as idle-chip / lanes-view). */
const NEEDS_INK = "text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs";

const STATE_ICON: Record<Exclude<NowState, "working">, LucideIcon> = {
  needs: HandIcon,
  blocked: OctagonAlertIcon,
  holding: PauseIcon,
  waiting: HourglassIcon,
  idle: CoffeeIcon,
};

const STATE_INK: Record<NowState, string> = {
  needs: NEEDS_INK,
  blocked: "text-destructive",
  working: "text-st-running",
  holding: "text-muted-foreground",
  waiting: "text-muted-foreground",
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

function StateTag({ n }: { n: RoomNow }) {
  const Icon = n.state === "working" ? null : STATE_ICON[n.state];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium", STATE_INK[n.state])}>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : <WorkingMark />}
      <span className="truncate">{NOW_LABEL[n.state]}</span>
    </span>
  );
}

const laneLabel = (k: string) => LANES.find((l) => l.key === k)?.label ?? k;

export type RosterRow = RoomNow & { key: string; model: string | null; waiting: string | null };

/**
 * "Đang làm gì": one line per room in attention order (needs the owner, blocked, working, then free).
 * Every state is an icon + words; colour only reinforces it. A row whose state just changed flashes once.
 */
export function NowRoster({
  rows,
  now,
  changed,
  onOpen,
  boardError,
}: {
  rows: RosterRow[];
  now: number;
  /** Rooms whose state changed in the latest poll. */
  changed: Set<string>;
  onOpen: (key: string) => void;
  /** The board could not be read: cards are unknown, not "none". */
  boardError: string | null;
}) {
  return (
    <section aria-labelledby="now-roster" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="now-roster" className="text-base font-semibold tracking-tight">
          Đang làm gì
        </h2>
        {boardError && <p className="text-xs text-muted-foreground">Không đọc được board ({boardError}): card đang giữ chưa rõ.</p>}
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {rows.map((n) => (
          // A changed row remounts under a new key, so its one flash replays on every real change.
          <li key={changed.has(n.key) ? `${n.key}:${n.state}` : n.key} data-state={n.state}>
            <button
              type="button"
              onClick={() => onOpen(n.key)}
              className={cn(
                "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                "md:grid-cols-[9.5rem_11rem_minmax(0,1.1fr)_minmax(0,1fr)] md:items-center",
                n.state === "needs" && "bg-st-needs/8",
                n.state === "blocked" && "bg-destructive/6",
                changed.has(n.key) && "motion-safe:animate-[hq-row-changed_1.4s_cubic-bezier(0.22,1,0.36,1)]",
              )}
            >
              {/* Mobile: state + room on one line, time at the right; md+: four columns. */}
              <span className="flex min-w-0 items-center gap-3 md:contents">
                <StateTag n={n} />
                <span className="flex min-w-0 items-center gap-1.5 md:order-none">
                  <RoleIcon role={n.role} className="size-3.5 text-muted-foreground" />
                  <span className="truncate text-sm font-semibold">{n.label}</span>
                  {n.model && <span className="shrink-0 text-xs text-muted-foreground">{modelShort(n.model)}</span>}
                </span>
              </span>
              <span className={cn("text-right text-xs text-muted-foreground tabular md:hidden", n.flagged && cn("font-medium", NEEDS_INK))}>
                {rowTime(n, now)}
              </span>
              <span className="col-span-2 min-w-0 truncate text-[13px] md:col-span-1">
                {n.card ? (
                  <>
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">#{n.card.id}</span>
                    <span title={n.card.text}>{n.card.text}</span>
                    <span className="ml-2 rounded-sm bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">{laneLabel(n.card.lane)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{n.state === "needs" && n.waiting ? n.waiting : "Không giữ card"}</span>
                )}
              </span>
              <span className="col-span-2 flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground md:col-span-1">
                <span className="min-w-0 truncate" title={n.last?.text}>
                  {n.state === "needs" && n.waiting && n.card ? n.waiting : (n.last?.text ?? "")}
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
  if (n.flagged && n.quietMs != null) return `${n.state === "waiting" ? "chờ" : "rảnh"} ${spanVi(n.quietMs)}`;
  return agoVi(n.last?.at, now);
}
