"use client";

import { ArrowRightIcon, BellRingIcon, CheckCircle2Icon, CircleDotIcon, PlayIcon, SquareIcon, TerminalSquareIcon } from "lucide-react";
import { useMemo } from "react";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { shirtFor } from "@/lib/sprite/frames";
import { buildTeamThread, type ThreadFilters, type ThreadItem, type ThreadRow } from "@/lib/team-thread";
import { ago, shortName } from "./bits";

/** Tiny coloured initial, same shirt colour as the session's desk sprite. */
function Avatar({ name }: { name: string | null }) {
  const label = shortName(name);
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

const Time = ({ ts }: { ts: number }) => (
  <time dateTime={new Date(ts).toISOString()} className="text-[11px] text-muted-foreground">
    {ago(ts)}
  </time>
);
const Times = ({ n }: { n: number }) => (n > 1 ? <span className="text-[11px] text-muted-foreground">×{n}</span> : null);

function Row({ it, onOpenSession }: { it: ThreadItem; onOpenSession?: (name: string) => void }) {
  switch (it.kind) {
    case "owner":
    case "reply":
      return (
        <Message from={it.kind === "owner" ? "user" : "assistant"}>
          <div className={`flex items-center gap-2 text-xs text-muted-foreground ${it.kind === "owner" ? "justify-end" : ""}`}>
            <Avatar name={it.from} />
            <span>
              {shortName(it.from)} <ArrowRightIcon className="inline size-3" aria-hidden /> {shortName(it.to)}
            </span>
            <Time ts={it.ts} />
            <Times n={it.count} />
          </div>
          <MessageContent>
            <p className="whitespace-pre-wrap">{it.text}</p>
          </MessageContent>
        </Message>
      );
    case "handoff":
      return (
        <article aria-label={`Chuyển giao từ ${shortName(it.from)} sang ${shortName(it.to)}`} className="w-full max-w-[95%] rounded-lg border border-dashed bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Avatar name={it.from} />
            <span className="font-medium">{shortName(it.from)}</span>
            <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
            <Avatar name={it.to} />
            <span className="font-medium">{shortName(it.to)}</span>
            <span className="ml-auto flex items-center gap-2">
              <Times n={it.count} />
              <Time ts={it.ts} />
            </span>
          </div>
          {it.text && <p className="mt-2 line-clamp-3 border-l-2 pl-2 text-sm text-muted-foreground">{it.text}</p>}
        </article>
      );
    case "task_created":
    case "task_completed": {
      const done = it.kind === "task_completed";
      return (
        <p className="flex w-full max-w-[95%] items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
          {done ? <CheckCircle2Icon className="size-4 text-st-running" aria-hidden /> : <CircleDotIcon className="size-4 text-muted-foreground" aria-hidden />}
          <span className="text-xs text-muted-foreground">{done ? "Xong việc" : "Việc mới"}</span>
          <span className="min-w-0 flex-1 truncate">{it.text || "(không tên)"}</span>
          {it.role && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{it.role}</span>}
          <span className="font-mono text-[11px] text-muted-foreground">{shortName(it.session)}</span>
          <Times n={it.count} />
          <Time ts={it.ts} />
        </p>
      );
    }
    case "needs_you":
      return (
        <div role={it.open ? "alert" : undefined} className={`flex w-full max-w-[95%] flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${it.open ? "border-st-needs bg-st-needs/10" : "text-muted-foreground"}`}>
          <BellRingIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <strong>{shortName(it.session)}</strong> {it.open ? "đang chờ anh" : "đã chờ anh (đã trả lời)"}
            {it.text && <span className="block truncate text-xs text-muted-foreground">{it.text}</span>}
          </span>
          <Times n={it.count} />
          <Time ts={it.ts} />
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
          {shortName(it.session)} {start ? "bắt đầu" : "kết thúc"} <Times n={it.count} /> <Time ts={it.ts} />
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
  onOpenSession,
}: {
  rows: ThreadRow[];
  filters?: ThreadFilters;
  onOpenSession?: (name: string) => void;
}) {
  const items = useMemo(() => buildTeamThread(rows, filters), [rows, filters]);
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-3">
        {items.length === 0 ? (
          <ConversationEmptyState title="Chưa có gì trong luồng" description="Tin nhắn, chuyển giao và việc của team sẽ hiện ở đây." />
        ) : (
          items.map((it) => <Row key={`${it.kind}-${it.key}`} it={it} onOpenSession={onOpenSession} />)
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
