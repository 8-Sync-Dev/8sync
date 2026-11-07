"use client";

import { useMemo } from "react";
import { recentFiles, type Bot } from "@/lib/bots";
import { agoVi } from "@/lib/now";
import { roomModelLabel } from "@/lib/roles";
import type { Room } from "@/lib/server/office";
import { FileChips, useFileSpots } from "../path-open";
import { RoomLog } from "../room-log";
import { useRoomLog } from "../room-outputs";
import { BotAvatar, StatusPill } from "./bot-avatar";

/**
 * The bot's detail pane: who it is and where it works, the files it wrote lately, then its Nhật ký
 * (results per turn, every step). Inside the thread's RoomLogProvider and PathOpenProvider.
 */
export function BotBrief({ bot, now, onFull }: { bot: Bot<Room>; now: number; onFull?: () => void }) {
  const r = bot.room;
  const ctx = useRoomLog();
  const files = useMemo(() => recentFiles(ctx?.log?.events ?? []), [ctx?.log?.events]);
  const spots = useFileSpots(files, ctx?.log?.rev ?? "");
  const model = roomModelLabel(r);
  const rows: [string, string | null][] = [
    ["Đang làm", bot.status === "working" || bot.status === "needs" ? r.doing : null],
    ["Dự án", bot.project],
    ["Nhánh", bot.branch],
    ["Model", model],
    ["Engine", r.engine === "omp" ? "omp" : "Claude Code"],
    ["Lần cuối", r.last_active ? agoVi(r.last_active, now) : null],
  ];
  return (
    <aside aria-label={`Chi tiết ${bot.name}`} className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b px-4 py-4">
        <div className="flex items-center gap-3">
          <BotAvatar id={bot.key} status={bot.status} size={48} />
          <div className="min-w-0">
            <p className="truncate font-semibold tracking-tight">{bot.name}</p>
            <StatusPill status={bot.status} className="mt-1" />
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
        </dl>
        {r.project?.root && (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={r.project.root}>
            {r.project.root}
          </p>
        )}
        {files.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">File vừa sửa</p>
            <FileChips paths={files} bare={[]} spots={spots} />
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <RoomLog room={bot.name} onFull={onFull} fill />
      </div>
    </aside>
  );
}
