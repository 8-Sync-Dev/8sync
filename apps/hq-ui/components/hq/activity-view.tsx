"use client";

import { ActivityIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DeliveryTag, EmptyState, ErrorNote, shortName } from "./bits";
import type { Hq } from "./use-hq";
import type { Message } from "./types";

const FILTERS = [
  { key: "all", label: "All", kinds: null },
  { key: "chat", label: "Messages", kinds: ["owner_message", "session_reply", "session_message"] },
  { key: "tasks", label: "Tasks", kinds: ["task_created", "task_completed"] },
  { key: "attention", label: "Needs you", kinds: ["notification"] },
  { key: "lifecycle", label: "Sessions", kinds: ["session_start", "session_end", "teammate_idle"] },
] as const;

const KIND_LABEL: Record<string, string> = {
  owner_message: "message",
  session_reply: "reply",
  session_message: "message",
  task_created: "task +",
  task_completed: "task ✓",
  teammate_idle: "idle",
  notification: "notice",
  session_start: "start",
  session_end: "end",
};

/** Dense, newest-first log of every row: the audit trail behind the chat. */
export function ActivityView({ hq, messages }: { hq: Hq; messages: Message[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const kinds = f.kinds as readonly string[] | null;
    return messages.filter((m) => !kinds || kinds.includes(m.kind)).slice(-500).reverse();
  }, [messages, filter]);
  const { loading, error } = hq.messages;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="radiogroup" aria-label="Filter activity" className="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2 sm:px-6">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => setFilter(f.key)}
            className="h-7 shrink-0 rounded-md px-2.5 text-[13px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-checked:bg-muted aria-checked:font-medium aria-checked:text-foreground"
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="p-4 sm:px-6">
            <ErrorNote what="activity" error={error} onRetry={hq.reload.messages} />
          </div>
        ) : loading ? (
          <div className="space-y-2 p-4 sm:px-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ActivityIcon />} title="Nothing logged yet">
            Hook events from your sessions (tasks, notifications, starts and ends) are recorded here once{" "}
            <code className="font-mono text-[12px]">8sync hq hook</code> writes to the local journal.
          </EmptyState>
        ) : (
          <table className="w-full text-[13px]">
            <caption className="sr-only">Activity log, newest first</caption>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-border/60 align-baseline hover:bg-muted/40">
                  <td className="w-0 py-1.5 pr-3 pl-4 font-mono text-xs whitespace-nowrap text-muted-foreground tabular sm:pl-6">
                    <time dateTime={new Date(m.ts).toISOString()}>
                      {new Date(m.ts).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </time>
                  </td>
                  <td
                    className={cn(
                      "w-0 py-1.5 pr-3 text-xs whitespace-nowrap",
                      m.kind === "notification" ? "text-st-needs" : "text-muted-foreground",
                    )}
                  >
                    {KIND_LABEL[m.kind] ?? m.kind}
                  </td>
                  <td className="w-0 py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                    {shortName(m.from_ ?? m.session)}
                    {m.to_ && <span className="text-muted-foreground"> → {shortName(m.to_)}</span>}
                  </td>
                  <td className="py-1.5 pr-4 sm:pr-6">
                    <span className="line-clamp-2 break-words">{m.text}</span>
                    {m.delivery && <DeliveryTag delivery={m.delivery} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
