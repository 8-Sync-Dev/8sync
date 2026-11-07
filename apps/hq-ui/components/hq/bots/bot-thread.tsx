"use client";

import { ArrowLeftIcon, PanelRightIcon, SquareTerminalIcon } from "lucide-react";
import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useDefaultLayout } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { BotKnows } from "./bot-knows";
import { ForwardCards } from "./forward-cards";
import type { ComboBot } from "./mention-combobox";
import { ChiefBadge, PrimaryBadge } from "./bot-list";
import { ChiefComposer } from "./chief-composer";
import { useBotBrief } from "./use-bot-brief";

const ICON_ONLY_PHONE = "[&_button]:max-md:size-11 [&_button]:max-md:gap-0 [&_button]:max-md:px-0 [&_button]:max-md:text-[0px]";

/** What the bot page's Lịch sử phiên and Bản đồ code tabs show; each renders only while open. */
export type BotViews = {
  /** Its sessions, worktrees and subagents. */
  history: () => ReactNode;
  /** The code map of its repo. */
  codemap: () => ReactNode;
};
type View = "chat" | "history" | "codemap" | "knows";

/**
 * One bot's page (owner 2026-11-07, Grok Bot style): a header (face, name, role, project, state;
 * terminal, files and Nhật ký) and tabs: Chat (the conversation, its open question while it waits
 * for the owner, the handoff cards, the message box), Lịch sử phiên, Bản đồ code and Đang biết gì.
 * From xl up Nhật ký sits beside the chat in a resizable pane; below that it opens as a sheet.
 */
