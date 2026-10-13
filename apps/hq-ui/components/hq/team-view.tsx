"use client";

import {
  ArrowRightIcon,
  BellIcon,
  CircleCheckIcon,
  CirclePlusIcon,
  MessagesSquareIcon,
  MoonIcon,
  PlayIcon,
  SendHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChannelNotice, DeliveryTag, EmptyState, ErrorNote, ReplySource, StatusDot, WaitingBadge, clock, dayLabel, shortName } from "./bits";
import type { Hq } from "./use-hq";
import type { Message, Session } from "./types";

const CHAT_KINDS = new Set(["owner_message", "session_reply", "session_message"]);

export function TeamView({
  hq,
  messages,
  sessions,
  target,
  onTarget,
  header,
}: {
  hq: Hq;
  messages: Message[];
  sessions: Session[];
  target: string | null;
  onTarget: (s: string) => void;
  header?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Stay pinned to the newest row unless the owner scrolled up to read. A
  // ResizeObserver also catches late growth (header card, wrapped text).
  useLayoutEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const stick = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const groups = useMemo(() => {
    const out: { day: string; rows: Message[] }[] = [];
    for (const m of messages) {
      const day = dayLabel(m.ts);
      if (out.at(-1)?.day !== day) out.push({ day, rows: [] });
      out.at(-1)!.rows.push(m);
    }
    return out;
  }, [messages]);

  const { loading, error } = hq.messages;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div ref={content} className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
          {header && <div className="mb-6">{header}</div>}
          {error ? (
            <ErrorNote what="messages" error={error} onRetry={hq.reload.messages} />
          ) : loading ? (
            <TimelineSkeleton />
          ) : messages.length === 0 ? (
            <EmptyState icon={<MessagesSquareIcon />} title="No conversation yet">
              Messages you send, replies from sessions, and messages sessions send each other show up here as they
              happen.
            </EmptyState>
          ) : (
            <ol aria-label="Team timeline" className="pb-2">
              {groups.map((g) => (
                <Fragment key={g.day + g.rows[0].id}>
                  <li
                    aria-hidden
                    className="sticky top-0 z-10 -mx-2 bg-background/95 px-2 pt-3 pb-1.5 text-xs font-medium text-muted-foreground backdrop-blur-[2px]"
                  >
                    {g.day}
                  </li>
                  {g.rows.map((m, i) => (
                    <Row key={m.id} m={m} prev={g.rows[i - 1]} />
                  ))}
                </Fragment>
              ))}
            </ol>
          )}
        </div>
      </div>
      <Composer hq={hq} sessions={sessions} target={target} onTarget={onTarget} />
    </div>
  );
}

function Row({ m, prev }: { m: Message; prev?: Message }) {
  if (!CHAT_KINDS.has(m.kind)) return <EventRow m={m} />;
  const owner = m.kind === "owner_message";
  const from = owner ? "You" : shortName(m.from_ ?? m.session);
  const to = owner ? shortName(m.to_ ?? m.session) : m.kind === "session_reply" ? "you" : m.to_ ? shortName(m.to_) : null;
  // Collapse the header for consecutive rows from the same sender within 5 min.
  const sameRun =
    prev && CHAT_KINDS.has(prev.kind) && prev.kind === m.kind && prev.from_ === m.from_ && prev.to_ === m.to_ && m.ts - prev.ts < 300_000;
  return (
    <li className={cn("group", sameRun ? "mt-1" : "mt-4")}>
      {!sameRun && (
        <div className="mb-1 flex items-baseline gap-1.5 text-[13px]">
          <span className={cn("font-semibold", !owner && "font-mono text-[12.5px]")}>{from}</span>
          {to && (
            <>
              <ArrowRightIcon className="size-3 translate-y-[1px] text-muted-foreground" aria-label="to" />
              <span className="font-mono text-[12.5px] text-muted-foreground">{to}</span>
            </>
          )}
          <time className="ml-1 text-xs text-muted-foreground tabular" dateTime={new Date(m.ts).toISOString()}>
            {clock(m.ts)}
          </time>
        </div>
      )}
      <div
        className={cn(
          "w-fit max-w-full rounded-lg px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap",
          owner ? "bg-owner" : "border bg-card",
        )}
      >
        {m.text}
      </div>
      {owner && m.delivery && (
        <div className="mt-1">
          <DeliveryTag delivery={m.delivery} />
        </div>
      )}
      {m.kind === "session_reply" && m.delivery === "terminal" && (
        <div className="mt-1">
          <ReplySource delivery={m.delivery} />
        </div>
      )}
    </li>
  );
}

