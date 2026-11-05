"use client";

import { BotIcon, CircleAlertIcon, MessageSquareIcon, PaperclipIcon, ScrollTextIcon, UsersIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { parseAttachments, type Attachment } from "@/lib/attachments";
import { agoShort, agoVi } from "@/lib/now";
import type { ActivityEvent } from "@/lib/server/activity";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { ErrorNote } from "./bits";
import { RoomOutputs, useRoomLog } from "./room-outputs";

/** A line longer than this folds; the rest opens on demand. */
const FOLD = 140;

const KIND_ICON: Record<ActivityEvent["kind"], LucideIcon> = { prompt: MessageSquareIcon, text: BotIcon, tool: WrenchIcon, agent: UsersIcon };
const KIND_VI: Record<ActivityEvent["kind"], string> = { prompt: "Lời nhắn", text: "Trả lời", tool: "Công cụ", agent: "Subagent" };

type Tab = "results" | "steps";
const TABS: { id: Tab; label: string }[] = [
  { id: "results", label: "Kết quả" },
  { id: "steps", label: "Từng bước" },
];

/**
 * "Nhật ký" of a room, read from RoomLogProvider (one poll shared with the chat). "Kết quả" (default):
 * each turn's final output as a document with its table of contents; "Từng bước": one line per prompt,
 * reply, tool call and subagent, newest at the bottom. A chat link to a result switches to Kết quả.
 * `onFull` opens its terminal.
 */
export function RoomLog({ room, onFull, fill }: { room: string; onFull?: () => void; fill?: boolean }) {
  const ctx = useRoomLog();
  const [tab, setTab] = useState<Tab>("results");
  const seq = ctx?.focused?.seq;
  const [seen, setSeen] = useState(seq);
  if (seq !== seen) {
    // A link from the chat: show the results it points into (adjusting state while rendering, no effect pass).
    setSeen(seq);
    setTab("results");
  }
  const data = ctx?.log ?? null;
  return (
    <section aria-labelledby="room-log" className={cn("space-y-2", fill && "md:flex md:min-h-40 md:flex-1 md:flex-col md:gap-2 md:space-y-0")}>
      <div className="flex shrink-0 items-center gap-2">
        <h3 id="room-log" className="flex items-center gap-1.5 text-sm font-semibold">
          <ScrollTextIcon aria-hidden className="size-4 text-muted-foreground" />
          Nhật ký
        </h3>
        <div role="tablist" aria-label="Cách xem nhật ký" className="inline-flex rounded-md bg-muted p-0.5 text-xs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-[5px] px-2 py-0.5 font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-9",
                tab === t.id && "bg-background text-foreground shadow-xs",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {data && tab === "steps" && <span className="text-xs text-muted-foreground tabular">{data.events.length} việc gần nhất</span>}
        {onFull && (
          <button type="button" onClick={onFull} className="ml-auto inline-flex items-center rounded-sm text-xs font-medium text-brand-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-10 dark:text-brand">
            Mở log đầy đủ
          </button>
        )}
      </div>
      {ctx?.error && !data ? (
        <ErrorNote what="nhật ký" error={ctx.error} onRetry={ctx.retry} />
      ) : !data ? (
        <div className="space-y-2 rounded-lg border p-3" aria-busy="true" aria-label="Đang tải nhật ký">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ) : tab === "results" ? (
        <RoomOutputs turns={data.turns} now={ctx!.now} room={room} />
      ) : (
        <LogLines events={data.events} now={ctx!.now} fill={fill} />
      )}
    </section>
  );
}

/**
 * The scrolling list. Pinned to the bottom while the owner is there; reading older lines stops the follow.
 * `fill`: on a wide screen it takes the height its panel gives it instead of stopping at 20rem.
 */
export function LogLines({ events, now, fill }: { events: ActivityEvent[]; now: number; fill?: boolean }) {
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
      className={cn(
        "max-h-80 divide-y divide-border/60 overflow-y-auto rounded-lg border text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        fill && "md:max-h-none md:min-h-0 md:flex-1",
      )}
    >
      {events.map((ev, i) => (
        <LogLine key={`${ev.at ?? 0}-${i}`} ev={ev} now={now} />
      ))}
    </ol>
  );
}

/** A reply or prompt longer than this (chars or lines) opens clamped, with "Xem hết". */
const CLAMP_CHARS = 600;
const CLAMP_LINES = 8;

/** A reply or prompt in full, rendered as markdown; a long one opens clamped. `files`: a prompt's attachments, by name. */
function LogProse({ text, files, className }: { text: string; files: Attachment[]; className?: string }) {
  const long = text.length > CLAMP_CHARS || text.split("\n").length > CLAMP_LINES;
  const [open, setOpen] = useState(false);
  const clamped = long && !open;
  // The server stops a reply at 4 000 chars (a prompt at 2 000) and ends it with "…".
  const cut = text.length >= 2000 && text.endsWith("…");
  return (
    <div className={cn("min-w-0 flex-1", className)}>
      <div
        className={cn(
          "text-sm leading-relaxed break-words [&_pre]:my-1.5 [&_pre]:text-xs [&_table]:my-1.5 [&_table]:text-xs",
          clamped && "max-h-44 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
        )}
      >
        <MessageResponse>{text}</MessageResponse>
      </div>
      {files.length > 0 && (
        // Names only: the chat below shows the files themselves; the full path stays in the hover title.
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground" aria-label="File đính kèm">
          {files.map((f) => (
            <li key={f.id} className="inline-flex min-w-0 items-center gap-1" title={f.path}>
              <PaperclipIcon aria-hidden className="size-3 shrink-0" />
              <span className="max-w-56 truncate">{f.name}</span>
            </li>
          ))}
        </ul>
      )}
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 inline-flex items-center rounded-sm text-xs text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-10"
        >
          {open ? "Thu gọn" : "Xem hết"}
        </button>
      )}
      {cut && open && <p className="mt-1 text-xs text-muted-foreground">Câu này dài hơn phần Nhật ký giữ. Đọc trọn trong “Mở log đầy đủ”.</p>}
    </div>
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
  if ((ev.kind === "text" || ev.kind === "prompt") && !ev.tool && !ev.error) {
    // A prompt sent with files carries their paths (lib/attachments.ts): markdown would eat the `\` before `.claude`.
    const { body, files } = ev.kind === "prompt" ? parseAttachments(ev.text) : { body: ev.text, files: [] };
    return (
      <li className={cn("px-3 py-1.5", ev.kind === "prompt" && "bg-owner/60")}>
        <div className="flex items-start gap-2">
          {icon}
          {label}
          <LogProse text={body} files={files} className={ink} />
          {time}
        </div>
      </li>
    );
  }
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
