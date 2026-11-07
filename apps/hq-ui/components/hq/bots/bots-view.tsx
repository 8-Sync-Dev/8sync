"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { botList, filterBots, openBotKey, pinChief, threadHint, type BotFilter } from "@/lib/bots";
import type { ChiefView } from "@/lib/server/chief";
import type { GroupsView } from "@/lib/server/groups";
import type { OfficeState } from "../use-office";
import type { Hq } from "../use-hq";
import { usePoll } from "../use-poll";
import { BotAvatar } from "./bot-avatar";
import { BotList } from "./bot-list";
import { BotThread } from "./bot-thread";
import { GroupThread } from "./group-thread";
import { GroupsSection, NewGroupDialog } from "./groups-section";
import { comboBots } from "./mention-combobox";
import { NewBotSheet } from "./new-bot-sheet";

const WIDE = "(min-width: 1280px)";
const subscribeWide = (on: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", on);
  return () => m.removeEventListener("change", on);
};
/** A history entry while a phone shows a thread: the system Back returns to the list. */
const HISTORY_KEY = "hqBot";
/** GET /api/chief, at the Chief of Staff panel's cadence (components/hq/chief-panel.tsx). */
const CHIEF_POLL_MS = 30_000;
/** GET /api/groups: the list changes only when the owner edits it, the held turns when bots talk. */
const GROUPS_POLL_MS = 15_000;

/**
 * Bots: every live room as a teammate to message. A phone shows the list, then one thread full screen
 * with a back arrow; wider screens show the list and the open thread side by side (resizable), the
 * first bot open when none is picked. The open thread follows its room key, never the list order: a
 * room that climbs the list (Messenger style, components/hq/bots/bot-list.tsx) leaves it where it is.
 */
export function BotsView({
  hq,
  office,
  selected,
  onSelect,
  onDrawer,
}: {
  hq: Hq;
  office: OfficeState;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onDrawer: (session: string) => void;
}) {
  const mobile = useIsMobile();
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BotFilter>("all");
  // "Bot mới": open, with the template an empty-state card picked.
  const [newBot, setNewBot] = useState<{ template: string | null } | null>(null);
  const q = useDeferredValue(query);
  const rooms = office.office?.rooms;
  const now = office.office?.at ?? 0;
  const sessions = hq.sessions.data;
  const messages = hq.messages.data;
  const chiefView = usePoll<ChiefView>(hq.api, "/api/chief", CHIEF_POLL_MS, true).data;
  const chiefRoom = chiefView?.cfg.on && chiefView.live ? chiefView.cfg.room : null;
  const { bots: all, chief } = useMemo(() => pinChief(botList(rooms ?? [], sessions, messages), chiefRoom), [rooms, sessions, messages, chiefRoom]);
  const shown = useMemo(() => filterBots(all, q, filter), [all, q, filter]);
  const mention = useMemo(() => comboBots(rooms ?? [], all), [rooms, all]);
  const groupsPoll = usePoll<GroupsView>(hq.api, "/api/groups", GROUPS_POLL_MS, true);
  const groups = groupsPoll.data?.groups ?? [];
  const [groupId, setGroupId] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const group = groups.find((g) => g.id === groupId) ?? null;
  const layout = useDefaultLayout({ id: "hq-bots-columns", panelIds: ["list", "thread"] });

  // The open bot by key (lib/bots openBotKey): the pick, else the one this view opened by itself, which
  // keeps the pane while other rooms re-sort above it. A bot whose room ended is gone; a wider screen then
  // opens the top one left.
  const live = useMemo(() => all.map((b) => b.key), [all]);
  const [held, setHeld] = useState<string | null>(null);
  const openKey = openBotKey(live, shown[0]?.key ?? all[0]?.key ?? null, selected, held, !mobile);
  // Adjusting state while rendering (react.dev "storing information from previous renders"): no extra
  // commit with the wrong bot. A null (rooms not loaded yet, a phone) keeps the last one held.
  if (openKey != null && openKey !== held) setHeld(openKey);
  const bot = all.find((b) => b.key === openKey) ?? null;

  const open = useCallback(
    (key: string) => {
      if (mobile && window.history.state?.[HISTORY_KEY] == null) window.history.pushState({ ...window.history.state, [HISTORY_KEY]: key }, "");
      setGroupId(null);
      onSelect(key);
    },
    [mobile, onSelect],
  );
  const openGroup = useCallback(
    (id: string) => {
      if (mobile && window.history.state?.[HISTORY_KEY] == null) window.history.pushState({ ...window.history.state, [HISTORY_KEY]: `group:${id}` }, "");
      setGroupId(id);
    },
    [mobile],
  );
  const back = useCallback(() => {
    if (mobile && window.history.state?.[HISTORY_KEY] != null) window.history.back();
    else if (mobile) onSelect(null);
    else document.querySelector<HTMLElement>(`[data-bot="${CSS.escape(bot?.key ?? "")}"]`)?.focus();
  }, [mobile, onSelect, bot?.key]);
  useEffect(() => {
    const onPop = () => {
      if (window.history.state?.[HISTORY_KEY] != null) return;
      setGroupId(null);
      onSelect(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onSelect]);

  const loading = !office.office && !office.error;
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
      loading={loading}
      error={office.error}
      onRetry={office.retry}
      onNew={(template) => setNewBot({ template: template ?? null })}
      chief={chief}
      groups={<GroupsSection groups={groups} all={all} selected={group?.id ?? null} onOpen={openGroup} onNew={() => setNewGroup(true)} />}
    />
  );
  const leaveGroup = () => {
    if (mobile && window.history.state?.[HISTORY_KEY] != null) window.history.back();
    else setGroupId(null);
  };
  const thread = group ? (
    <GroupThread key={group.id} hq={hq} group={group} all={all} mention={mention} mobile={mobile} onBack={leaveGroup} onGroups={groupsPoll.reload} />
  ) : bot ? (
    <BotThread key={bot.key} bot={bot} chief={bot.key === chief} hq={hq} sessions={sessions} messages={messages} now={now} wide={wide} mobile={mobile} onBack={back} onDrawer={onDrawer} all={all} mention={mention} />
  ) : (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        {!loading && <BotAvatar id="8 Sync" status="idle" size={64} />}
        <p className="text-sm text-muted-foreground">{threadHint(loading, office.error != null, all.length)}</p>
      </div>
    </div>
  );
  const sheet = (
    <NewBotSheet
      hq={hq}
      open={newBot != null}
      onOpenChange={(o) => !o && setNewBot(null)}
      initialTemplate={newBot?.template}
      onCreated={(key) => {
        office.retry();
        open(key);
      }}
    />
  );

  const dialog = (
    <NewGroupDialog
      hq={hq}
      open={newGroup}
      onOpenChange={setNewGroup}
      all={all}
      onCreated={(id) => {
        groupsPoll.reload();
        openGroup(id);
      }}
    />
  );

  if (mobile)
    return (
      <div className="h-full min-h-0">
        {group || bot ? thread : list}
        {sheet}
        {dialog}
      </div>
    );
  return (
    <>
    <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <ResizablePanel id="list" defaultSize="30" minSize="22" maxSize="45" className="min-h-0">
        {list}
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Kéo để chia chỗ giữa danh sách bot và cuộc trò chuyện" />
      <ResizablePanel id="thread" minSize="40" className="min-h-0">
        {thread}
      </ResizablePanel>
    </ResizablePanelGroup>
    {sheet}
    {dialog}
    </>
  );
}
