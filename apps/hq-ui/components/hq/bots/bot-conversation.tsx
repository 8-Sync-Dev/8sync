"use client";

import { ChevronRightIcon, CircleAlertIcon, RotateCwIcon, UsersIcon, WrenchIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message as ChatMessage, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { fileRefsIn } from "@/lib/ask-quote";
import { splitDigest } from "@/lib/digest-frame";
import { threadItems, type Bot, type ThreadItem } from "@/lib/bots";
import { bareFileNamesIn } from "@/lib/file-path";
import type { ActivityEvent } from "@/lib/server/activity";
import { cn } from "@/lib/utils";
import { MessageText, ReplyMedia } from "../attachments";
import { DeliveryTag, clock } from "../bits";
import { CopyButton } from "../copy-button";
import { FileChips, pathMarkdown, useFileSpots } from "../path-open";
import { useRoomLog } from "../room-outputs";
import type { Message } from "../types";
import { BotAvatar } from "./bot-avatar";

const DAY_MS = 86_400_000;

/** "Hôm nay", "Hôm qua", else the weekday and date, in the owner's words. */
function dayVi(ts: number, now: number): string {
  const start = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const d = Math.round((start(now) - start(ts)) / DAY_MS);
  if (d === 0) return "Hôm nay";
  if (d === 1) return "Hôm qua";
  return new Date(ts).toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric" });
}

/**
 * The DM thread with one bot: the owner's messages on the right, the bot's replies on the left, each
 * turn's tool calls folded under "N bước" between them. Built from HQ's messages and the room's
 * transcript (RoomLogProvider), since an omp room answers only in its transcript.
 */
export function BotConversation({ bot, messages, token, now: officeNow, footer }: { bot: Bot; messages: Message[]; token: string; now: number; footer?: React.ReactNode }) {
  const ctx = useRoomLog();
  const log = ctx?.log ?? null;
  const items = useMemo(() => threadItems(messages, log?.turns ?? [], log?.events ?? []), [messages, log]);
  const now = ctx?.now || officeNow;
  const groups = useMemo(() => {
    const out: { day: string; items: ThreadItem<Message>[] }[] = [];
    for (const it of items) {
      const day = dayVi(it.at, now);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(it);
    }
    return out;
  }, [items, now]);

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl gap-0 px-3 py-3 sm:px-6">
        {ctx?.error && !log ? (
          <div role="alert" className="my-6 space-y-3 rounded-lg bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium">Không đọc được cuộc trò chuyện của {bot.display}.</p>
            <p className="text-muted-foreground">{ctx.error}</p>
            <Button size="sm" variant="outline" onClick={ctx.retry} className="max-md:h-11">
              <RotateCwIcon aria-hidden /> Thử lại
            </Button>
          </div>
        ) : !log && bot.room.session_id ? (
          <ThreadSkeleton />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <BotAvatar id={bot.key} status={bot.status} size={64} />
            <p className="font-medium">Chưa có cuộc trò chuyện nào với {bot.display}.</p>
            <p className="max-w-sm text-sm text-pretty text-muted-foreground">Nhắn ở ô bên dưới. Tin anh gửi, các bước bot làm và câu trả lời của bot hiện ở đây.</p>
          </div>
        ) : (
          <div aria-label={`Trò chuyện với ${bot.display}`} className="pb-2">
            {groups.map((g) => (
              <section key={g.day + g.items[0].key}>
                <div aria-hidden className="sticky top-0 z-10 -mx-2 flex justify-center bg-background/95 px-2 pt-3 pb-2 backdrop-blur-[2px]">
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{g.day}</span>
                </div>
                <div className="space-y-4">
                  {g.items.map((it) => (it.kind === "turn" ? <TurnItem key={it.key} it={it} bot={bot} token={token} rev={log?.rev ?? ""} /> : <MessageItem key={it.key} it={it} bot={bot} token={token} />))}
                </div>
              </section>
            ))}
          </div>
        )}
        {footer && <div className="pt-4">{footer}</div>}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

/** The owner's words, and the "ai đang làm gì" digest HQ put under them (lib/server/digest.ts) folded into one line. */
function OwnerText({ text, token }: { text: string | null; token: string }) {
  const { body, digest } = splitDigest(text ?? "");
  return (
    <>
      <MessageText text={body} token={token} className="whitespace-pre-wrap break-words" />
      {digest && (
        <Collapsible className="mt-1.5">
          <CollapsibleTrigger className="group/dg inline-flex min-h-7 items-center gap-1 rounded-md text-[11px] opacity-80 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 max-md:min-h-11">
            <ChevronRightIcon aria-hidden className="size-3 transition-transform group-data-[state=open]/dg:rotate-90 motion-reduce:transition-none" />
            HQ kèm bảng ai đang làm gì
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words opacity-90">{digest}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

function Mine({ children, at, tag }: { children: React.ReactNode; at: number | null; tag?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <ChatMessage from="user" className="max-w-[85%]">
        <MessageContent className="group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:px-3.5 group-[.is-user]:py-2.5">{children}</MessageContent>
      </ChatMessage>
      <span className="flex items-center gap-2 pr-1 text-[11px] text-muted-foreground tabular">
        {tag}
        {at != null && clock(at)}
      </span>
    </div>
  );
}

function Theirs({ id, status, who, at, children, actions }: { id: string; status: Bot["status"]; who: string; at: number | null; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <BotAvatar id={id} status={status} size={28} className="mt-5" />
      <div className="min-w-0 max-w-[88%] flex-1">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{who}</span>
          {at != null && <span className="tabular">{clock(at)}</span>}
          {actions && <span className="ml-auto">{actions}</span>}
        </div>
        <div className="w-fit max-w-full rounded-2xl rounded-tl-md bg-card px-3.5 py-2.5 text-sm ring-1 ring-border">{children}</div>
      </div>
    </div>
  );
}

/** Another bot's words to this one (its `[phòng X]` source line): on the left, never as the owner's. */
function FromBot({ name, at, text }: { name: string; at: number | null; text: string }) {
  return (
    <div className="flex flex-col items-start gap-1 pl-9">
      <span className="text-[11px] text-muted-foreground">
        Từ bot <span className="font-medium text-foreground/80">{name}</span>
        {at != null && <span className="tabular"> · {clock(at)}</span>}
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words">{text}</div>
    </div>
  );
}

const TurnItem = memo(function TurnItem({ it, bot, token, rev }: { it: Extract<ThreadItem<Message>, { kind: "turn" }>; bot: Bot; token: string; rev: string }) {
  const { turn, sent, prompt, from, steps } = it;
  const output = turn.output;
  return (
    <div className="space-y-3">
      {sent ? (
        <Mine at={sent.ts} tag={<DeliveryTag delivery={sent.delivery} />}>
          <OwnerText text={sent.text} token={token} />
        </Mine>
      ) : prompt && from?.kind === "room" ? (
        <FromBot name={from.name} at={turn.at} text={prompt} />
      ) : prompt ? (
        <Mine at={turn.at} tag={from?.kind === "auto" ? <span>Tự động</span> : <span>Gõ trong terminal</span>}>
          <p className="whitespace-pre-wrap break-words">{prompt}</p>
        </Mine>
      ) : null}
      {steps.length > 0 && <Steps steps={steps} errors={turn.errors} live={turn.live} />}
      {output ? (
        <Theirs id={bot.key} status={bot.status} who={bot.display} at={turn.outputAt} actions={<CopyButton value={output} label="Chép câu trả lời" className="size-7 max-md:size-9" />}>
          <Reply text={output} token={token} rev={rev} />
        </Theirs>
      ) : turn.live ? (
        <Theirs id={bot.key} status="working" who={bot.display} at={null}>
          <span className="inline-flex items-center gap-1 py-1" aria-label={`${bot.display} đang làm`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-[hq-typing_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </span>
        </Theirs>
      ) : null}
    </div>
  );
});

function Reply({ text, token, rev }: { text: string; token: string; rev: string }) {
  const paths = useMemo(() => fileRefsIn(text), [text]);
  const bare = useMemo(() => bareFileNamesIn(text), [text]);
  const spots = useFileSpots(useMemo(() => [...paths, ...bare], [paths, bare]), rev);
  return (
    <>
      <MessageResponse {...pathMarkdown}>{text}</MessageResponse>
      <ReplyMedia text={text} token={token} />
      {(paths.length > 0 || bare.length > 0) && (
        <div className="mt-2">
          <FileChips paths={paths} bare={bare} spots={spots} />
        </div>
      )}
    </>
  );
}

/** A turn's tool calls and subagents, folded: "12 bước · 2 lỗi" opens the list. */
function Steps({ steps, errors, live }: { steps: ActivityEvent[]; errors: number; live: boolean }) {
  const agents = steps.filter((s) => s.kind === "agent").length;
  const tools = steps.length - agents;
  const label = [tools && `${tools} bước`, agents && `${agents} subagent`, errors && `${errors} lỗi`].filter(Boolean).join(" · ");
  return (
    <Collapsible className="pl-9">
      <CollapsibleTrigger className="group/steps inline-flex min-h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:min-h-11">
        <ChevronRightIcon aria-hidden className="size-3.5 transition-transform duration-150 group-data-[state=open]/steps:rotate-90 motion-reduce:transition-none" />
        <WrenchIcon aria-hidden className="size-3.5" />
        <span className={cn(errors > 0 && "text-destructive")}>{label}</span>
        {live && <span className="text-st-running">· đang chạy</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-1 space-y-0.5 border-l pl-3 text-xs">
          {steps.map((s, i) => (
            <li key={i} className="flex min-w-0 items-baseline gap-2 py-0.5">
              {s.kind === "agent" ? <UsersIcon aria-hidden className="size-3 shrink-0 translate-y-0.5 text-muted-foreground" /> : s.status === "error" ? <CircleAlertIcon aria-hidden className="size-3 shrink-0 translate-y-0.5 text-destructive" /> : <span aria-hidden className="size-3 shrink-0" />}
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{s.kind === "agent" ? "subagent" : (s.tool ?? "tool")}</span>
              <span className={cn("min-w-0 truncate", s.status === "error" && "text-destructive")} title={s.text}>
                {s.text}
              </span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MessageItem({ it, bot, token }: { it: Extract<ThreadItem<Message>, { kind: "message" }>; bot: Bot; token: string }) {
  const { m, from, body } = it;
  if (m.kind === "owner_message" && from?.kind === "room") return <FromBot name={from.name} at={m.ts} text={body ?? ""} />;
  if (m.kind === "owner_message")
    return (
      <Mine at={m.ts} tag={from?.kind === "auto" ? <span>Tự động</span> : <DeliveryTag delivery={m.delivery} />}>
        {from?.kind === "auto" ? <p className="whitespace-pre-wrap break-words">{body}</p> : <OwnerText text={m.text} token={token} />}
      </Mine>
    );
  const own = m.from_ === bot.room.name || m.from_ === bot.room.session_id;
  return (
    <Theirs id={own ? bot.key : (m.from_ ?? "hq")} status={own ? bot.status : "idle"} who={own ? bot.display : (m.from_ ?? "HQ")} at={m.ts}>
      <MessageResponse {...pathMarkdown}>{m.text ?? ""}</MessageResponse>
      <ReplyMedia text={m.text} token={token} />
    </Theirs>
  );
}

function ThreadSkeleton() {
  return (
    <div aria-busy aria-label="Đang tải cuộc trò chuyện" className="space-y-5 py-4">
      <Skeleton className="ml-auto h-10 w-3/5 rounded-2xl" />
      <div className="flex gap-2.5">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-20 w-4/5 rounded-2xl" />
      </div>
      <Skeleton className="ml-auto h-8 w-2/5 rounded-2xl" />
      <div className="flex gap-2.5">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-14 w-3/5 rounded-2xl" />
      </div>
    </div>
  );
}
