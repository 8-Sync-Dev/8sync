"use client";

import {
  ArrowRightIcon,
  BellIcon,
  ChevronDownIcon,
  MessagesSquareIcon,
  PlayIcon,
  ScrollTextIcon,
  SendHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message as ChatMessage, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDefaultLayout } from "react-resizable-panels";
import { AttachButton, AttachList, useAttach } from "./attach";
import { MessageText, ReplyMedia } from "./attachments";
import { ComposerDock, openDock } from "./composer-dock";
import { MentionTextarea } from "./mention-textarea";
import { ModelPicker } from "./model-picker";
import { TOUCH } from "./room-send";
import { FilesPaneCtx, useFilesPaneState } from "./files-sheet";
import { TurnLink } from "./room-outputs";
import { pathMarkdown } from "./path-open";
import { addressOf, deliveryOf, inboxText, isOmpRoomId, messageTargets, sessionLabel, splitStale, targetLabel } from "@/lib/labels";
import { withQuote } from "@/lib/ask-quote";
import { onAsk, takeAsk } from "@/lib/ask-store";
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
  split,
  bar,
  report,
  onStartSession,
  files,
}: {
  hq: Hq;
  messages: Message[];
  sessions: Session[];
  target: string | null;
  onTarget: (s: string) => void;
  header?: ReactNode;
  /**
   * Chat phòng: the room's brief and Nhật ký (Kết quả · Từng bước). On a wide screen it is the right
   * column beside the chat (the chat and its message box on the left), the border between them dragged
   * to give either more room (size kept per browser); on a phone a pinned "Chat · Nhật ký" switch shows
   * one or the other, each with its own scroll (owner 2026-11-06: scrolling the whole chat up to reach
   * Nhật ký was hard).
   */
  split?: ReactNode;
  /** Pinned above the scrolling log and chat, outside the scroller (Chat phòng: the room's title row and terminal button). */
  bar?: ReactNode;
  /**
   * Chat phòng's "Báo cáo" button (room-report RoomReport, opens its dialog): in the message box's
   * bottom row, right before Send, on every screen (owner 2026-11-06: the message box keeps its
   * full-width space under the room, Báo cáo is a compact button in it; icon + count on a phone).
   */
  report?: ReactNode;
  /** Opens the start-session form (hq-app: focusStartSession). Without it the CTA is text only. */
  onStartSession?: () => void;
  /**
   * Chat phòng's "Thư mục" (files-sheet FilesPane): on a wide screen a pane at the right, full height
   * beside the room, opened by the bar's "Thư mục" button and its width dragged (kept per browser);
   * on a phone the button opens a sheet instead.
   */
  files?: ReactNode;
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

  const mobile = useIsMobile();
  const layout = useDefaultLayout({ id: "hq-room-columns", panelIds: ["chat", "brief"] });
  const filesPane = useFilesPaneState();
  const sidePane = !!files && !mobile && filesPane.open;
  const filesLayout = useDefaultLayout({ id: "hq-room-files", panelIds: sidePane ? ["room", "files"] : ["room"] });
  // Phone: Chat or Nhật ký, switched by a pinned control (`split` no longer scrolls above the chat).
  const [pane, setPane] = useState<"chat" | "log">("chat");
  const phoneSplit = mobile && !!split;
  const top = phoneSplit ? null : header;

  const chat = (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl gap-0 px-4 py-4 sm:px-6">
        {top && <div className="mb-6">{top}</div>}
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
            {/* One section per day: its separator sticks only while that day is in view, then the next day's pushes it out (no stacked separators). */}
            {groups.map((g) => (
              <section key={g.day + g.rows[0].id}>
                <div
                  aria-hidden
                  className="sticky top-0 z-10 -mx-2 bg-background/95 px-2 pt-3 pb-1.5 text-xs font-medium text-muted-foreground backdrop-blur-[2px]"
                >
                  {g.day}
                </div>
                {g.rows.map((m, i) => (
                  <Row key={m.id} m={m} prev={g.rows[i - 1]} who={who} token={hq.token} />
                ))}
              </section>
            ))}
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );

  // The message box runs the full width under the chat and Nhật ký (owner 2026-11-06: "input chat vẫn
  // để full space riêng ở dưới như cũ").
  const wide = !!split && !mobile;
  const composer =
    messageTargets(sessions).length === 0 ? (
      <StartCta onStartSession={onStartSession} unreachable={sessions.some((s) => s.status !== "ended")} extra={report} />
    ) : (
      <Composer hq={hq} sessions={sessions} target={target} onTarget={onTarget} wide={wide} extra={report} />
    );

  const main = (
    <>
      {wide ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          <ResizablePanel id="chat" minSize="28" className="flex min-h-0 flex-col">
            {chat}
          </ResizablePanel>
          <ResizableHandle withHandle aria-label="Kéo để chia chỗ giữa chat và Nhật ký" />
          <ResizablePanel id="brief" defaultSize="50" minSize="25" className="min-h-0">
            <div className="flex h-full w-full flex-col overflow-y-auto px-4 pt-4 pb-3 sm:px-5">{split}</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : phoneSplit && pane === "log" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-3">{split}</div>
      ) : (
        chat
      )}
      {composer}
    </>
  );

  return (
    <FilesPaneCtx.Provider value={files && !mobile ? filesPane : null}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Outside the scroller: opaque, never overlaps the log, and the day separators stick at the scroller's own top. */}
        {(bar || phoneSplit) && (
          <div className="shrink-0 border-b bg-background">
            {bar && <div className={cn("mx-auto w-full px-4 py-2 sm:px-6", wide ? "max-w-none" : "max-w-3xl")}>{bar}</div>}
            {phoneSplit && <PaneSwitch pane={pane} onPane={setPane} />}
          </div>
        )}
        {/* Always the same group around the room: opening Thư mục adds a panel, never remounts the chat (draft, scroll). */}
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" defaultLayout={filesLayout.defaultLayout} onLayoutChanged={filesLayout.onLayoutChanged}>
          <ResizablePanel id="room" minSize="35" className="flex min-h-0 flex-col">
            {main}
          </ResizablePanel>
          {sidePane && (
            <>
              <ResizableHandle withHandle aria-label="Kéo để đổi chiều rộng Thư mục" />
              <ResizablePanel id="files" defaultSize="42" minSize="22" maxSize="65" className="min-h-0">
                {files}
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </FilesPaneCtx.Provider>
  );
}

/** Phone: which half of Chat phòng fills the screen. A tab list, pinned under the room's bar. */
function PaneSwitch({ pane, onPane }: { pane: "chat" | "log"; onPane: (p: "chat" | "log") => void }) {
  const tabs = [
    { id: "chat", label: "Chat", Icon: MessagesSquareIcon },
    { id: "log", label: "Nhật ký", Icon: ScrollTextIcon },
  ] as const;
  return (
    <div role="tablist" aria-label="Chat phòng" className="grid grid-cols-2 gap-1 px-4 pb-2">
      {tabs.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={pane === id}
          onClick={() => onPane(id)}
          className={cn(
            "flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            pane === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </button>
      ))}
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

function StartCta({ onStartSession, unreachable, extra }: { onStartSession?: () => void; unreachable?: boolean; extra?: ReactNode }) {
  // A live session HQ cannot reach (no tmux pane, no Claude session id yet) is not "no session".
  return (
    <div className="shrink-0 border-t bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        {unreachable ? (
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Session này đang chạy nhưng HQ chưa biết session id của nó, nên chưa nhắn được. Id có sau lượt đầu tiên của session.
          </p>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">No session is running, so there is nobody to message.</p>
            {onStartSession ? (
              <Button size="sm" onClick={onStartSession}>
                <PlayIcon /> Start a session
              </Button>
            ) : (
              <span className="text-sm font-medium">Start one in the Sessions tab.</span>
            )}
          </>
        )}
        {extra}
      </div>
    </div>
  );
}

type Who = (name: string | null | undefined) => string;

function Row({ m, prev, who, token }: { m: Message; prev?: Message; who: Who; token: string }) {
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
          {owner ? (
            <MessageText text={m.text} token={token} className="wrap-anywhere whitespace-pre-wrap" />
          ) : (
            <>
              {/* wrap-anywhere: a long path or URL breaks inside the bubble instead of being clipped on a phone. A file path in code or a file link opens in the viewer. */}
              <MessageResponse className="wrap-anywhere" {...pathMarkdown}>
                {m.text ?? ""}
              </MessageResponse>
              <ReplyMedia text={m.text} token={token} />
            </>
          )}
        </MessageContent>
      </ChatMessage>
      {owner && m.delivery && (
        <div className="mt-1 flex justify-end">
          <DeliveryTag delivery={m.delivery} />
        </div>
      )}
      {(owner || m.kind === "session_reply") && <TurnLink m={m} align={owner ? "end" : "start"} />}
      {m.kind === "session_reply" && m.delivery === "terminal" && (
        <div className="mt-1">
          <ReplySource delivery={m.delivery} />
        </div>
      )}
    </div>
  );
}

