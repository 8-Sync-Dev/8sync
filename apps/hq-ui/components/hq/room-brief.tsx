"use client";

import { CircleDotIcon, SquareTerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { attachCommand } from "@/lib/ask";
import { LANES } from "@/lib/lanes";
import { agoVi, spanVi, type RoomNow } from "@/lib/now";
import { roomModelLabel } from "@/lib/roles";
import { repoOf } from "@/lib/sidebar";
import { AskPanel } from "./ask-panel";
import { StateTag } from "./now-roster";
import { RoleIcon } from "./role-badge";
import { RoomLog } from "./room-log";
import type { Room } from "./use-office";
import { openWebTerminal } from "./web-terminal-sheet";

const laneLabel = (k: string) => LANES.find((l) => l.key === k)?.label ?? k;

/**
 * The room's title row: name, state, project · branch · model, and the terminal button. Pinned at the
 * top of the room view (TeamView `bar`): the owner switches model or effort and opens the terminal
 * from here, and lost it once the log and chat scrolled (owner 2026-10-20).
 */
export function RoomBar({ room, n, token, onTerminal }: { room: Room; n: RoomNow; token: string; onTerminal: () => void }) {
  const tmux = room.delivery === "terminal";
  const where = room.project ? repoOf(room.project.root) : null;
  const sub = [where?.name, where?.worktree ? `worktree ${where.worktree}` : room.project?.branch, roomModelLabel(room)].filter(Boolean).join(" · ");
  const term = useOpenTerminal(room, tmux, token, onTerminal);
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 id="room-brief" className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
          <RoleIcon role={n.role ?? room.role} className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{room.label}</span>
          <StateTag n={n} />
        </h2>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      {n.state !== "needs" && <OpenTerminal term={term} />}
    </div>
  );
}

/**
 * The top of Chat phòng: what this room is doing now (its line and the card it holds), what it asks
 * the owner, and the way into its terminal. The message box under the timeline sends it work.
 */
export function RoomBrief({ room, n, now, token, onTerminal }: { room: Room; n: RoomNow; now: number; token: string; onTerminal: () => void }) {
  const tmux = room.delivery === "terminal";
  const where = room.project ? repoOf(room.project.root) : null;
  const term = useOpenTerminal(room, tmux, token, onTerminal);

  return (
    <section aria-labelledby="room-brief" className="space-y-4">
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
 * The room's terminal: HQ's own tmux rooms open in the drawer; a background Claude Code session
 * (`claude attach`) or an omp room (its omp, kept running by a host) opens inside HQ. `open` is null
 * when there is no way in (no session id).
 */
function useOpenTerminal(room: Room, tmux: boolean, _token: string, onTerminal: () => void) {
  const id = room.session_id;
  if (tmux) return { busy: false, open: onTerminal, title: undefined };
  if (!id) return { busy: false, open: null, title: undefined };
  // A background room opens its real terminal inside HQ (`8sync ccc term`), no separate window.
  const other = room.engine === "omp" ? `8sync . ${room.label} trong repo` : attachCommand(id);
  return { busy: false, open: () => openWebTerminal(id, room.label), title: `Terminal trong HQ (hoặc: ${other})` };
}

function OpenTerminal({ term }: { term: ReturnType<typeof useOpenTerminal> }) {
  if (!term.open) return null;
  return (
    <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={term.busy} aria-busy={term.busy} onClick={term.open} title={term.title}>
      <SquareTerminalIcon aria-hidden /> {term.busy ? "Đang mở…" : "Mở terminal"}
    </Button>
  );
}