const EVENT_META: Record<string, { icon: ReactNode; verb: string }> = {
  task_created: { icon: <CirclePlusIcon />, verb: "created task" },
  task_completed: { icon: <CircleCheckIcon className="text-st-running" />, verb: "completed" },
  teammate_idle: { icon: <MoonIcon />, verb: "is idle" },
  notification: { icon: <BellIcon className="text-st-needs" />, verb: "" },
  session_start: { icon: <PlayIcon />, verb: "started" },
  session_end: { icon: <SquareIcon />, verb: "ended" },
};

function EventRow({ m }: { m: Message }) {
  const meta = EVENT_META[m.kind] ?? { icon: <BellIcon />, verb: m.kind };
  const who = shortName(m.from_ ?? m.session);
  return (
    <li className="mt-2 flex items-start gap-2 text-[13px] text-muted-foreground">
      <span aria-hidden className="mt-[3px] [&_svg]:size-3.5">
        {meta.icon}
      </span>
      <p className="min-w-0 flex-1">
        <span className="font-mono text-[12.5px] text-foreground/80">{who}</span> {meta.verb}
        {m.text && (
          <>
            {meta.verb ? ": " : " "}
            <span className="text-foreground/90">{m.text}</span>
          </>
        )}
      </p>
      <time className="text-xs tabular" dateTime={new Date(m.ts).toISOString()}>
        {clock(m.ts)}
      </time>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-5 pt-4" aria-busy="true" aria-label="Loading timeline">
      {[60, 80, 45].map((w, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function Composer({
  hq,
  sessions,
  target,
  onTarget,
}: {
  hq: Hq;
  sessions: Session[];
  target: string | null;
  onTarget: (s: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const targets = sessions.filter((s) => s.tmux && s.status !== "ended");
  // Default to the first live session until the owner picks one.
  const current = targets.find((s) => s.name === target) ?? targets[0] ?? null;

  async function send() {
    const body = text.trim();
    if (!body || !current || busy || current.waiting) return;
    setBusy(true);
    try {
      const r = await hq.api<{ message: Message; delivery: string; error: string | null }>("/api/messages", {
        method: "POST",
        body: { session: current.name, text: body },
      });
      hq.mergeMessages([r.message]);
      if (r.delivery === "failed") toast.error(`Not delivered to ${shortName(current.name)}: ${r.error}`);
      setText("");
      area.current?.focus();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const disabled = targets.length === 0;
  const hint = !current
    ? "Start a session to message it."
    : current.channel_state === "blocked-by-org"
      ? "Typed into the session's terminal (Channels off for your org)."
      : current.channel_state === "unresponsive"
        ? "Typed into the session's terminal (the channel stopped answering)."
        : current.channel
      ? "Delivered through the channel; replies appear here."
      : hq.channelMode?.mode === "off"
        ? "Typed into the session's terminal (Channels are off)."
        : "Typed into the session's terminal until its channel connects.";

  return (
    <div className="shrink-0 border-t bg-background">
      <form
        className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {current && (current.channel_state || current.waiting) && (
          <div className="mb-2 space-y-1.5">
            {current.waiting && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <WaitingBadge what={current.waiting} />
                {current.waiting} — Claude is waiting for you in the terminal — answer it first (Open terminal).
              </p>
            )}
            <ChannelNotice state={current.channel_state} />
          </div>
        )}
        <div className="rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring/40">
          <label htmlFor="composer" className="sr-only">
            Message
          </label>
          <Textarea
            id="composer"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            disabled={disabled}
            rows={2}
            maxLength={4000}
            placeholder={current ? `Message ${shortName(current.name)}` : "No running session"}
            className="max-h-48 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <Select value={current?.name ?? ""} onValueChange={onTarget} disabled={disabled}>
              <SelectTrigger size="sm" className="h-7 max-w-[55%] gap-1.5 border-0 bg-muted/60 font-mono text-xs" aria-label="Send to session">
                <SelectValue placeholder="Pick a session" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((s) => (
                  <SelectItem key={s.name} value={s.name} className="font-mono text-xs">
                    <StatusDot status={s.status} /> {shortName(s.name)}
                    {s.channel ? " · channel" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">{hint}</p>
            <Button type="submit" size="sm" className="ml-auto" disabled={disabled || busy || !text.trim() || !!current?.waiting}
              title={current?.waiting ? "Claude is waiting for you in the terminal — answer it first (Open terminal)" : undefined}>
              <SendHorizontalIcon /> Send
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
