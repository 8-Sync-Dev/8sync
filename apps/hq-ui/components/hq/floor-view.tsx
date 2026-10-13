"use client";

import {
  CircleCheckIcon,
  EyeIcon,
  HandIcon,
  KeyboardIcon,
  MoonIcon,
  TerminalIcon,
  TriangleAlertIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ageLabel,
  deriveHandoffs,
  engineLabel,
  groupFloor,
  type DeskRow,
  type FloorHandoff,
  type FloorRow,
  type FloorState,
  type RepoGroup,
} from "@/lib/floor";
import { EmptyState, ErrorNote } from "./bits";
import { HandoffBubble, SpriteCanvas } from "./sprite-canvas";
import type { Message } from "./types";

const ICON: Record<FloorState, LucideIcon> = {
  idle: MoonIcon,
  typing: KeyboardIcon,
  running: TerminalIcon,
  reading: EyeIcon,
  waiting: HandIcon,
  stalled: TriangleAlertIcon,
  done: CircleCheckIcon,
};

const POLL_MS = 5000;
/** 7 x 32 px grid: crisp integer scale; the character is ~98 px tall. */
const SPRITE_PX = 224;
/** Wall/floor seam at the sprite's desk top (row 22 of 32) + the 16 px top padding. */
const SEAM_PX = 16 + Math.round((SPRITE_PX * 22) / 32);

/*
 * The room is a fixed dark scene in both themes (a game viewport), so its text
 * uses its own light inks instead of theme tokens. Pairs pass AA:
 * ink 0.97 / soft 0.82 on floor L 0.30 and wall L 0.24.
 */
const ROOM = {
  "--wall": "oklch(0.24 0.014 260)",
  "--floor": "oklch(0.3 0.018 60)",
  "--seam": "oklch(0.18 0.012 260)",
  "--ink": "oklch(0.97 0 0)",
  "--soft": "oklch(0.82 0.01 260)",
} as CSSProperties;

const DESK_BG: CSSProperties = {
  backgroundImage: `linear-gradient(to bottom, var(--wall) 0 ${SEAM_PX}px, var(--seam) ${SEAM_PX}px ${SEAM_PX + 2}px, var(--floor) ${SEAM_PX + 2}px)`,
};

/** Live handoffs (A → B) per desk name, from session_message events that arrived while the page is open. */
const PAGE_OPENED_AT = Date.now(); // only events after the page loaded animate; older ones are history
const Handoffs = createContext<Map<string, FloorHandoff>>(new Map());

function useFloor(token: string) {
  const [data, setData] = useState<{ rows: FloorRow[]; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.hidden) return schedule();
      try {
        const r = await fetch("/api/floor", { headers: { "x-hq-token": token }, signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData({ rows: ((await r.json()) as { rows: FloorRow[] }).rows, at: Date.now() });
        setError(null);
      } catch (e) {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "failed");
      }
      schedule();
    };
    const schedule = () => {
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [token, tick]);

  return { rows: data?.rows ?? null, at: data?.at ?? 0, error, retry: useCallback(() => setTick((t) => t + 1), []) };
}

