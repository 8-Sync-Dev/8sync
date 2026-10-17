"use client";

import { BotIcon, CircleAlertIcon, MessageSquareIcon, ScrollTextIcon, UsersIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { agoShort, agoVi } from "@/lib/now";
import type { ActivityEvent } from "@/lib/server/activity";
import { cn } from "@/lib/utils";
import { ErrorNote } from "./bits";
import { makeApi } from "./use-hq";

const POLL_MS = 4000;
/** A line longer than this folds; the rest opens on demand. */
const FOLD = 140;

const KIND_ICON: Record<ActivityEvent["kind"], LucideIcon> = { prompt: MessageSquareIcon, text: BotIcon, tool: WrenchIcon, agent: UsersIcon };
const KIND_VI: Record<ActivityEvent["kind"], string> = { prompt: "Lời nhắn", text: "Claude", tool: "Công cụ", agent: "Subagent" };

/** GET the room's activity every 4 s while the tab is visible. */
function useActivity(token: string, sessionId: string) {
  const [data, setData] = useState<{ events: ActivityEvent[]; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!document.hidden) {
        try {
          setData(await makeApi(token)<{ events: ActivityEvent[]; at: number }>(`/api/sessions/${encodeURIComponent(sessionId)}/activity`, { signal: ac.signal }));
          setError(null);
        } catch (e) {
          if (!ac.signal.aborted) setError((e as Error).message);
        }
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    const onShow = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", onShow);
    void load();
    return () => {
      ac.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [token, sessionId, tick]);
  return { data, error, retry: useCallback(() => setTick((t) => t + 1), []) };
}

/**
 * "Nhật ký": what the room did lately, one line per prompt, reply, tool call and subagent, newest at the
 * bottom. Follows new lines unless the owner scrolled up to read. `onFull` opens its terminal.
 */
export function RoomLog({ sessionId, token, onFull }: { sessionId: string; token: string; onFull?: () => void }) {
  const { data, error, retry } = useActivity(token, sessionId);
  return (
    <section aria-labelledby="room-log" className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 id="room-log" className="flex items-center gap-1.5 text-sm font-semibold">
          <ScrollTextIcon aria-hidden className="size-4 text-muted-foreground" />
          Nhật ký
        </h3>
        {data && <span className="text-xs text-muted-foreground tabular">{data.events.length} việc gần nhất</span>}
        {onFull && (
          <button type="button" onClick={onFull} className="ml-auto rounded-sm text-xs font-medium text-brand-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 dark:text-brand">
            Mở log đầy đủ
          </button>
        )}
      </div>
      {error && !data ? (
        <ErrorNote what="nhật ký" error={error} onRetry={retry} />
      ) : !data ? (
        <div className="space-y-2 rounded-lg border p-3" aria-busy="true" aria-label="Đang tải nhật ký">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ) : (
        <LogLines events={data.events} now={data.at} />
      )}
    </section>
  );
}

/** The scrolling list. Pinned to the bottom while the owner is there; reading older lines stops the follow. */
export function LogLines({ events, now }: { events: ActivityEvent[]; now: number }) {
  const box = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [events]);
  if (!events.length) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-pretty text-muted-foreground">
        Chưa có gì trong nhật ký: phòng chưa làm việc nào, hoặc transcript của nó không nằm trên máy này.
      </p>
    );
  }
  return (
    <ol
      ref={box}
      tabIndex={0}
      aria-label="Nhật ký phòng, mới nhất ở cuối"
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="max-h-80 divide-y divide-border/60 overflow-y-auto rounded-lg border text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {events.map((ev, i) => (
        <LogLine key={`${ev.at ?? 0}-${i}`} ev={ev} now={now} />
      ))}
    </ol>
  );
}

function LogLine({ ev, now }: { ev: ActivityEvent; now: number }) {
  const Icon = ev.status === "error" ? CircleAlertIcon : KIND_ICON[ev.kind];
  const head = ev.tool ? (ev.text ? `${ev.tool}: ${ev.text}` : ev.tool) : ev.text;
  const long = head.length > FOLD || !!ev.error;
  const ink = ev.status === "error" ? "text-destructive" : ev.kind === "prompt" ? "text-foreground" : ev.kind === "text" ? "text-foreground" : "text-muted-foreground";
  const time = (
    <time className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground tabular" title={ev.at ? agoVi(ev.at, now) : undefined} dateTime={ev.at ? new Date(ev.at).toISOString() : undefined}>
      {agoShort(ev.at, now)}
    </time>
  );
  const icon = <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", ev.status === "error" ? "text-destructive" : "text-muted-foreground")} />;
  const label = (
    <span className="sr-only">
      {KIND_VI[ev.kind]}
      {ev.status === "error" ? ", lỗi" : ev.status === "pending" ? ", đang chạy" : ""}:{" "}
    </span>
  );
  return (
    <li className={cn("px-3 py-1.5", ev.kind === "prompt" && "bg-owner/60")}>
      {long ? (
        <details className="group/log">
          <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
            {icon}
            {label}
            <span className={cn("min-w-0 flex-1 truncate group-open/log:whitespace-normal", ink, ev.kind === "tool" && ev.tool && "font-mono text-xs")}>{head}</span>
            {time}
          </summary>
          {ev.error && <p className="mt-1 ml-5.5 font-mono text-xs break-words text-destructive">{ev.error}</p>}
        </details>
      ) : (
        <div className="flex items-start gap-2">
          {icon}
          {label}
          <span className={cn("min-w-0 flex-1", ink, ev.kind === "tool" && "font-mono text-xs")}>
            {head}
            {ev.status === "pending" && <span className="ml-1.5 font-sans text-[11px] text-st-running">đang chạy</span>}
          </span>
          {time}
        </div>
      )}
    </li>
  );
}
