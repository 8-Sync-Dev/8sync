"use client";

import { mentionBots, type MentionBot } from "@/lib/bot-mention";
import { BOT_STATUS_LABEL, type Bot, type BotRoom, type BotStatus } from "@/lib/bots";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";

/** A bot the "@" picker offers: its handle (lib/bot-mention.ts) plus the face and state the list shows. */
export type ComboBot = MentionBot & { key: string; status: BotStatus };

/**
 * Handles from the office's rooms in the office's order, the same list the server parses
 * (`mentionBots(liveRooms())`), so a picked handle is the one the send route reads back.
 */
export function comboBots(rooms: readonly BotRoom[], bots: readonly Bot[]): ComboBot[] {
  const byId = new Map(bots.map((b) => [b.room.name, b]));
  return mentionBots(rooms).flatMap((m) => {
    const b = byId.get(m.id);
    return b ? [{ ...m, key: b.key, status: b.status }] : [];
  });
}

/**
 * The "@bot" options of a combobox textarea (components/hq/mention-textarea.tsx owns the input, the
 * keys and aria-activedescendant; WAI-ARIA APG "combobox with listbox popup"). Each option's id is
 * `${listId}-${i}`; mouse down picks without blurring the box.
 */
export function BotOptions({
  listId,
  className,
  prefix,
  bots,
  active,
  onActive,
  onPick,
}: {
  listId: string;
  className: string;
  prefix: string;
  bots: ComboBot[];
  active: number;
  onActive: (i: number) => void;
  onPick: (b: ComboBot) => void;
}) {
  return (
    <ul id={listId} role="listbox" aria-label="Bot" className={className}>
      <li aria-hidden className="px-2 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">@{prefix}</span> · bot · ↑↓ chọn · Enter/Tab · Esc đóng
      </li>
      {bots.map((b, i) => (
        <li
          key={b.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === active}
          className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs", i === active && "bg-accent text-accent-foreground")}
          onMouseDown={(ev) => {
            ev.preventDefault();
            onPick(b);
          }}
          onMouseEnter={() => onActive(i)}
        >
          <BotAvatar id={b.key} status={b.status} size={20} />
          <span className="shrink-0 font-medium">{b.name}</span>
          <span className="min-w-0 truncate font-mono text-muted-foreground">@{b.handle}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{BOT_STATUS_LABEL[b.status]}</span>
        </li>
      ))}
    </ul>
  );
}
