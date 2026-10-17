"use client";

import { CircleDotIcon, SquareTerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { attachCommand } from "@/lib/ask";
import { LANES } from "@/lib/lanes";
import { agoVi, spanVi, type RoomNow } from "@/lib/now";
import { modelShort } from "@/lib/roles";
import { repoOf } from "@/lib/sidebar";
import { AskPanel } from "./ask-panel";
import { StateTag } from "./now-roster";
import { RoleIcon } from "./role-badge";
import { RoomLog } from "./room-log";
import type { Room } from "./use-office";
import { openWebTerminal } from "./web-terminal-sheet";

const laneLabel = (k: string) => LANES.find((l) => l.key === k)?.label ?? k;

/**
 * The top of Chat phòng: what this room is doing now (its line and the card it holds), what it asks
 * the owner, and the way into its terminal. The message box under the timeline sends it work.
 */
export function RoomBrief({ room, n, now, token, onTerminal }: { room: Room; n: RoomNow; now: number; token: string; onTerminal: () => void }) {
  const tmux = room.delivery === "terminal";
  const where = room.project ? repoOf(room.project.root) : null;
  const sub = [where?.name, where?.worktree ? `worktree ${where.worktree}` : room.project?.branch, room.model ? modelShort(room.model) : null].filter(Boolean).join(" · ");
  const term = useOpenTerminal(room, tmux, token, onTerminal);

  return (
    <section aria-labelledby="room-brief" className="space-y-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 id="room-brief" className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
            <RoleIcon role={n.role ?? room.role} className="size-4 text-muted-foreground" />
            <span className="truncate">{room.label}</span>
            <StateTag n={n} />
          </h2>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
        {n.state !== "needs" && <OpenTerminal term={term} />}
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Đang làm</dt>
        <dd className="min-w-0">
          {n.last ? (
            <>
              <span className="text-pretty">{n.last.text}</span>
              {n.last.at != null && <span className="text-muted-foreground tabular"> · {agoVi(n.last.at, now)}</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Chưa có dòng nào từ phòng này.</span>
          )}
          {n.quietMs != null && n.flagged && <span className="block text-xs text-muted-foreground">Rảnh {spanVi(n.quietMs)}: gửi việc ở ô bên dưới.</span>}
        </dd>
        <dt className="text-muted-foreground">Card</dt>
        <dd className="min-w-0">
          {n.card ? (
            <span className="inline-flex max-w-full items-baseline gap-1.5">
              <CircleDotIcon aria-hidden className="size-3 shrink-0 self-center text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground tabular">#{n.card.id}</span>
              <span className="truncate" title={n.card.text}>
                {n.card.text}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">· {laneLabel(n.card.lane)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Không giữ card nào.</span>
          )}
        </dd>
      </dl>

      {(n.state === "needs" || room.permit) && (
        <AskPanel
          rooms={[{ key: room.key, label: room.label, session_id: room.session_id, project: where?.name ?? null, waiting: room.waiting, ask: room.ask, permit: room.permit, tmux }]}
          now={now}
          token={token}
          onOpen={onTerminal}
        />
      )}

      {room.session_id ? (
        <RoomLog sessionId={room.session_id} token={token} onFull={term.open ?? undefined} />
      ) : (
        <p className="text-xs text-muted-foreground">Nhật ký đọc từ transcript của Claude Code: phòng này chưa có session id. Mở terminal để xem nó làm gì.</p>
      )}
    </section>
  );
}

/**
 * The room's terminal: HQ's own tmux rooms open in the drawer; a background Claude Code session opens
 * `claude attach` in a new window. `open` is null when there is no way in (no session id).
 */
function useOpenTerminal(room: Room, tmux: boolean, _token: string, onTerminal: () => void) {
  const id = room.session_id;
  if (tmux) return { busy: false, open: onTerminal, title: undefined };
  if (!id) return { busy: false, open: null, title: undefined };
  // A background room opens its real terminal inside HQ (`8sync ccc term`), no separate window.
  return { busy: false, open: () => openWebTerminal(id, room.label), title: `Terminal trong HQ (hoặc: ${attachCommand(id)})` };
}

function OpenTerminal({ term }: { term: ReturnType<typeof useOpenTerminal> }) {
  if (!term.open) return null;
  return (
    <Button type="button" size="sm" variant="outline" disabled={term.busy} aria-busy={term.busy} onClick={term.open} title={term.title}>
      <SquareTerminalIcon aria-hidden /> {term.busy ? "Đang mở…" : "Mở terminal"}
    </Button>
  );
}
