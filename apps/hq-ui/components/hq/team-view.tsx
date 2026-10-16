"use client";

import {
  ArrowRightIcon,
  BellIcon,
  CircleCheckIcon,
  ChevronDownIcon,
  CirclePlusIcon,
  MessagesSquareIcon,
  MoonIcon,
  PlayIcon,
  SendHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message as ChatMessage, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { addressOf, deliveryOf, messageTargets, sessionLabel, splitStale } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { ChannelNotice, DeliveryTag, ErrorNote, ReplySource, STATUS_LABEL, StatusDot, WaitingBadge, clock, dayLabel, shortName } from "./bits";
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
  onStartSession,
}: {
  hq: Hq;
  messages: Message[];
  sessions: Session[];
  target: string | null;
  onTarget: (s: string) => void;
  header?: ReactNode;
  /** Opens the start-session form (hq-app: focusStartSession). Without it the CTA is text only. */
  onStartSession?: () => void;
}) {
  const groups = useMemo(() => {
    const out: { day: string; rows: Message[] }[] = [];
    for (const m of messages) {
      const day = dayLabel(m.ts);
      if (out.at(-1)?.day !== day) out.push({ day, rows: [] });
      out.at(-1)!.rows.push(m);
    }
    return out;
  }, [messages]);

  const who = useMemo<Who>(() => {
    const names = new Map<string, string>();
    for (const x of sessions) {
      names.set(x.name, sessionLabel(x));
      if (x.session_id) names.set(x.session_id, sessionLabel(x));
    }
    return (n) => (n ? (names.get(n) ?? shortName(n)) : "unknown");
  }, [sessions]);

  const { loading, error } = hq.messages;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-0 px-4 py-4 sm:px-6">
          {header && <div className="mb-6">{header}</div>}
          <SessionStrip sessions={sessions} />
          {error ? (
            <ErrorNote what="messages" error={error} onRetry={hq.reload.messages} />
          ) : loading ? (
            <TimelineSkeleton />
          ) : messages.length === 0 ? (
            <ConversationEmptyState
              icon={<MessagesSquareIcon />}
              title="No conversation yet"
              description="Messages you send, replies from sessions, and messages sessions send each other show up here as they happen."
            />
          ) : (
            <div aria-label="Team timeline" className="pb-2">
              {groups.map((g) => (
                <Fragment key={g.day + g.rows[0].id}>
                  <div
                    aria-hidden
                    className="sticky top-0 z-10 -mx-2 bg-background/95 px-2 pt-3 pb-1.5 text-xs font-medium text-muted-foreground backdrop-blur-[2px]"
                  >
                    {g.day}
                  </div>
                  {g.rows.map((m, i) => (
                    <Row key={m.id} m={m} prev={g.rows[i - 1]} who={who} />
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {messageTargets(sessions).length === 0 ? (
        <StartCta onStartSession={onStartSession} unreachable={sessions.some((s) => s.status !== "ended")} />
      ) : (
        <Composer hq={hq} sessions={sessions} target={target} onTarget={onTarget} />
      )}
    </div>
  );
}

/** One status line per live session; cwd, channel and detail open on demand. */
function SessionStrip({ sessions }: { sessions: Session[] }) {
  const { fresh } = splitStale(sessions);
  const live = fresh.filter((s) => s.status !== "ended");
  if (live.length === 0) return null;
  return (
    <ul aria-label="Sessions" className="mb-4 divide-y rounded-xl border bg-card text-sm">
      {live.map((s) => {
        const state = s.waiting ? "Waiting for you" : STATUS_LABEL[s.status];
        const via = s.channel ? "Channel" : s.tmux ? "Terminal" : "Not started here";
        return (
          <li key={s.name}>
            <details className="group/s">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
                <StatusDot status={s.status} />
                <span className="min-w-0 flex-1 truncate font-medium">{sessionLabel(s)}</span>
                <span className={cn("shrink-0 text-xs", s.waiting || s.status === "needs_input" ? "font-medium text-st-needs" : "text-muted-foreground")}>
                  {state}
                </span>
                <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/s:rotate-180" aria-hidden />
              </summary>
              <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 px-3 pt-1 pb-3 text-xs text-muted-foreground">
                <dt>Name</dt>
                <dd className="truncate font-mono">{s.name}</dd>
                {s.cwd && (
                  <>
                    <dt>Folder</dt>
                    <dd className="truncate font-mono" title={s.cwd}>{s.cwd}</dd>
                  </>
                )}
                <dt>Via</dt>
                <dd>{via}</dd>
                {(s.waiting || s.detail) && (
                  <>
                    <dt>Detail</dt>
                    <dd>{s.waiting ?? s.detail}</dd>
                  </>
                )}
              </dl>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function StartCta({ onStartSession, unreachable }: { onStartSession?: () => void; unreachable?: boolean }) {
  // A live session HQ cannot reach (no tmux pane, no Claude session id yet) is not "no session".
  if (unreachable)
    return (
      <div className="shrink-0 border-t bg-background">
        <p className="mx-auto w-full max-w-3xl px-4 py-3 text-sm text-muted-foreground sm:px-6">
          Session này đang chạy nhưng HQ chưa biết session id của nó, nên chưa nhắn được. Id có sau lượt đầu tiên của session.
        </p>
      </div>
    );
  return (
    <div className="shrink-0 border-t bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">No session is running, so there is nobody to message.</p>
        {onStartSession ? (
          <Button size="sm" onClick={onStartSession}>
            <PlayIcon /> Start a session
          </Button>
        ) : (
          <span className="text-sm font-medium">Start one in the Sessions tab.</span>
        )}
      </div>
    </div>
  );
}

type Who = (name: string | null | undefined) => string;

function Row({ m, prev, who }: { m: Message; prev?: Message; who: Who }) {
  if (!CHAT_KINDS.has(m.kind)) return <EventRow m={m} who={who} />;
  const owner = m.kind === "owner_message";
  const from = owner ? "You" : who(m.from_ ?? m.session);
  const to = owner ? who(m.to_ ?? m.session) : m.kind === "session_reply" ? "you" : m.to_ ? who(m.to_) : null;
  // Collapse the header for consecutive rows from the same sender within 5 min.
  const sameRun =
    prev && CHAT_KINDS.has(prev.kind) && prev.kind === m.kind && prev.from_ === m.from_ && prev.to_ === m.to_ && m.ts - prev.ts < 300_000;
  return (
    <div className={cn(sameRun ? "mt-1" : "mt-4")}>
      {!sameRun && (
        <div className={cn("mb-1 flex items-baseline gap-1.5 text-[13px]", owner && "justify-end")}>
          <span className="font-semibold">{from}</span>
          {to && (
            <>
              <ArrowRightIcon className="size-3 translate-y-[1px] text-muted-foreground" aria-label="to" />
              <span className="text-muted-foreground">{to}</span>
            </>
          )}
          <time className="ml-1 text-xs text-muted-foreground tabular" dateTime={new Date(m.ts).toISOString()}>
            {clock(m.ts)}
          </time>
        </div>
      )}
      <ChatMessage from={owner ? "user" : "assistant"}>
        <MessageContent className={cn(!owner && "rounded-lg border bg-card px-3 py-2")}>
          {owner ? <span className="break-words whitespace-pre-wrap">{m.text}</span> : <MessageResponse>{m.text ?? ""}</MessageResponse>}
        </MessageContent>
      </ChatMessage>
      {owner && m.delivery && (
        <div className="mt-1 flex justify-end">
          <DeliveryTag delivery={m.delivery} />
        </div>
      )}
      {m.kind === "session_reply" && m.delivery === "terminal" && (
        <div className="mt-1">
          <ReplySource delivery={m.delivery} />
        </div>
      )}
    </div>
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

function EventRow({ m, who: label }: { m: Message; who: Who }) {
  const meta = EVENT_META[m.kind] ?? { icon: <BellIcon />, verb: m.kind };
  const who = label(m.from_ ?? m.session);
  return (
    <div className="mt-2 flex items-start gap-2 text-[13px] text-muted-foreground">
      <span aria-hidden className="mt-[3px] [&_svg]:size-3.5">
        {meta.icon}
      </span>
      <p className="min-w-0 flex-1">
        <span className="text-foreground/80">{who}</span> {meta.verb}
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
    </div>
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
  const targets = messageTargets(sessions);
  // Default to the first live session until the owner picks one.
  const current = targets.find((s) => s.name === target || s.session_id === target) ?? targets[0] ?? null;
  const via = current ? deliveryOf(current) : null;

  async function send() {
    const body = text.trim();
    if (!body || !current || busy || current.waiting) return;
    setBusy(true);
    try {
      const r = await hq.api<{ message: Message; delivery: string; error: string | null }>("/api/messages", {
        method: "POST",
        // Sessions started elsewhere are addressed by their Claude session id (inbox delivery).
        body: { session: addressOf(current), text: body },
      });
      hq.mergeMessages([r.message]);
      if (r.delivery === "failed") toast.error(`Not delivered to ${sessionLabel(current)}: ${r.error}`);
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
    : via === "inbox"
      ? current.inbox_live
        ? "Inbox: mod 8sync-inbox đang chạy — session nhận tin ngay khi rảnh, trả lời hiện ở đây."
        : "Inbox: session nhận tin khi xong lượt đang làm (Stop hook). Nhận ngay khi rảnh: gõ /reload-plugins trong phiên đó (không cần restart)."
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
            placeholder={current ? `Nhắn ${sessionLabel(current)}` : "Message"}
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
                    <StatusDot status={s.status} /> {sessionLabel(s)}
                    {s.channel ? " · channel" : deliveryOf(s) === "inbox" ? " · inbox" : ""}
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
