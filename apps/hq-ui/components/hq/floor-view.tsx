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
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { isOldIdle, sortFloor, type FloorRow, type FloorState } from "@/lib/floor";
import { EmptyState, ErrorNote } from "./bits";
import { SpriteCanvas } from "./sprite-canvas";

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

function Desk({ row, onSelect }: { row: FloorRow; onSelect: (name: string) => void }) {
  const Icon = ICON[row.state];
  const alert = row.state === "waiting" ? "border-st-needs" : row.state === "stalled" ? "border-destructive" : "";
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.name)}
        className={cn(
          "flex w-full flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          alert,
        )}
      >
        <span className="flex justify-center rounded-lg bg-[oklch(0.22_0.012_260)] py-2">
          <SpriteCanvas state={row.state} shirtKey={row.name} size={96} />
        </span>
        <span className="truncate text-sm font-medium" title={row.title}>
          {row.title}
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              row.state === "waiting" && "text-st-needs",
              row.state === "stalled" && "text-destructive",
              row.state !== "waiting" && row.state !== "stalled" && "text-muted-foreground",
            )}
            aria-hidden
          />
          <span className="font-medium">{row.label}</span>
          {row.progress && <span className="ml-auto text-muted-foreground tabular">{row.progress}</span>}
        </span>
        <span className="truncate text-xs text-muted-foreground" title={row.caption}>
          {row.caption || " "}
        </span>
      </button>
    </li>
  );
}

const Grid = ({ rows, onSelect }: { rows: FloorRow[]; onSelect: (n: string) => void }) => (
  <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
    {rows.map((r) => (
      <Desk key={r.id} row={r} onSelect={onSelect} />
    ))}
  </ul>
);

export function FloorView({
  token,
  onSelect,
  onStart,
}: {
  token: string;
  onSelect: (name: string) => void;
  onStart: () => void;
}) {
  const { rows, at, error, retry } = useFloor(token);
  const { active, old } = useMemo(() => {
    const sorted = sortFloor(rows ?? []);
    return { active: sorted.filter((r) => !isOldIdle(r, at)), old: sorted.filter((r) => isOldIdle(r, at)) };
  }, [rows, at]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-4 sm:px-6">
        {error && rows === null ? (
          <ErrorNote what="văn phòng" error={error} onRetry={retry} />
        ) : rows === null ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
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
            <Grid rows={active} onSelect={onSelect} />
            {old.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  Nghỉ lâu ({old.length})
                </summary>
                <div className="mt-3">
                  <Grid rows={old} onSelect={onSelect} />
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
