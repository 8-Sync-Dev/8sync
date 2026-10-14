"use client";

import { GitBranchIcon, InboxIcon, MoonIcon, TerminalSquareIcon, UsersIcon } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isStale, longRestCount, sortMembers, type IdleRecord } from "@/lib/idle";
import { fmtDuration, fmtTokens, fmtUsd, groupByProject, seatState, SEATS, type Visit } from "@/lib/office";
import { shirtFor, shirtOf } from "@/lib/sprite/frames";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote, StatusDot } from "./bits";
import { IdleChip } from "./idle-chip";
import { SpriteCanvas, WalkerCanvas } from "./sprite-canvas";
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

const SEAT_PX = 64;
const STATUS_TEXT: Record<Room["status"], string> = {
  running: "Đang làm",
  idle: "Rảnh",
  needs_input: "Chờ anh",
  ended: "Đã tắt",
};

function Seat({ seat, room }: { seat: Room["seats"][number]; room: Room }) {
  const state = seatState(seat, room);
  const who = seat.active.length > 1 ? `${seat.label} ×${seat.active.length}` : seat.label;
  const hint = seat.active.length ? seat.active.join(", ") : seat.recent ? `${seat.recent} vừa xong` : "trống";
  return (
    <li className="flex min-w-0 flex-col items-center gap-1" title={`${seat.label}: ${hint}`}>
      {/* Empty seat: the role's character resting, screen off, dimmed; it still breathes. */}
      <SpriteCanvas
        state={state ?? "rest"}
        role={seat.key}
        shirt={shirtOf(seat.key, room.key)}
        seed={`${room.key}:${seat.key}`}
        size={SEAT_PX}
        className={cn("block transition-opacity duration-200", !state && "opacity-60")}
      />
      <span className={cn("max-w-full truncate text-[11px] leading-none", state ? "font-medium text-(--ink)" : "text-(--soft)/70")}>
        {who}
      </span>
      <span className="sr-only">{hint}</span>
      {!seat.active.length && seat.recent > 0 && (
        <span className="text-[10px] leading-none text-(--soft)">vừa xong {seat.recent}</span>
      )}
    </li>
  );
}

function Stat({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5" title={title}>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("font-medium tabular", v === "chưa đo" && "font-normal text-muted-foreground")}>{v}</dd>
    </div>
  );
}