const EVENT_META: Record<string, { icon: ReactNode; verb: string }> = {
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

/**
 * The room composer (POST /api/messages, files, `@path`, model). `inline` (Bots thread): on a phone it
 * stays under the conversation like a messenger, above the keyboard, instead of folding into the
 * floating button; one bot has one target, so the session picker is left out.
 */
export function Composer({
  hq,
  sessions,
  target,
  onTarget,
  wide = false,
  extra,
  inline = false,
}: {
  hq: Hq;
  sessions: Session[];
  target: string | null;
  onTarget: (s: string) => void;
  /** Under the chat and Nhật ký together: the box takes the full width. */
  wide?: boolean;
  /** Right before Send in the box's bottom row (Chat phòng: the Báo cáo button). */
  extra?: ReactNode;
  inline?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const att = useAttach(hq.api);
  /** Folds the phone's bottom sheet after a send (ComposerDock); a no-op on desktop. */
  const closeDock = useRef<() => void>(() => {});
  // "Hỏi về đoạn này" (a room's Kết quả, the Kết quả tab): the quote lands at the end of the draft, the
  // phone's sheet opens and the caret waits under the quote for the question.
  useEffect(() => {
    let timer = 0;
    const take = () => {
      const p = takeAsk();
      if (!p) return;
      setText((t) => withQuote(t, p.quote));
      openDock("room");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        el.scrollTop = el.scrollHeight;
      }, 60);
    };
    // A quote put just before this room opened (the Kết quả tab switches here) is waiting already.
    const first = requestAnimationFrame(take);
    const off = onAsk(take);
    return () => {
      cancelAnimationFrame(first);
      window.clearTimeout(timer);
      off();
    };
  }, []);
  const targets = messageTargets(sessions);
  // Default to the first live session until the owner picks one.
  const current = targets.find((s) => s.name === target || s.session_id === target) ?? targets[0] ?? null;
  const via = current ? deliveryOf(current) : null;

  async function send() {
    const body = text.trim();
    if (!body || !current || busy || att.uploading > 0) return;
    if (current.waiting) {
      // Enter used to do nothing here, so a send looked lost: say why it is held.
      toast.error(`${targetLabel(current)} đang chờ anh trả lời trong terminal: trả lời trước (Mở terminal) rồi gửi lại`);
      return;
    }
    setBusy(true);
    try {
      const r = await hq.api<{ message: Message; delivery: string; error: string | null }>("/api/messages", {
        method: "POST",
        // Sessions started elsewhere are addressed by their Claude session id (inbox delivery).
        body: { session: addressOf(current), text: body, base: current.cwd ?? null, ...(att.files.length ? { files: att.files.map((f) => f.id) } : {}) },
      });
      hq.mergeMessages([r.message]);
      if (r.delivery === "failed") toast.error(`Not delivered to ${targetLabel(current)}: ${r.error}`);
      setText("");
      att.clear();
      closeDock.current();
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
      ? isOmpRoomId(current.session_id ?? current.name)
        ? `Gửi ${inboxText(current.inbox_live, current.session_id ?? current.name)}.`
        : current.inbox_live
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
    <ComposerDock id={inline ? "bot" : "room"} inline={inline} draft={text.trim().length > 0 || att.files.length > 0} label={current ? `Nhắn ${targetLabel(current)}` : "Nhắn phòng"}>
      {({ close }) => {
        closeDock.current = close;
        return (
          <div className="shrink-0 border-t bg-background">
            <form
              className={cn("mx-auto w-full px-4 py-3 sm:px-6", wide ? "max-w-none" : "max-w-3xl", inline && "max-sm:px-3 max-sm:py-2")}
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
                <MentionTextarea
                  id="composer"
                  ref={area}
                  value={text}
                  onValueChange={setText}
                  base={current?.cwd ?? null}
                  api={hq.api}
                  onKeyDown={onKey}
                  onPaste={att.onPaste}
                  disabled={disabled}
                  rows={inline ? 1 : 2}
                  maxLength={4000}
                  placeholder={current ? `Nhắn ${targetLabel(current)} · @ để chèn file` : "Message"}
                  className={cn("max-h-[40dvh] resize-none overflow-y-auto border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent", inline ? "min-h-11 max-sm:max-h-[30dvh]" : "min-h-14")}
                />
                <AttachList a={att} token={hq.token} />
                <div className={cn("flex items-center gap-2 px-2 pb-2", !inline && "max-sm:flex-wrap")}>
                  {!(inline && targets.length <= 1) && (
                  <Select value={current?.name ?? ""} onValueChange={onTarget} disabled={disabled}>
                    <SelectTrigger size="sm" className="h-7 min-w-0 gap-1.5 border-0 bg-muted/60 font-mono text-xs max-sm:basis-full sm:max-w-[55%]" aria-label="Send to session">
                      <SelectValue placeholder="Pick a session" />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((s) => (
                        <SelectItem key={s.name} value={s.name} className="font-mono text-xs">
                          <StatusDot status={s.status} /> {targetLabel(s)}
                          {s.channel ? " · channel" : deliveryOf(s) === "inbox" ? " · inbox" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  )}
                  {current && <ModelPicker api={hq.api} session={addressOf(current)} engine={current.engine === "omp" ? "omp" : "claude"} model={current.model} className={TOUCH} />}
                  <AttachButton a={att} disabled={disabled || !current} />
                  <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">{hint}</p>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {extra}
                    <Button type="submit" size="sm" className={inline ? TOUCH : undefined} disabled={disabled || busy || att.uploading > 0 || !text.trim() || !!current?.waiting}
                    title={current?.waiting ? "Claude is waiting for you in the terminal — answer it first (Open terminal)" : undefined}>
                    <SendHorizontalIcon /> Send
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        );
      }}
    </ComposerDock>
  );
}
