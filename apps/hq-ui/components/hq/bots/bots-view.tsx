"use client";

import { PlusIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { threadHint } from "@/lib/bots";
import { botRole } from "@/lib/roster";
import type { Hq } from "../use-hq";
import { BotAvatar } from "./bot-avatar";
import { BotRoster } from "./bot-list";
import { BotThread, type BotViews } from "./bot-thread";
import type { Roster } from "./use-roster";

const WIDE = "(min-width: 1280px)";
const subscribeWide = (on: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", on);
  return () => m.removeEventListener("change", on);
};

/**
 * Bots: a bot's page (components/hq/bots/bot-thread.tsx). Wider screens list the bots in HQ's sidebar
 * (components/hq/sidebar.tsx), so this is the page alone; a phone shows the roster full screen until a
 * bot is picked, then that bot's page full screen with a back arrow (owner 2026-11-07, Grok Bot style).
 */
export function BotsView({
  hq,
  roster,
  openKey,
  mobile,
  onOpen,
  onBack,
  onDrawer,
  onNew,
  views,
}: {
  hq: Hq;
  roster: Roster;
  /** The bot on screen (a room key); null: none yet. */
  openKey: string | null;
  mobile: boolean;
  onOpen: (key: string) => void;
  onBack: () => void;
  onDrawer: (session: string) => void;
  /** "Bot mới", with a template an empty-state card picked. */
  onNew: (template?: string) => void;
  /** Lịch sử phiên, Bản đồ code and Đang biết gì for the open bot. */
  views: (key: string) => BotViews;
}) {
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  const bot = roster.all.find((b) => b.key === openKey) ?? null;

  if (bot) {
    return (
      <BotThread
        key={bot.key}
        bot={bot}
        role={botRole(bot.room.label, bot.room.role)}
        chief={bot.key === roster.chief}
        primary={bot.key === roster.primary}
        hq={hq}
        sessions={hq.sessions.data}
        messages={hq.messages.data}
        now={roster.now}
        wide={wide}
        mobile={mobile}
        onBack={onBack}
        onDrawer={onDrawer}
        all={roster.all}
        mention={roster.mention}
        views={views(bot.key)}
      />
    );
  }
  if (mobile) {
    return (
      <div className="h-full min-h-0 overflow-y-auto overscroll-contain px-2 pt-2">
        <BotRoster roster={roster} selected={null} onOpen={onOpen} onNew={onNew} dense={false} />
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        {!roster.loading && <BotAvatar id="8 Sync" status="idle" size={64} />}
        <p className="text-sm text-muted-foreground">{threadHint(roster.loading, roster.error != null, roster.all.length)}</p>
        {!roster.loading && roster.all.length === 0 && (
          <Button type="button" onClick={() => onNew()}>
            <PlusIcon aria-hidden /> Tạo bot mới
          </Button>
        )}
      </div>
    </div>
  );
}
