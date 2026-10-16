"use client";

import { GitBranchIcon, InboxIcon, MoonIcon, PauseIcon, PlayIcon, TerminalSquareIcon, UsersIcon } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isStale, longRestCount, sortMembers, type IdleRecord } from "@/lib/idle";
import { autoButton, autoText } from "@/lib/auto";
import { attendeesNow, meetingLabel, walkPhase, type Attendee } from "@/lib/meeting";
import { cloneCount, fmtDuration, fmtTokens, fmtUsd, groupByProject, roomFor, seatState, SEATS, type Visit } from "@/lib/office";
import { shirtFor, shirtOf } from "@/lib/sprite/frames";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote, StatusDot } from "./bits";
import { IdleChip } from "./idle-chip";
import { SpriteCanvas, WalkerCanvas } from "./sprite-canvas";
import { useAuto, type Office, type OfficeState, type Room } from "./use-office";

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
/** A visit whose text is the HQ assign prompt (app/api/tasks/route.ts `plain` / scheduledPrompt): someone brings a task in. */
const bringsTask = (text: string | null | undefined) => /^(New task:|Lên lịch)/.test(text ?? "");
const STATUS_TEXT: Record<Room["status"], string> = {
  running: "Đang làm",
  idle: "Rảnh",
  needs_input: "Chờ anh",
  ended: "Đã tắt",
};

const CLONE_PX = 40;

