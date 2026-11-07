"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { botList, filterBots, type BotFilter } from "@/lib/bots";
import type { OfficeState } from "../use-office";
import type { Hq } from "../use-hq";
import { BotAvatar } from "./bot-avatar";
import { BotList } from "./bot-list";
import { BotThread } from "./bot-thread";

const WIDE = "(min-width: 1280px)";
const subscribeWide = (on: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", on);
  return () => m.removeEventListener("change", on);
};
/** A history entry while a phone shows a thread: the system Back returns to the list. */
const HISTORY_KEY = "hqBot";

/**
 * Bots: every live room as a teammate to message. A phone shows the list, then one thread full screen
 * with a back arrow; wider screens show the list and the open thread side by side (resizable), the
 * first bot open when none is picked.
 */
export function BotsView({
  hq,
  office,
  selected,
  onSelect,
  onDrawer,
  onNew,
}: {
  hq: Hq;
  office: OfficeState;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onDrawer: (session: string) => void;
  onNew: () => void;
}) {
  const mobile = useIsMobile();
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BotFilter>("all");
  const q = useDeferredValue(query);
  const rooms = office.office?.rooms;
  const now = office.office?.at ?? 0;
  const sessions = hq.sessions.data;
  const messages = hq.messages.data;
  const all = useMemo(() => botList(rooms ?? [], sessions, messages), [rooms, sessions, messages]);
  const shown = useMemo(() => filterBots(all, q, filter), [all, q, filter]);
  const layout = useDefaultLayout({ id: "hq-bots-columns", panelIds: ["list", "thread"] });

  // A bot whose room ended is gone; a wider screen then opens the first one left.
  const picked = all.find((b) => b.key === selected) ?? null;
  const bot = picked ?? (mobile ? null : (shown[0] ?? all[0] ?? null));

  const open = useCallback(
    (key: string) => {
      if (mobile && window.history.state?.[HISTORY_KEY] == null) window.history.pushState({ ...window.history.state, [HISTORY_KEY]: key }, "");
      onSelect(key);
    },
    [mobile, onSelect],
  );
  const back = useCallback(() => {
    if (mobile && window.history.state?.[HISTORY_KEY] != null) window.history.back();
    else if (mobile) onSelect(null);
    else document.querySelector<HTMLElement>(`[data-bot="${CSS.escape(bot?.key ?? "")}"]`)?.focus();
  }, [mobile, onSelect, bot?.key]);
  useEffect(() => {
    const onPop = () => {
      if (window.history.state?.[HISTORY_KEY] == null) onSelect(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onSelect]);

  const list = (
    <BotList
      all={all}
      bots={shown}
      selected={bot?.key ?? null}
      now={now}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      onOpen={open}
      loading={!office.office && !office.error}
      error={office.error}
      onRetry={office.retry}
      onNew={onNew}
    />
  );
  const thread = bot ? (
    <BotThread key={bot.key} bot={bot} hq={hq} sessions={sessions} messages={messages} now={now} wide={wide} mobile={mobile} onBack={back} onDrawer={onDrawer} />
  ) : (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <BotAvatar id="8 Sync" status="idle" size={64} />
        <p className="text-sm text-muted-foreground">{all.length ? "Chọn một bot để xem cuộc trò chuyện." : "Bot sẽ hiện ở đây khi có phiên đang chạy."}</p>
      </div>
    </div>
  );

  if (mobile) return <div className="h-full min-h-0">{bot ? thread : list}</div>;
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <ResizablePanel id="list" defaultSize="30" minSize="22" maxSize="45" className="min-h-0">
        {list}
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Kéo để chia chỗ giữa danh sách bot và cuộc trò chuyện" />
      <ResizablePanel id="thread" minSize="40" className="min-h-0">
        {thread}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
