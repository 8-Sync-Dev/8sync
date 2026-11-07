"use client";

import { useCallback, useMemo } from "react";
import { botList, pinChief, type Bot } from "@/lib/bots";
import { primaryKey, rosterBots, rosterSections, type RosterBot, type RosterSection } from "@/lib/roster";
import { readArchive, toggle, type TreeSession } from "@/lib/session-tree";
import type { ChiefView } from "@/lib/server/chief";
import type { Group, GroupsView } from "@/lib/server/groups";
import type { Hq } from "../use-hq";
import type { OfficeState, Room } from "../use-office";
import { usePoll } from "../use-poll";
import { localValue, useUnread } from "../use-session-tree";
import { comboBots, type ComboBot } from "./mention-combobox";

/** GET /api/chief, at the Chief of Staff panel's cadence (components/hq/chief-panel.tsx). */
const CHIEF_POLL_MS = 30_000;
/** GET /api/groups: the list changes only when the owner edits it, the held turns when bots talk. */
const GROUPS_POLL_MS = 15_000;

const NO_IDS: string[] = [];
// Pins and "Ẩn" belong to this browser (like the archive); kept by bot identity (lib/roster botId).
const pinStore = localValue<string[]>("hq.bots.pins", readArchive, NO_IDS);
const hiddenStore = localValue<string[]>("hq.bots.hidden", readArchive, NO_IDS);

export type Roster = {
  /** Every live room as a bot: groups and @-mentions take any of them. */
  all: Bot<Room>[];
  /** The roster rows: helpers (subagents, team workers) left out. */
  bots: RosterBot<Room>[];
  sections: RosterSection<RosterBot<Room>>[];
  /** The Primary Bot's room key. */
  primary: string | null;
  /** The Chief of Staff's room key while it runs. */
  chief: string | null;
  pins: string[];
  hidden: string[];
  togglePin: (id: string) => void;
  toggleHidden: (id: string) => void;
  mention: ComboBot[];
  groups: Group[];
  reloadGroups: () => void;
  /** Room keys of bots with a session that finished off screen. */
  unread: Set<string>;
  markSeen: (key: string) => void;
  /** The office's clock (ms), 0 before it answers. */
  now: number;
  loading: boolean;
  error: string | null;
  retry: () => void;
};

/**
 * Everything the bot roster shows, computed once for the sidebar, Bots, Nhóm and Tìm: every live
 * room as a bot (`all`: groups and @-mentions take any of them), the roster rows (`bots`: helpers
 * left out), its sections, the Primary Bot, groups, pins and the unseen ones.
 */
export function useRoster(hq: Hq, office: OfficeState, sessions: readonly TreeSession[]): Roster {
  const rooms = office.office?.rooms;
  const chiefView = usePoll<ChiefView>(hq.api, "/api/chief", CHIEF_POLL_MS, true).data;
  const chiefRoom = chiefView?.cfg.on && chiefView.live ? chiefView.cfg.room : null;
  const { bots: all, chief } = useMemo(() => pinChief(botList(rooms ?? [], hq.sessions.data, hq.messages.data), chiefRoom), [rooms, hq.sessions.data, hq.messages.data, chiefRoom]);
  const bots = useMemo(() => rosterBots<Room>(all, (r) => r.role), [all]);
  // The projects whose `/solo` Router runs, the newest first: their `core` room coordinates.
  const solo = office.office?.solo;
  const soloRoots = useMemo(
    () =>
      (solo ?? [])
        .filter((p) => p.solo && p.solo.status !== "stopped")
        .sort((a, b) => (b.solo?.updated ?? 0) - (a.solo?.updated ?? 0))
        .map((p) => p.root),
    [solo],
  );
  const primary = useMemo(() => primaryKey(bots, chief, soloRoots), [bots, chief, soloRoots]);
  const pins = pinStore.useValue();
  const hidden = hiddenStore.useValue();
  const sections = useMemo(() => rosterSections(bots, { primary, pins, hidden }), [bots, primary, pins, hidden]);
  const togglePin = useCallback((id: string) => pinStore.set(toggle(pinStore.get(), id)), []);
  const toggleHidden = useCallback((id: string) => hiddenStore.set(toggle(hiddenStore.get(), id)), []);
  const mention = useMemo(() => comboBots(rooms ?? [], all), [rooms, all]);
  const groupsPoll = usePoll<GroupsView>(hq.api, "/api/groups", GROUPS_POLL_MS, true);

  // A bot is unseen while one of its sessions finished off screen (the session tree's blue dot).
  const { keys: unreadKeys, seen } = useUnread();
  const unread = useMemo(() => {
    const out = new Set<string>();
    for (const s of sessions) if (s.room && s.state !== "working" && unreadKeys.includes(s.key)) out.add(s.room);
    return out;
  }, [sessions, unreadKeys]);
  const markSeen = useCallback(
    (key: string) => {
      for (const s of sessions) if (s.room === key || s.key === key) seen(s.key);
    },
    [sessions, seen],
  );

  return {
    all,
    bots,
    sections,
    primary,
    chief,
    pins,
    hidden,
    togglePin,
    toggleHidden,
    mention,
    groups: groupsPoll.data?.groups ?? [],
    reloadGroups: groupsPoll.reload,
    unread,
    markSeen,
    now: office.office?.at ?? 0,
    loading: !office.office && !office.error,
    error: office.error,
    retry: office.retry,
  };
}