function RoomCard({
  room,
  labelOf,
  incoming,
  outgoing,
  selected,
  onOpen,
  members,
  now,
}: {
  room: Room;
  labelOf: (key: string) => string;
  incoming: Visit[];
  outgoing: Visit[];
  selected: boolean;
  /** Live agent-team members of this session (lead first), from `8sync ccc hook idle`. */
  members: IdleRecord[];
  now: number;
  onOpen: (room: Room) => void;
}) {
  const u = room.usage;
  const needs = room.status === "needs_input" || !!room.waiting;
  const working = room.seats.reduce((a, s) => a + s.active.length, 0);
  const id = `room-${room.key.replace(/[^\w-]/g, "_")}`;
  return (
    <article
      aria-labelledby={id}
      className={cn(
        "group/room relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors",
        needs && "border-st-needs",
        selected && "ring-2 ring-ring",
      )}
    >
      <div style={SCENE} className="bg-(--wall)">
        <header className="flex min-w-0 items-center gap-2 px-3.5 pt-3">
          <StatusDot status={room.status} />
          <h3 id={id} className="min-w-0 truncate text-sm font-semibold text-(--ink)">
            <button
              type="button"
              onClick={() => onOpen(room)}
              className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-has-[:focus-visible]/room:underline"
            >
              {room.label}
            </button>
          </h3>
          <span className={cn("shrink-0 text-xs", needs ? "font-semibold text-st-needs" : "text-(--soft)")}>
            {needs ? (room.waiting ?? "Chờ anh") : STATUS_TEXT[room.status]}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-(--soft)">
            {room.delivery === "terminal" ? (
              <>
                <TerminalSquareIcon className="size-3" aria-hidden /> Terminal
              </>
            ) : room.delivery === "inbox" ? (
              <>
                <InboxIcon className="size-3" aria-hidden /> Inbox{room.pending > 0 && ` · ${room.pending} chờ giao`}
              </>
            ) : null}
          </span>
        </header>
        <p className="truncate px-3.5 pt-1 text-xs text-(--soft)" title={room.doing ?? undefined}>
          {room.project?.branch && (
            <span className="mr-2 inline-flex items-center gap-1 font-mono">
              <GitBranchIcon className="size-3" aria-hidden />
              {room.project.branch}
            </span>
          )}
          {room.doing ?? "Chưa có việc ghi nhận"}
        </p>
        <div className="@container relative mt-2 border-t-2 border-(--seam) bg-(--floor) px-2 pt-2 pb-2.5">
          <ul aria-label={`Chuyên gia trong phòng, ${working} đang làm`} className="grid grid-cols-4 gap-y-3 @[33rem]:grid-cols-8">
            {room.seats.map((s) => (
              <Seat key={s.key} seat={s} room={room} />
            ))}
          </ul>
          {members.length > 0 && (
            <ul aria-label="Agent team: ai đang làm gì" className="mt-2 flex flex-wrap gap-1.5">
              {members.map((m) => (
                <IdleChip key={m.name} r={m} now={now} />
              ))}
            </ul>
          )}
          {(incoming.length > 0 || outgoing.length > 0) && (
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
              {outgoing.slice(0, 1).map((v) => (
                <p key={`out-${v.ts}-${v.to}`} className="truncate text-xs text-(--soft)">
                  Lead đang sang phòng {labelOf(v.to)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 px-3.5 py-2.5 text-xs">
        <Stat k="Context" v={fmtTokens(room.tokens)} title="Token đang nằm trong context của session (8sync ls)" />
        <Stat k="Chi phí" v={fmtUsd(u?.cost_usd)} title="cost.total_cost_usd Claude Code đưa cho status line" />
        <Stat k="Thời gian" v={fmtDuration(u?.duration_ms)} />
        {u?.lines_added != null && <Stat k="Dòng" v={`+${u.lines_added} −${u.lines_removed ?? 0}`} />}
        <Stat k="Task" v={`${room.tasks.done} xong · ${room.tasks.open} mở`} />
        {room.cost_per_task != null && <Stat k="$/task" v={fmtUsd(room.cost_per_task)} />}
      </dl>
    </article>
  );
}

function OfficeSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Đang tải văn phòng">
      <Skeleton className="h-5 w-48" />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,30rem),1fr))]">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

export function OfficeView({
  data: { office, error, retry },
  selected,
  onOpen,
  onStart,
}: {
  data: OfficeState;
  /** The room whose chat is open (any of its names). */
  selected: string | null;
  onOpen: (room: Room) => void;
  onStart: () => void;
}) {
  const rooms = useMemo(() => office?.rooms ?? [], [office]);
  const groups = useMemo(() => groupByProject(rooms), [rooms]);
  const labelOf = (key: string) => rooms.find((r) => r.key === key)?.label ?? key.slice(0, 8);
  const visits = office?.visits ?? [];
  const now = office?.at ?? 0;
  const idle = useMemo(() => office?.idle ?? [], [office]);
  const teams = useMemo(() => new Set(rooms.map((r) => r.team).filter(Boolean)), [rooms]);
  const live = idle.filter((r) => !isStale(r, now));
  const membersOf = (team: string | null) => (team ? sortMembers(live.filter((r) => r.team === team)) : []);
  // A team whose lead session is gone still shows its members; only stale records collapse.
  const orphans = sortMembers(live.filter((r) => !teams.has(r.team)));
  const old = idle.filter((r) => isStale(r, now));
  const resting = longRestCount(idle, now);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-5 sm:px-6">
        {error && !office ? (
          <ErrorNote what="văn phòng" error={error} onRetry={retry} />
        ) : !office ? (
          <OfficeSkeleton />
        ) : rooms.length === 0 ? (
          <EmptyState
            icon={<UsersIcon />}
            title="Văn phòng đang trống"
            action={<Button onClick={onStart}>Bắt đầu một session</Button>}
          >
            Chưa có session Claude Code nào đang chạy. Mỗi session sẽ thành một phòng, các agent chuyên gia của nó ngồi trong phòng.
          </EmptyState>
        ) : (
          <>
            {error && (
              <p role="status" className="text-xs text-muted-foreground">
                Mất kết nối ({error}), đang thử lại. Dữ liệu dưới đây có thể đã cũ.
              </p>
            )}
            {resting > 0 && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MoonIcon className="size-3.5" aria-hidden />
                <span>
                  <span className="font-medium text-foreground tabular">{resting}</span> thành viên team nghỉ hơn 10 phút
                </span>
              </p>
            )}
            {groups.map((g) => {
              const branches = [...new Set(g.rooms.map((r) => r.project?.branch).filter(Boolean))] as string[];
              const gid = `proj-${g.project.root.replace(/[^\w-]/g, "_")}`;
              return (
                <section key={g.project.root} aria-labelledby={gid} className="space-y-3">
                  <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={gid} className="text-base font-semibold tracking-tight">
                      {g.project.name}
                    </h2>
                    {branches.map((b) => (
                      <span key={b} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <GitBranchIcon className="size-3" aria-hidden />
                        {b}
                      </span>
                    ))}
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={g.project.root}>
                      {g.project.root}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">
                      {g.rooms.length} phòng
                    </span>
                  </header>
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,30rem),1fr))]">
                    {g.rooms.map((r) => (
                      <RoomCard
                        key={r.key}
                        room={r}
                        labelOf={labelOf}
                        incoming={visits.filter((v) => v.to === r.key)}
                        outgoing={visits.filter((v) => v.from === r.key)}
                        selected={selected != null && [r.name, r.session_id, r.label].includes(selected)}
                        onOpen={onOpen}
                        members={membersOf(r.team)}
                        now={now}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Mỗi session là một phòng; ghế giống nhau ở mọi phòng ({SEATS.map((s) => s.label).join(", ")}). Ghế sáng khi agent chuyên gia
              của session đó đang chạy. Khi session nhắn sang session khác, lead đi sang phòng đó. Dòng dưới ghế là agent team của session: ai đang làm, đang hỏi, hay đang nghỉ.
            </p>
          </>
        )}
        {/* Shown even with no live room: resting members never disappear. */}
        {orphans.length > 0 && (
          <section aria-labelledby="idle-orphans" className="space-y-2">
            <h2 id="idle-orphans" className="text-sm font-semibold">Thành viên team không còn phòng</h2>
            <ul className="flex flex-wrap gap-1.5">
              {orphans.map((m) => (
                <IdleChip key={`${m.team}/${m.name}`} r={m} now={now} variant="plain" />
              ))}
            </ul>
          </section>
        )}
        {old.length > 0 && (
          <details className="group/old text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              {old.length} trạng thái team cũ (hơn 6 giờ)
            </summary>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {old.map((m) => (
                <IdleChip key={`${m.team}/${m.name}`} r={m} now={now} variant="plain" />
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
