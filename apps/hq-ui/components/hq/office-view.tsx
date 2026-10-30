"use client";

import { GitBranchIcon, InboxIcon, TerminalSquareIcon, UsersIcon } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { askLine } from "@/lib/ask";
import { NOW_LABEL, agoVi, deskClip, roster, rosterSummary, stateChanges, type RoomNow } from "@/lib/now";
import { cloneCount, fmtDuration, fmtTokens, fmtUsd, SEATS, type Visit } from "@/lib/office";
import { rootKey } from "@/lib/preview";
import { groupByRepo, worktreeOf } from "@/lib/sidebar";
import { roomModelLabel } from "@/lib/roles";
import { shirtFor, shirtOf } from "@/lib/sprite/frames";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { NowRoster, type RosterRow } from "./now-roster";
import { RoleIcon } from "./role-badge";
import { SpriteCanvas, WalkerCanvas } from "./sprite-canvas";
import { AskPanel, askRoomOf, type AskRoom } from "./ask-panel";
import type { OfficeState, Room } from "./use-office";

/*
 * A room is a fixed dark scene in both themes (a game viewport), so its text uses its own
 * light inks. ink 0.97 / soft 0.82 pass AA on wall L 0.24 and floor L 0.30.
 */
const SCENE = {
  "--wall": "oklch(0.24 0.014 260)",
  "--floor": "oklch(0.3 0.018 60)",
  "--seam": "oklch(0.18 0.012 260)",
  "--ink": "oklch(0.97 0 0)",
  "--soft": "oklch(0.82 0.01 260)",
} as CSSProperties;

/** State inks on the dark scene (AA on wall L 0.24). */
const SCENE_INK: Record<RoomNow["state"], string> = {
  needs: "text-[oklch(0.84_0.14_75)]",
  working: "text-[oklch(0.8_0.14_155)]",
  idle: "text-(--soft)",
};

const DESK_PX = 72;
const SEAT_PX = 56;
const CLONE_PX = 40;

/** A specialist subagent of this session at its desk; only seats with someone in them are drawn. */
function Seat({ seat, room }: { seat: Room["seats"][number]; room: Room }) {
  const clones = cloneCount(seat);
  const busy = seat.active.length > 0;
  const hint = busy ? seat.active.join(", ") : `${seat.recent} vừa xong`;
  return (
    <li className="flex min-w-0 flex-col items-center gap-1" title={`${seat.label}: ${hint}`}>
      {clones > 1 ? (
        // Several agents of one kind: one sprite each (max 3), overlapping; the ×N label counts them all.
        <span className="flex items-end -space-x-3" aria-hidden>
          {Array.from({ length: clones }, (_, i) => (
            <SpriteCanvas key={i} state="typing" role={seat.key} shirt={shirtOf(seat.key, room.key)} seed={`${room.key}:${seat.key}:${i}`} size={CLONE_PX} />
          ))}
        </span>
      ) : (
        // Just finished: the desk is empty, the screen off ("rest" would be a sleeping person who is not there).
        <SpriteCanvas
          state={busy ? "typing" : "away"}
          role={seat.key}
          shirt={shirtOf(seat.key, room.key)}
          seed={`${room.key}:${seat.key}`}
          size={SEAT_PX}
          className={cn("block transition-opacity duration-200", !busy && "opacity-70")}
        />
      )}
      <span className={cn("flex max-w-full items-center gap-1 text-[11px] leading-none", busy ? "font-medium text-(--ink)" : "text-(--soft)")}>
        <span className="truncate">{seat.label}</span>
        {seat.active.length > 1 && <span className="shrink-0 rounded-sm bg-white/15 px-1 font-mono text-[10px] text-(--ink)">×{seat.active.length}</span>}
      </span>
      <span className="text-[10px] leading-none text-(--soft)">{busy ? "đang làm" : `vừa xong ${seat.recent}`}</span>
    </li>
  );
}

function Stat({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5" title={title}>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium tabular">{v}</dd>
    </div>
  );
}