export function BotThread({
  bot,
  role,
  chief = false,
  primary = false,
  hq,
  sessions,
  messages,
  now,
  wide,
  mobile,
  onBack,
  onDrawer,
  all = [],
  mention = [],
  views,
}: {
  bot: Bot<Room>;
  /** Its job, under the name (lib/roster botRole). */
  role: string;
  /** The Chief of Staff: its box posts to /api/chief/ask. */
  chief?: boolean;
  /** The Primary Bot: coordinates the others (lib/roster primaryKey). */
  primary?: boolean;
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
  /** Every live bot: the "Trả lời từ B" cards find B here. */
  all?: Bot<Room>[];
  /** What "@" can name (components/hq/bots/mention-combobox.tsx); this bot itself is left out. */
  mention?: ComboBot[];
  views: BotViews;
}) {
  const [view, setView] = useState<View>("chat");
  const r = bot.room;
  const token = hq.token;
  const mine = useMemo(() => sessions.filter((s) => s.name === r.name || (r.session_id != null && s.session_id === r.session_id)), [sessions, r.name, r.session_id]);
  const own = useMemo(() => botMessages(r, sessions, messages), [r, sessions, messages]);
  const session = mine[0];
  const brief = useBotBrief(hq.api, r);
  const briefLine = brief?.waiting ?? brief?.doing ?? null;
  const term = useOpenTerminal(r, !!session?.tmux, token, () => session && onDrawer(session.name));
  const [pane, setPane] = useState(true);
  const [sheet, setSheet] = useState(false);
  const layout = useDefaultLayout({ id: "hq-bot-brief", panelIds: ["thread", "brief"] });
  const side = wide && pane;
  const toggleBrief = () => (wide ? setPane((p) => !p) : setSheet(true));

  // "@B …" in this thread goes to B with this bot's context (POST /api/forward); the answer shows as a card.
  const others = useMemo(() => mention.filter((b) => b.id !== r.name), [mention, r.name]);
  const [forwarded, setForwarded] = useState(0);
  const forward = useCallback(
    async (to: string[], text: string) => {
      let ok = 0;
      for (const id of to) {
        const name = others.find((b) => b.id === id)?.name ?? id;
        try {
          const res = await hq.api<{ delivery: string; error: string | null }>("/api/forward", { method: "POST", body: { from: r.name, to: id, text } });
          if (res.delivery === "failed") toast.error(`Chưa tới ${name}: ${res.error}`);
          else ok++;
        } catch (e) {
          toast.error(`${name}: ${(e as Error).message}`);
        }
      }
      if (ok) {
        toast.success(`Đã gửi cho ${to.map((id) => others.find((b) => b.id === id)?.name ?? id).join(", ")} kèm ngữ cảnh của ${bot.display}`);
        setForwarded((n) => n + 1);
      }
      return ok > 0;
    },
    [hq, others, r.name, bot.display],
  );

  const ask =
    bot.status === "needs" ? (
      <AskPanel
        rooms={[{ key: r.key, label: bot.display, session_id: r.session_id, project: bot.project, waiting: r.waiting, ask: r.ask, tmux: !!session?.tmux, interactive: r.interactive }]}
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

  // The handoffs show in every thread, the Primary Bot's too: it is the one that hands work out.
  const thread = (
    <div className="flex h-full min-h-0 flex-col">
      <BotConversation bot={bot} messages={own} token={token} now={now} footer={ask} />
      <ForwardCards hq={hq} bot={bot} all={all} now={now} nonce={forwarded} />
      {chief ? (
        <ChiefComposer hq={hq} name={bot.display} />
      ) : messageTargets(mine).length > 0 ? (
        <Composer hq={hq} sessions={mine} target={session?.name ?? null} onTarget={() => {}} inline bots={others} onForward={forward} />
      ) : (
        <p className="shrink-0 border-t px-4 py-3 text-sm text-muted-foreground">{bot.display} không nhận tin từ HQ. Mở terminal của phiên này để nhắn trực tiếp.</p>
      )}
    </div>
  );
  const tabs: [View, string][] = [
    ["chat", "Chat"],
    ["history", "Lịch sử phiên"],
    ["codemap", "Bản đồ code"],
    ["knows", "Đang biết gì"],
  ];
  const chat = (
    <div className="h-full min-h-0">
      {side ? (
        <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
          <ResizablePanel id="thread" minSize="40" className="min-h-0">
            {thread}
          </ResizablePanel>
          <ResizableHandle withHandle aria-label="Kéo để chia chỗ giữa cuộc trò chuyện và Nhật ký" />
          <ResizablePanel id="brief" defaultSize="34" minSize="24" maxSize="50" className="min-h-0 border-l bg-muted/20">
            <BotBrief bot={bot} brief={brief} now={now} />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        thread
      )}
    </div>
  );

  return (
    <RoomLogProvider sessionId={r.session_id} token={token} working={bot.status === "working"}>
      <PathOpenProvider token={token} base={r.cwd}>
        <Tabs value={view} onValueChange={(v) => setView(v as View)} onKeyDown={onKey} className="flex h-full min-h-0 flex-col gap-0">
          <header className={cn("flex shrink-0 items-center gap-2 border-b bg-background/95 px-2 py-2 sm:px-3", mobile && "pt-[max(0.5rem,env(safe-area-inset-top))]")}>
            {mobile && (
              <Button variant="ghost" size="icon" onClick={onBack} aria-label="Về danh sách bot" className="size-11 shrink-0">
                <ArrowLeftIcon aria-hidden className="size-5" />
              </Button>
            )}
            <BotAvatar id={bot.key} status={bot.status} size={mobile ? 36 : 44} className={mobile ? undefined : "ml-1"} />
            <div className="min-w-0 flex-1">
              <h2 className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold tracking-tight">{bot.display}</span>
                {chief ? <ChiefBadge /> : primary ? <PrimaryBadge /> : null}
                <StatusPill status={bot.status} />
              </h2>
              <p className="truncate text-xs text-muted-foreground" title={r.cwd ?? undefined}>
                <span className="font-medium text-foreground/80">{role}</span>
                {" · "}
                {[bot.project, bot.branch, r.engine === "omp" ? "omp" : "Claude Code"].filter(Boolean).join(" · ")}
              </p>
              {briefLine && (
                <p className={cn("truncate text-xs", brief?.waiting ? "text-foreground" : "text-muted-foreground")} title={briefLine}>
                  {brief?.waiting ? "Chờ anh: " : "Đang: "}
                  {briefLine}
                </p>
              )}
            </div>
            <div className={cn("flex shrink-0 items-center gap-1", ICON_ONLY_PHONE)}>
              {term.open && (
                <Button type="button" size="sm" variant="outline" onClick={term.open} disabled={term.busy} title={term.title ?? "Mở terminal của bot này"}>
                  <SquareTerminalIcon aria-hidden /> Terminal
                </Button>
              )}
              <FilesButton room={r} token={token} />
              <Button type="button" size="sm" variant={side && view === "chat" ? "secondary" : "outline"} aria-pressed={wide ? side : undefined} onClick={() => { setView("chat"); toggleBrief(); }} title={wide ? (side ? "Đóng Nhật ký" : "Mở Nhật ký") : "Nhật ký và chi tiết"}>
                <PanelRightIcon aria-hidden /> Nhật ký
              </Button>
            </div>
          </header>
          <div className="shrink-0 overflow-x-auto border-b px-3 [scrollbar-width:none] sm:px-4">
            <TabsList variant="line" aria-label={`Trang của ${bot.display}`} className="h-10 justify-start gap-4 max-md:h-11">
              {tabs.map(([v, label]) => (
                <TabsTrigger key={v} value={v} className="flex-none px-0 max-md:h-11">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* The chat stays mounted while another tab is open: a half-written message survives. */}
          <TabsContent value="chat" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
            {chat}
          </TabsContent>
          <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto">
            {view === "history" && views.history()}
          </TabsContent>
          <TabsContent value="codemap" className="min-h-0 flex-1">
            {view === "codemap" && views.codemap()}
          </TabsContent>
          <TabsContent value="knows" className="min-h-0 flex-1 overflow-y-auto">
            {view === "knows" && <BotKnows hq={hq} bot={bot} page />}
          </TabsContent>

          <Sheet open={sheet && !wide} onOpenChange={setSheet}>
            <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md motion-reduce:animate-none">
              <SheetHeader className="sr-only">
                <SheetTitle>Nhật ký của {bot.display}</SheetTitle>
                <SheetDescription>Chi tiết, file vừa sửa và từng bước bot đã làm.</SheetDescription>
              </SheetHeader>
              <div className="h-full min-h-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
                <BotBrief bot={bot} brief={brief} now={now} />
              </div>
            </SheetContent>
          </Sheet>
        </Tabs>
      </PathOpenProvider>
    </RoomLogProvider>
  );
}
