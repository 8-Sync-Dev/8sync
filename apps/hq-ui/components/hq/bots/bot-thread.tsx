"use client";

import { ArrowLeftIcon, PanelRightIcon, SquareTerminalIcon } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { botMessages, type Bot } from "@/lib/bots";
import { messageTargets } from "@/lib/labels";
import type { Room } from "@/lib/server/office";
import { cn } from "@/lib/utils";
import { AskPanel } from "../ask-panel";
import { FilesButton } from "../files-sheet";
import { PathOpenProvider } from "../path-open";
import { useOpenTerminal } from "../room-brief";
import { RoomLogProvider } from "../room-outputs";
import { Composer } from "../team-view";
import type { Message, Session } from "../types";
import type { Hq } from "../use-hq";
import { BotAvatar, StatusPill } from "./bot-avatar";
import { BotBrief } from "./bot-brief";
import { BotConversation } from "./bot-conversation";

const ICON_ONLY_PHONE = "[&_button]:max-md:size-11 [&_button]:max-md:gap-0 [&_button]:max-md:px-0 [&_button]:max-md:text-[0px]";

/**
 * One bot's DM: a header (who, status, where; terminal, files and Nhật ký), the conversation, its open
 * question when it waits for the owner, and the message box. From xl up Nhật ký sits on the right in a
 * resizable pane; below that it opens as a sheet.
 */
export function BotThread({
  bot,
  hq,
  sessions,
  messages,
  now,
  wide,
  mobile,
  onBack,
  onDrawer,
}: {
  bot: Bot<Room>;
  hq: Hq;
  sessions: Session[];
  messages: Message[];
  now: number;
  /** ≥ 1280px: room for the detail pane next to the thread. */
  wide: boolean;
  mobile: boolean;
  onBack: () => void;
  /** Opens a tmux session's live terminal in HQ's drawer. */
  onDrawer: (session: string) => void;
}) {
  const r = bot.room;
  const token = hq.token;
  const mine = useMemo(() => sessions.filter((s) => s.name === r.name || (r.session_id != null && s.session_id === r.session_id)), [sessions, r.name, r.session_id]);
  const own = useMemo(() => botMessages(r, sessions, messages), [r, sessions, messages]);
  const session = mine[0];
  const term = useOpenTerminal(r, !!session?.tmux, token, () => session && onDrawer(session.name));
  const [pane, setPane] = useState(true);
  const [sheet, setSheet] = useState(false);
  const layout = useDefaultLayout({ id: "hq-bot-brief", panelIds: ["thread", "brief"] });
  const side = wide && pane;
  const toggleBrief = () => (wide ? setPane((p) => !p) : setSheet(true));

  const ask =
    bot.status === "needs" ? (
      <AskPanel
        rooms={[{ key: r.key, label: bot.name, session_id: r.session_id, project: bot.project, waiting: r.waiting, ask: r.ask, tmux: !!session?.tmux, interactive: r.interactive }]}
        now={now}
        token={token}
        onOpen={() => term.open?.()}
      />
    ) : null;

  // Esc leaves the thread for the list (a field, a menu or a dialog keeps its own Esc).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t.closest("[role=dialog],[role=menu],[role=listbox]") || ((t.tagName === "TEXTAREA" || t.tagName === "INPUT") && (t as HTMLInputElement).value)) return;
    e.preventDefault();
    onBack();
  };

  const thread = (
    <div className="flex h-full min-h-0 flex-col">
      <BotConversation bot={bot} messages={own} token={token} now={now} footer={ask} />
      {messageTargets(mine).length > 0 ? (
        <Composer hq={hq} sessions={mine} target={session?.name ?? null} onTarget={() => {}} inline />
      ) : (
        <p className="shrink-0 border-t px-4 py-3 text-sm text-muted-foreground">{bot.name} không nhận tin từ HQ. Mở terminal của phiên này để nhắn trực tiếp.</p>
      )}
    </div>
  );

  return (
    <RoomLogProvider sessionId={r.session_id} token={token} working={bot.status === "working"}>
      <PathOpenProvider token={token} base={r.cwd}>
        <div onKeyDown={onKey} className="flex h-full min-h-0 flex-col">
          <header className={cn("flex shrink-0 items-center gap-2 border-b bg-background/95 px-2 py-2 sm:px-3", mobile && "pt-[max(0.5rem,env(safe-area-inset-top))]")}>
            {mobile && (
              <Button variant="ghost" size="icon" onClick={onBack} aria-label="Về danh sách bot" className="size-11 shrink-0">
                <ArrowLeftIcon aria-hidden className="size-5" />
              </Button>
            )}
            <BotAvatar id={bot.key} status={bot.status} size={mobile ? 36 : 40} className={mobile ? undefined : "ml-1"} />
            <div className="min-w-0 flex-1">
              <h2 className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold tracking-tight">{bot.name}</span>
                <StatusPill status={bot.status} />
              </h2>
              <p className="truncate text-xs text-muted-foreground" title={r.cwd ?? undefined}>
                {[bot.qualifier ?? bot.project, bot.branch, r.engine === "omp" ? "omp" : "Claude Code"].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className={cn("flex shrink-0 items-center gap-1", ICON_ONLY_PHONE)}>
              {term.open && (
                <Button type="button" size="sm" variant="outline" onClick={term.open} disabled={term.busy} title={term.title ?? "Mở terminal của bot này"}>
                  <SquareTerminalIcon aria-hidden /> Terminal
                </Button>
              )}
              <FilesButton room={r} token={token} />
              <Button type="button" size="sm" variant={side ? "secondary" : "outline"} aria-pressed={wide ? side : undefined} onClick={toggleBrief} title={wide ? (side ? "Đóng Nhật ký" : "Mở Nhật ký") : "Nhật ký và chi tiết"}>
                <PanelRightIcon aria-hidden /> Nhật ký
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1">
            {side ? (
              <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
                <ResizablePanel id="thread" minSize="40" className="min-h-0">
                  {thread}
                </ResizablePanel>
                <ResizableHandle withHandle aria-label="Kéo để chia chỗ giữa cuộc trò chuyện và Nhật ký" />
                <ResizablePanel id="brief" defaultSize="34" minSize="24" maxSize="50" className="min-h-0 border-l bg-muted/20">
                  <BotBrief bot={bot} now={now} />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              thread
            )}
          </div>

          <Sheet open={sheet && !wide} onOpenChange={setSheet}>
            <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md motion-reduce:animate-none">
              <SheetHeader className="sr-only">
                <SheetTitle>Nhật ký của {bot.name}</SheetTitle>
                <SheetDescription>Chi tiết, file vừa sửa và từng bước bot đã làm.</SheetDescription>
              </SheetHeader>
              <div className="h-full min-h-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
                <BotBrief bot={bot} now={now} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </PathOpenProvider>
    </RoomLogProvider>
  );
}
