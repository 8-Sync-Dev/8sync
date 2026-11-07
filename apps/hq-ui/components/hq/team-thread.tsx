"use client";

import { ArrowRightIcon, BellRingIcon, HourglassIcon, PlayIcon, ReplyIcon, SquareIcon, TerminalSquareIcon } from "lucide-react";
import { useMemo } from "react";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { shirtFor } from "@/lib/sprite/frames";
import { buildTeamThread, type ThreadFilters, type ThreadItem, type ThreadRow } from "@/lib/team-thread";
import { useNow } from "@/hooks/use-now";
import { agoVi } from "@/lib/now";
import { shortName } from "./bits";
import { Linkified, MessageText, ReplyMedia } from "./attachments";

/** Tiny coloured initial, same shirt colour as the session's desk sprite. */
function Avatar({ name, label }: { name: string | null; label: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-black"
      style={{ background: name === "owner" ? "var(--muted)" : shirtFor(name ?? "") }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

const Time = ({ ts, now }: { ts: number; now: number }) => (
  <time dateTime={new Date(ts).toISOString()} className="text-[11px] text-muted-foreground">
    {agoVi(ts, now)}
  </time>
);
const Times = ({ n }: { n: number }) => (n > 1 ? <span className="text-[11px] text-muted-foreground">×{n}</span> : null);

type Who = (id: string | null) => string;

function Row({ it, token, who, now, onOpenSession }: { it: ThreadItem; token: string; who: Who; now: number; onOpenSession?: (name: string) => void }) {
  switch (it.kind) {
    case "owner":
    case "reply":
      return (
        <Message from={it.kind === "owner" ? "user" : "assistant"}>
          <div className={`flex items-center gap-2 text-xs text-muted-foreground ${it.kind === "owner" ? "justify-end" : ""}`}>
            <Avatar name={it.from} label={who(it.from)} />
            <span>
              {who(it.from)} <ArrowRightIcon className="inline size-3" aria-hidden /> {who(it.to)}
            </span>
            <Time ts={it.ts} now={now} />
            <Times n={it.count} />
          </div>
          <MessageContent>
            {it.kind === "owner" ? (
              <MessageText text={it.text} token={token} className="wrap-anywhere whitespace-pre-wrap" />
            ) : (
              <>
                <Linkified text={it.text ?? ""} className="wrap-anywhere whitespace-pre-wrap" />
                <ReplyMedia text={it.text} token={token} />
              </>
            )}
          </MessageContent>
        </Message>
      );
    case "handoff": {
      const from = it.fromName || who(it.from);
      const to = it.toName || who(it.to);
      return (
        <article aria-label={`Chuyển giao từ ${from} sang ${to}`} className="w-full max-w-[95%] rounded-lg border border-dashed bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Avatar name={it.from} label={from} />
            <span className="font-medium">{from}</span>
            <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
            <Avatar name={it.to} label={to} />
            <span className="font-medium">{to}</span>
            {it.answered ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ReplyIcon className="size-3.5" aria-hidden /> đã trả lời
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <HourglassIcon className="size-3.5" aria-hidden /> chưa trả lời
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Times n={it.count} />
              <Time ts={it.ts} now={now} />
            </span>
          </div>
          {it.text && <p className="mt-2 line-clamp-3 border-l-2 pl-2 text-sm text-muted-foreground">{it.text}</p>}
        </article>
      );
    }
    case "needs_you":
      return (
        <div role={it.open ? "alert" : undefined} className={`flex w-full max-w-[95%] flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${it.open ? "border-st-needs bg-st-needs/10" : "text-muted-foreground"}`}>
          <BellRingIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <strong>{who(it.session)}</strong> {it.open ? "đang chờ anh" : "đã chờ anh (đã trả lời)"}
            {it.text && <span className="block truncate text-xs text-muted-foreground">{it.text}</span>}
          </span>
          <Times n={it.count} />
          <Time ts={it.ts} now={now} />
          {it.open && it.session && onOpenSession && (
            <Button size="sm" onClick={() => onOpenSession(it.session!)}>
              <TerminalSquareIcon aria-hidden /> Mở terminal
            </Button>
          )}
        </div>
      );
    default: {
      const start = it.kind === "session_start";
      return (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {start ? <PlayIcon className="size-3" aria-hidden /> : <SquareIcon className="size-3" aria-hidden />}
          {who(it.session)} {start ? "bắt đầu" : "kết thúc"} <Times n={it.count} /> <Time ts={it.ts} now={now} />
        </p>
      );
    }
  }
}

/**
 * One chronological team thread. Wire `rows` from the messages API and
 * `onOpenSession` to the TerminalDrawer.
 */
export function TeamThread({
  rows,
  filters,
  token,
  onOpenSession,
  nameOf,
}: {
  rows: ThreadRow[];
  filters?: ThreadFilters;
  /** For the attachment thumbnails (an <img> cannot send the header). */
  token: string;
  onOpenSession?: (name: string) => void;
  /** A room's label for a session name or id ("omp-c1f5…" → "core"); null = shortName. */
  nameOf?: (id: string) => string | null;
}) {
  const items = useMemo(() => buildTeamThread(rows, filters), [rows, filters]);
  const now = useNow();
  const who: Who = (id) => (id && nameOf?.(id)) || shortName(id);
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-3">
        {items.length === 0 ? (
          <ConversationEmptyState title="Chưa có gì trong luồng" description="Tin nhắn, chuyển giao và việc của team sẽ hiện ở đây. Giao một việc cho cả team: ô Gửi cho mọi phòng ở dưới cùng." />
        ) : (
          items.map((it) => <Row key={`${it.kind}-${it.key}`} it={it} token={token} who={who} now={now} onOpenSession={onOpenSession} />)
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