function Seat({ seat, room, inMeeting }: { seat: Room["seats"][number]; room: Room; inMeeting: boolean }) {
  const state = seatState(seat, room, inMeeting);
  const away = seat.key === "lead" && inMeeting;
  const who = seat.label;
  const hint = away ? "đi họp sprint" : seat.active.length ? seat.active.join(", ") : seat.recent ? `${seat.recent} vừa xong` : "trống";
  const clones = cloneCount(seat);
  return (
    <li className="flex min-w-0 flex-col items-center gap-1" title={`${seat.label}: ${hint}`}>
      {clones > 1 && !away ? (
        // Several agents of one kind: one sprite each (max 3), overlapping; the ×N label counts them all.
        <span className="flex items-end -space-x-3" aria-hidden>
          {Array.from({ length: clones }, (_, i) => (
            <SpriteCanvas
              key={i}
              state="typing"
              role={seat.key}
              shirt={shirtOf(seat.key, room.key)}
              seed={`${room.key}:${seat.key}:${i}`}
              size={CLONE_PX}
              className="block"
            />
          ))}
        </span>
      ) : (
        // Empty seat: the role's character resting, screen off, dimmed; it still breathes.
        // A lead at the sprint meeting leaves an empty chair ("away") at full opacity.
        <SpriteCanvas
          state={state ?? (away ? "away" : "rest")}
          role={seat.key}
          shirt={shirtOf(seat.key, room.key)}
          seed={`${room.key}:${seat.key}`}
          size={SEAT_PX}
          className={cn("block transition-opacity duration-200", !state && !away && "opacity-60")}
        />
      )}
      <span className={cn("flex max-w-full items-center gap-1 text-[11px] leading-none", state ? "font-medium text-(--ink)" : "text-(--soft)/70")}>
        <span className="truncate">{who}</span>
        {seat.active.length > 1 && (
          // "nhân bản": how many agents of this kind run right now (the sprites show up to 3).
          <span className="shrink-0 rounded-sm bg-white/15 px-1 font-mono text-[10px] text-(--ink)">×{seat.active.length}</span>
        )}
      </span>
      <span className="sr-only">{hint}</span>
      {away && <span className="text-[10px] leading-none text-(--soft)">đi họp</span>}
      {!seat.active.length && !away && seat.recent > 0 && (
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
  const meetPhase = room.meeting ? walkPhase(room.meeting.at, now) : null;
  const inMeeting = meetPhase != null;
  const bringing = room.pending > 0 && !incoming.slice(0, 2).some((v) => bringsTask(v.text));
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
                <InboxIcon className="size-3" aria-hidden /> Inbox{room.inboxLive ? " · mod" : " · chưa nạp mod"}
                {room.pending > 0 && ` · ${room.pending} chờ giao`}
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
              <Seat key={s.key} seat={s} room={room} inMeeting={inMeeting} />
            ))}
          </ul>
          {members.length > 0 && (
            <ul aria-label="Agent team: ai đang làm gì" className="mt-2 flex flex-wrap gap-1.5">
              {members.map((m) => (
                <IdleChip key={m.name} r={m} now={now} />
              ))}
            </ul>
          )}
          {(incoming.length > 0 || outgoing.length > 0 || bringing || meetPhase === "out" || meetPhase === "back") && (
            <div className="mt-2 flex flex-col gap-1.5" role="status">
              {(meetPhase === "out" || meetPhase === "back") && room.meeting && (
                <div className="flex min-w-0 items-end gap-2">
                  <WalkerCanvas
                    shirt={shirtOf("lead", room.key)}
                    ts={room.meeting.at}
                    anim={meetPhase}
                    dir={meetPhase === "back" ? "left" : "right"}
                  />
                  <span className="min-w-0 truncate rounded-md bg-white/10 px-2 py-1 text-xs text-(--ink)">
                    {meetPhase === "out" ? "Lead đi họp sprint" : "Lead về chỗ"}
                  </span>
                </div>
              )}
              {incoming.slice(0, 2).map((v) => (
                <div key={`in-${v.ts}-${v.from}`} className="flex min-w-0 items-end gap-2">
                  <WalkerCanvas shirt={shirtFor(v.from)} ts={v.ts} carry={bringsTask(v.text)} />
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
                    Đang mang việc tới · {room.pending} chờ giao
                  </span>
                </div>
              )}
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

/** The shared sprint-meeting room of one project: every attending lead sits at the table with its "doing" line. */
function MeetingRoom({
  attendees,
  rooms,
  until,
  now,
}: {
  attendees: Attendee[];
  rooms: Room[];
  until: number;
  now: number;
}) {
  const refs = rooms.map((r) => ({ key: r.key, ids: [r.name, r.session_id ?? "", r.label].filter(Boolean) }));
  const seated = attendees.map((a) => {
    const room = rooms.find((r) => r.key === roomFor(a.room, refs));
    return { a, key: room?.key ?? a.room, label: room?.label ?? a.room, phase: walkPhase(a.at, now) };
  });
  const half = Math.ceil(seated.length / 2);
  const row = (xs: typeof seated, label: string) => (
    <ul aria-label={label} className="flex flex-wrap items-end justify-center gap-x-5 gap-y-2">
      {xs.map(({ a, key, label: name, phase }) => (
        <li key={key} className="flex w-28 min-w-0 flex-col items-center gap-1" title={`${name}: ${a.doing}`}>
          {/* Walking out: the lead arrives (walks in from the left); back: leaves to the right; else sits at the table. */}
          {phase === "table" ? (
            <SpriteCanvas state="meeting" role="lead" shirt={shirtOf("lead", key)} seed={`meet:${key}`} size={SEAT_PX} className="block" />
          ) : (
            <span className="flex h-24 items-end overflow-hidden" data-walk={phase ?? "none"}>
              <WalkerCanvas shirt={shirtOf("lead", key)} ts={a.at} anim={phase === "back" ? "out" : "in"} />
            </span>
          )}
          <span className="max-w-full truncate text-[11px] font-medium leading-none text-(--ink)">{name}</span>
          <span className="line-clamp-2 text-center text-[10px] leading-tight text-(--soft)">{a.doing || "—"}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label={`Phòng họp sprint, ${attendees.length} phòng`} className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div style={SCENE} className="bg-(--wall)">
        <header className="flex min-w-0 items-center gap-2 px-3.5 pt-3">
          <UsersIcon className="size-3.5 text-(--soft)" aria-hidden />
          <h3 className="text-sm font-semibold text-(--ink)">Phòng họp</h3>
          <span className="min-w-0 truncate text-xs text-(--soft)" role="status">
            {meetingLabel(attendees.length, until, now)}
          </span>
        </header>
        <div className="mt-2 space-y-1 border-t-2 border-(--seam) bg-(--floor) px-3 py-3">
          {row(seated.slice(0, half), "Bên trên bàn")}
          <div aria-hidden className="mx-auto h-7 w-4/5 max-w-lg rounded-full border-2 border-(--seam) bg-[oklch(0.4_0.05_55)] shadow-inner" />
          {seated.length > half && row(seated.slice(half), "Bên dưới bàn")}
        </div>
      </div>
    </section>
  );
}

/** Pause / Run: HQ keeps `8sync ccc auto` on by default (useAuto); the owner can pause it. */
function AutoBar({ token }: { token: string }) {
  const { status, busy, setAuto } = useAuto(token);
  if (!status) return null;
  const btn = autoButton(status);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" role="status">
      {btn && (
        <Button type="button" size="sm" variant={btn.action === "pause" ? "outline" : "default"} disabled={busy} onClick={() => void setAuto(btn.action)}>
          {btn.action === "pause" ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
          {btn.label}
        </Button>
      )}
      <span className="text-muted-foreground">{autoText(status)}</span>
    </div>
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
  token,
}: {
  data: OfficeState;
  /** The room whose chat is open (any of its names). */
  selected: string | null;
  onOpen: (room: Room) => void;
  onStart: () => void;
  /** HQ token: the Pause / Run control talks to /api/auto. */
  token: string;
}) {
  const rooms = useMemo(() => office?.rooms ?? [], [office]);
  const groups = useMemo(() => groupByProject(rooms), [rooms]);
  const labelOf = (key: string) => rooms.find((r) => r.key === key)?.label ?? key.slice(0, 8);
  const visits = office?.visits ?? [];
  const now = office?.at ?? 0;
  const idle = useMemo(() => office?.idle ?? [], [office]);
  const teams = useMemo(() => new Set(rooms.map((r) => r.team).filter(Boolean)), [rooms]);
  const meetings = useMemo(() => (office?.meetings ?? []) as Office["meetings"], [office]);
  const live = idle.filter((r) => !isStale(r, now));
  const membersOf = (team: string | null) => (team ? sortMembers(live.filter((r) => r.team === team)) : []);
  // A team whose lead session is gone still shows its members; only stale records collapse.
  const orphans = sortMembers(live.filter((r) => !teams.has(r.team)));
  const old = idle.filter((r) => isStale(r, now));
  const resting = longRestCount(idle, now);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-5 sm:px-6">
        <AutoBar token={token} />
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
              const m = meetings.find((x) => x.root === g.project.root);
              const here = m ? attendeesNow(m.attendees, now) : [];
              const meeting = m && here.length ? { attendees: here, until: m.until } : null;
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
                  {meeting && <MeetingRoom attendees={meeting.attendees} rooms={g.rooms} until={meeting.until} now={now} />}
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