function EngineBadge({ engine, scene }: { engine?: string | null; scene?: boolean }) {
  const label = engineLabel(engine);
  if (!label) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-[11px] leading-none font-medium",
        scene ? "bg-white/10 text-(--soft)" : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

/** A coworker at a desk: big sprite standing on the room's shared floor. */
function Desk({ row, onSelect }: { row: DeskRow; onSelect: (name: string) => void }) {
  const Icon = ICON[row.state];
  const waiting = row.state === "waiting";
  const stalled = row.state === "stalled";
  const handoff = useContext(Handoffs).get(row.name);
  return (
    <li className="flex min-w-0 flex-[1_1_15rem]" style={DESK_BG}>
      <button
        type="button"
        onClick={() => onSelect(row.name)}
        title={[row.title, row.caption].filter(Boolean).join("\n")}
        aria-label={`${row.who}, ${row.label}: ${row.heading}`}
        className={cn(
          "relative flex w-full min-w-0 flex-col items-center p-4 text-left transition-colors",
          "hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-(--ink)",
          waiting && "ring-2 ring-brand ring-inset",
          stalled && "ring-2 ring-destructive ring-inset",
        )}
      >
        {(waiting || stalled) && (
          <span
            className={cn(
              "absolute top-3 left-3 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold",
              waiting ? "bg-brand text-[oklch(0.22_0.06_134)]" : "bg-destructive text-white",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {waiting ? "Chờ anh" : "Kẹt"}
          </span>
        )}
        {handoff && (
          <span className="absolute top-3 right-3">
            <HandoffBubble handoff={handoff} />
          </span>
        )}
        <SpriteCanvas state={row.state} shirtKey={row.id} size={SPRITE_PX} />
        <span className="mt-3 flex w-full min-w-0 flex-col gap-1">
          <span className="truncate text-[15px] leading-snug font-semibold text-(--ink)">{row.heading}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-(--soft)">
            <span className="truncate">{row.who}</span>
            <EngineBadge engine={row.engine} scene />
            {row.progress && <span className="ml-auto shrink-0 tabular">{row.progress}</span>}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <Icon
              className={cn("size-3.5 shrink-0", waiting ? "text-brand" : stalled ? "text-destructive" : "text-(--soft)")}
              aria-hidden
            />
            <span className={cn("shrink-0 font-medium", waiting ? "text-brand" : "text-(--ink)")}>{row.label}</span>
            {row.caption && <span className="truncate text-(--soft)">{row.caption}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** One continuous room per repo: wall on top, wood floor under every desk. */
function Room({ desks, onSelect }: { desks: DeskRow[]; onSelect: (n: string) => void }) {
  return (
    <ul style={ROOM} className="flex flex-wrap overflow-hidden rounded-xl bg-(--floor)">
      {desks.map((r) => (
        <Desk key={r.id} row={r} onSelect={onSelect} />
      ))}
    </ul>
  );
}

/** Idle / done / long-idle sessions: one line each. */
function QuietList({
  rows,
  at,
  onSelect,
  showRepo,
}: {
  rows: DeskRow[];
  at: number;
  onSelect: (n: string) => void;
  showRepo?: boolean;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((r) => {
        const line = r.heading !== r.name ? r.heading : r.caption;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.name)}
              title={[r.title, r.caption].filter(Boolean).join("\n")}
              className="flex h-10 w-full min-w-0 items-center gap-2.5 px-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", r.state === "done" ? "bg-brand" : "bg-st-idle")}
              />
              <span className="max-w-[40%] shrink-0 truncate font-medium sm:max-w-56">{r.who}</span>
              <EngineBadge engine={r.engine} />
              {showRepo && r.repo && (
                <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{r.repo}</span>
              )}
              <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:block">{line}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">
                {r.label}
                {r.last_active != null && ` · ${ageLabel(r.last_active, at)}`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function RepoSection({ g, at, onSelect }: { g: RepoGroup; at: number; onSelect: (n: string) => void }) {
  const id = `repo-${(g.repo || "other").replace(/[^\w-]/g, "_")}`;
  const total = g.desks.length + g.rest.length;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {g.name}
        </h2>
        {g.repo && g.repo !== g.name && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={g.repo}>
            {g.repo}
          </span>
        )}
        <p className="ml-auto flex shrink-0 items-baseline gap-2 text-xs text-muted-foreground tabular">
          {g.needs > 0 && <span className="font-semibold text-foreground">{g.needs} cần anh</span>}
          {g.working > 0 && <span>{g.working} đang làm</span>}
          <span>{total} session</span>
        </p>
      </header>
      {g.desks.length > 0 && <Room desks={g.desks} onSelect={onSelect} />}
      {g.rest.length > 0 && <QuietList rows={g.rest} at={at} onSelect={onSelect} />}
    </section>
  );
}

function FloorSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Đang tải văn phòng">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-10 rounded-lg" />
    </div>
  );
}

export function FloorView({
  token,
  onSelect,
  onStart,
  messages = [],
}: {
  token: string;
  onSelect: (name: string) => void;
  onStart: () => void;
  /** Journal rows (useHq, live over SSE); handoffs newer than page load animate on the desks. */
  messages?: Message[];
}) {
  const { rows, at, error, retry } = useFloor(token);
  const handoffs = useMemo(() => deriveHandoffs(messages, PAGE_OPENED_AT), [messages]);
  const { groups, old } = useMemo(() => groupFloor(rows ?? [], at), [rows, at]);

  return (
    <Handoffs.Provider value={handoffs}>
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-5 sm:px-6">
        {error && rows === null ? (
          <ErrorNote what="văn phòng" error={error} onRetry={retry} />
        ) : rows === null ? (
          <FloorSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="Văn phòng đang trống"
            action={<Button onClick={onStart}>Bắt đầu một session</Button>}
          >
            Chưa có session Claude Code nào. Mở một session để thấy nó ngồi vào bàn.
          </EmptyState>
        ) : (
          <>
            {error && (
              <p role="status" className="text-xs text-muted-foreground">
                Mất kết nối ({error}), đang thử lại. Dữ liệu dưới đây có thể đã cũ.
              </p>
            )}
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Không ai ở bàn trong 24 giờ qua. Các session cũ nằm trong mục Nghỉ lâu.
              </p>
            )}
            {groups.map((g) => (
              <RepoSection key={g.repo || "other"} g={g} at={at} onSelect={onSelect} />
            ))}
            {old.length > 0 && (
              <details className="group/old">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  Nghỉ lâu ({old.length})
                </summary>
                <div className="mt-3">
                  <QuietList rows={old} at={at} onSelect={onSelect} showRepo />
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
    </Handoffs.Provider>
  );
}