function RoomCard({
  room,
  n,
  labelOf,
  incoming,
  outgoing,
  selected,
  onOpen,
  now,
}: {
  room: Room;
  /** What the room is doing (lib/now.ts): drives the label, the card line and the desk sprite. */
  n: RoomNow;
  labelOf: (key: string) => string;
  incoming: Visit[];
  outgoing: Visit[];
  selected: boolean;
  now: number;
  onOpen: (room: Room) => void;
}) {
  const u = room.usage;
  const id = `room-${room.key.replace(/[^\w-]/g, "_")}`;
  const bringing = room.pending > 0;
  const seated = room.seats.filter((s) => s.key !== "lead" && (s.active.length > 0 || s.recent > 0));
  const working = seated.reduce((a, s) => a + s.active.length, 0);
  const clip = deskClip(n, room.state);
  const model = roomModelLabel(room);
  // Only numbers that were measured; "chưa đo" four times per room is noise, not information.
  const stats = [
    room.tokens != null && <Stat key="ctx" k="Context" v={fmtTokens(room.tokens)} title="Token đang nằm trong context của session (8sync ls)" />,
    u?.cost_usd != null && <Stat key="usd" k="Chi phí" v={fmtUsd(u.cost_usd)} title="cost.total_cost_usd Claude Code đưa cho status line" />,
    u?.duration_ms != null && <Stat key="dur" k="Thời gian" v={fmtDuration(u.duration_ms)} />,
    u?.lines_added != null && <Stat key="lines" k="Dòng" v={`+${u.lines_added} −${u.lines_removed ?? 0}`} />,
  ].filter(Boolean);
  return (
    <article
      aria-labelledby={id}
      data-state={n.state}
      className={cn(
        "group/room relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors duration-200",
        n.state === "needs" && "border-st-needs",
        selected && "ring-2 ring-ring",
      )}
    >
      <div style={SCENE} className="bg-(--wall)">
        <header className="flex min-w-0 items-center gap-2 px-3.5 pt-3">
          <RoleIcon role={n.role} className="size-3.5 text-(--soft)" />
          <h3 id={id} className="min-w-0 truncate text-sm font-semibold text-(--ink)">
            <button
              type="button"
              onClick={() => onOpen(room)}
              className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-has-[:focus-visible]/room:underline"
            >
              {room.label}
            </button>
          </h3>
          {model && <span className="shrink-0 text-[11px] text-(--soft)">{model}</span>}
          {room.engine === "omp" && <span className="shrink-0 rounded border border-(--soft)/40 px-1 text-[10px] leading-4 text-(--soft)">omp</span>}
          {worktreeOf(room) && (
            <span className="inline-flex min-w-0 items-center gap-0.5 font-mono text-[11px] text-(--soft)" title={`worktree ${worktreeOf(room)}${room.project?.branch ? ` · nhánh ${room.project.branch}` : ""}`}>
              <GitBranchIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{room.project?.branch ?? worktreeOf(room)}</span>
            </span>
          )}
          <span className={cn("ml-auto shrink-0 text-xs font-medium", SCENE_INK[n.state])}>
            {n.state === "needs" ? "Chờ anh trả lời" : NOW_LABEL[n.state]}
          </span>
        </header>
        <div className="relative mt-2 border-t-2 border-(--seam) bg-(--floor) px-3 pt-2.5 pb-2.5">
          <div className="flex min-w-0 items-end gap-4">
            <ul aria-label={`Bàn làm việc, ${working} agent chuyên gia đang chạy`} className="flex flex-wrap items-end gap-x-4 gap-y-3">
              {/* The session itself: its pose is its state (lib/now.ts deskClip), never a loop for show. */}
              <li className="flex min-w-0 flex-col items-center gap-1" title={`${room.label}: ${NOW_LABEL[n.state]}`}>
                <SpriteCanvas state={clip} role={n.seat} shirt={shirtOf(n.seat, room.key)} seed={`${room.key}:desk`} size={DESK_PX} />
                <span className="max-w-24 truncate text-[11px] leading-none font-medium text-(--ink)">{room.label}</span>
              </li>
              {seated.map((s) => (
                <Seat key={s.key} seat={s} room={room} />
              ))}
            </ul>
            {/* What the screen shows: the live line from `8sync ls`, with how fresh it is. */}
            {n.state === "needs" ? (
              <p className="mb-5 line-clamp-3 min-w-0 flex-1 text-xs leading-snug text-(--ink)" title={askLine(room.ask) ?? undefined}>
                {askLine(room.ask) ?? "Đang chờ anh trả lời trong terminal"}
                <span className="text-(--soft)"> · xem khung “Anh cần trả lời” ở đầu trang</span>
              </p>
            ) : (
              room.doing && (
                <p className="mb-5 line-clamp-3 min-w-0 flex-1 text-xs leading-snug text-(--soft)" title={room.doing}>
                  {room.doing}
                  {room.last_active != null && <span className="tabular"> · {agoVi(room.last_active, now)}</span>}
                </p>
              )
            )}
          </div>
          {(incoming.length > 0 || outgoing.length > 0 || bringing) && (
            <div className="mt-2 flex flex-col gap-1.5" role="status">
              {incoming.slice(0, 2).map((v) => (
                <div key={`in-${v.ts}-${v.from}`} className="flex min-w-0 items-end gap-2">
                  <WalkerCanvas shirt={shirtFor(v.from)} ts={v.ts} />
                  <span className="min-w-0 truncate rounded-md bg-white/10 px-2 py-1 text-xs text-(--ink)">
                    <span className="font-medium">Từ {labelOf(v.from)}</span>
                    {v.text && <span className="text-(--soft)">: {v.text}</span>}
                  </span>
                </div>
              ))}
              {/* Queued inbox work: one carrier at the door, unless a visit already shows one. */}
              {bringing && (
                <div className="flex min-w-0 items-end gap-2">
                  <WalkerCanvas shirt={shirtFor("owner")} ts={room.pending} carry />
                  <span className="min-w-0 truncate rounded-md bg-white/10 px-2 py-1 text-xs text-(--soft)">
                    Đang mang tin tới · {room.pending} chờ giao
                  </span>
                </div>
              )}
              {outgoing.slice(0, 1).map((v) => (
                <p key={`out-${v.ts}-${v.to}`} className="truncate text-xs text-(--soft)">
                  {room.label} đang sang phòng {labelOf(v.to)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2 text-xs">
        {stats}
        <div className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          {room.delivery === "terminal" ? (
            <>
              <TerminalSquareIcon className="size-3" aria-hidden /> Terminal
            </>
          ) : room.delivery === "inbox" ? (
            <span
              title={
                room.engine === "omp"
                  ? "Phòng omp đọc inbox khi rảnh"
                  : room.inboxLive
                    ? "Mod 8sync-inbox đang nạp: việc vào ngay khi phòng rảnh"
                    : "Mod 8sync-inbox chưa nạp: việc vào ở lượt kế"
              }
            >
              <InboxIcon className="mr-1 inline size-3 align-[-2px]" aria-hidden />
              Inbox{room.inboxLive || room.engine === "omp" ? "" : " · chưa nạp mod"}
              {room.pending > 0 && ` · ${room.pending} chờ giao`}
            </span>
          ) : null}
        </div>
      </dl>
    </article>
  );
}

function OfficeSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Đang tải văn phòng">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-40 rounded-xl" />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))]">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  );
}

export function OfficeView({
  data: { office, error, retry },
  selected,
  onOpen,
  onStart,
  token,
  repo = null,
  onAll,
}: {
  data: OfficeState;
  /** The room whose chat is open (any of its names). */
  selected: string | null;
  onOpen: (room: Room) => void;
  onStart: () => void;
  token: string;
  /** The repo picked in the sidebar: only its rooms show (owner 2026-10-21: "mở dự án nào nó phải đúng cái đó"). */
  repo?: string | null;
  onAll?: () => void;
}) {
  const allRooms = useMemo(() => office?.rooms ?? [], [office]);
  // Worktree rooms sit under their repo (lib/sidebar.ts groupByRepo), like the sidebar.
  const allGroups = useMemo(() => groupByRepo(allRooms), [allRooms]);
  const groups = useMemo(() => (repo ? allGroups.filter((g) => rootKey(g.project.root) === rootKey(repo)) : allGroups), [allGroups, repo]);
  const rooms = useMemo(() => (repo ? groups.flatMap((g) => g.rooms) : allRooms), [repo, groups, allRooms]);
  const labelOf = (key: string) => rooms.find((r) => r.key === key)?.label ?? key.slice(0, 8);
  const visits = office?.visits ?? [];
  const now = office?.at ?? 0;

  const rows: RosterRow[] = useMemo(
    () => roster(rooms, now).map((r) => ({ ...r, modelLabel: roomModelLabel(r.room), waiting: askLine(r.room.ask) ?? r.room.waiting })),
    [rooms, now],
  );
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  // Rooms stopped on the owner, in roster order (the longest wait is not reordered away).
  const asking: AskRoom[] = useMemo(
    () =>
      rows.flatMap((n) => {
        const r = rooms.find((x) => x.key === n.key);
        if (!r || n.state !== "needs") return [];
        return [askRoomOf(r)];
      }),
    [rows, rooms],
  );
  // Rooms whose state changed since the previous poll (React's "previous value in state" pattern).
  const sig = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, r.state])), [rows]);
  const [seen, setSeen] = useState<{ sig: Record<string, string> | null; changed: Set<string> }>({ sig: null, changed: new Set() });
  if (seen.sig !== sig && JSON.stringify(seen.sig) !== JSON.stringify(sig)) setSeen({ sig, changed: stateChanges(seen.sig, sig) });
  const changed = seen.changed;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl min-[1600px]:max-w-none space-y-7 px-4 py-5 sm:px-6">
        {rows.length > 0 && <p className="text-sm text-muted-foreground">{rosterSummary(rows)}</p>}
        {error && !office ? (
          <ErrorNote what="văn phòng" error={error} onRetry={retry} />
        ) : !office ? (
          <OfficeSkeleton />
        ) : rooms.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title={repo ? "Dự án này chưa có phòng nào đang chạy" : "Chưa có phòng nào đang chạy"}
            action={
              <Button variant="outline" onClick={onStart}>
                Mở một session
              </Button>
            }
          >
            Mỗi session Claude Code hay omp anh mở là một phòng ở đây.
          </EmptyState>
        ) : (
          <>
            {error && (
              <p role="status" className="text-xs text-muted-foreground">
                Mất kết nối ({error}), đang thử lại. Dữ liệu dưới đây có thể đã cũ.
              </p>
            )}
            {repo && allGroups.length > 1 && (
              <p className="text-sm text-muted-foreground">
                Đang xem một dự án.{" "}
                <button type="button" className="font-medium text-foreground underline underline-offset-4 hover:no-underline" onClick={onAll}>
                  Xem cả {allGroups.length} dự án
                </button>
              </p>
            )}
            <div className="space-y-7 min-[1600px]:grid min-[1600px]:grid-cols-[minmax(36rem,1fr)_minmax(0,1.35fr)] min-[1600px]:items-start min-[1600px]:gap-8 min-[1600px]:space-y-0">
              <div className="space-y-7">
                <AskPanel
                  rooms={asking}
                  now={now}
                  token={token}
                  onOpen={(key) => {
                    const r = rooms.find((x) => x.key === key);
                    if (r) onOpen(r);
                  }}
                />
                <NowRoster
                  rows={rows}
                  now={now}
                  changed={changed}
                  onOpen={(key) => {
                    const r = rooms.find((x) => x.key === key);
                    if (r) onOpen(r);
                  }}
                />
              </div>
              <div className="space-y-7">
                {groups.map((g) => {
                  // The repo's branch here; a worktree room shows its own branch on its card.
                  const branches = [...new Set(g.rooms.filter((r) => !worktreeOf(r)).map((r) => r.project?.branch).filter(Boolean))] as string[];
                  const gid = `proj-${g.project.root.replace(/[^\w-]/g, "_")}`;
                  // Same attention order as the roster, so the room that needs the owner is the first scene too.
                  const ordered = [...g.rooms].sort((a, b) => rows.findIndex((r) => r.key === a.key) - rows.findIndex((r) => r.key === b.key));
                  return (
                    <section key={g.project.root} aria-labelledby={gid} className="space-y-3">
                      <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h2 id={gid} className="text-base font-semibold tracking-tight" title={g.project.root}>
                          {g.project.name}
                        </h2>
                        {branches.map((b) => (
                          <span key={b} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                            <GitBranchIcon className="size-3" aria-hidden />
                            {b}
                          </span>
                        ))}
                        <span className="text-xs text-muted-foreground tabular">{g.rooms.length} phòng</span>
                      </header>
                      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))]">
                        {ordered.map((r) => {
                          const n = byKey.get(r.key);
                          if (!n) return null;
                          return (
                            <RoomCard
                              key={r.key}
                              room={r}
                              n={n}
                              labelOf={labelOf}
                              incoming={visits.filter((v) => v.to === r.key)}
                              outgoing={visits.filter((v) => v.from === r.key)}
                              selected={selected != null && [r.name, r.session_id, r.label].includes(selected)}
                              onOpen={onOpen}
                              now={now}
                            />
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
                <details className="text-xs text-muted-foreground">
                  <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60">Cách đọc văn phòng</summary>
                  <p className="mt-2 max-w-[75ch] text-pretty">
                    Mỗi session là một phòng. Người ở bàn chính là chính session: gõ phím khi đang làm, giơ tay khi chờ anh, ngồi yên khi rảnh. Bàn phụ chỉ hiện khi agent
                    chuyên gia ({SEATS.slice(1)
                      .map((s) => s.label)
                      .join(", ")}) đang chạy hoặc vừa xong. Khi session nhắn sang session khác, người đó đi sang phòng kia.
                  </p>
                </details>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
