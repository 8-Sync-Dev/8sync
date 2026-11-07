"use client";

import { useMemo } from "react";
import { recentFiles, type Bot } from "@/lib/bots";
import { agoVi } from "@/lib/now";
import { roomModelLabel } from "@/lib/roles";
import type { Brief } from "@/lib/server/brief";
import type { Room } from "@/lib/server/office";
import { FileChips, useFileSpots } from "../path-open";
import { RoomLog } from "../room-log";
import { useRoomLog } from "../room-outputs";
import type { Hq } from "../use-hq";
import { BotAvatar, StatusPill } from "./bot-avatar";
import { BotKnows } from "./bot-knows";

/**
 * The bot's detail pane: who it is and where it works, the files it wrote lately (its brief from GET /api/brief: waiting, doing, last ask and reply), what it
 * knows of the others ("Bot này đang biết gì": shared facts, its last digest), then its Nhật ký (results per turn, every step). Inside the thread's
 * RoomLogProvider and PathOpenProvider.
 */
export function BotBrief({ hq, bot, brief = null, now, onFull }: { hq: Hq; bot: Bot<Room>; brief?: Brief | null; now: number; onFull?: () => void }) {
  const r = bot.room;
  const ctx = useRoomLog();
  const logFiles = useMemo(() => recentFiles(ctx?.log?.events ?? []), [ctx?.log?.events]);
  const files = logFiles.length ? logFiles : (brief?.files ?? []);
  const spots = useFileSpots(files, ctx?.log?.rev ?? "");
  const model = roomModelLabel(r);
  const rows: [string, string | null][] = [
    ["Chờ anh", brief?.waiting ?? null],
    ["Đang làm", brief?.doing ?? (bot.status === "working" || bot.status === "needs" ? r.doing : null)],
    ["Hỏi gần nhất", brief?.lastAsk ?? null],
    ["Trả lời gần nhất", brief?.lastReply ?? null],
    ["Dự án", brief?.project?.name ?? bot.project],
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
      <BotKnows hq={hq} bot={bot} />
      <div className="min-h-0 flex-1">
        <RoomLog room={bot.name} onFull={onFull} fill />
      </div>
    </aside>
  );
}
