"use client";

import { BotIcon, Building2Icon, GitBranchIcon, GlobeIcon, InboxIcon, LaptopIcon, MoonIcon, PauseIcon, PlayIcon, RefreshCwIcon, SparklesIcon, TerminalSquareIcon, UsersIcon } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isStale, longRestCount, sortMembers, type IdleRecord } from "@/lib/idle";
import { autoButton, autoText, leaseText, staleText } from "@/lib/auto";
import { LANES } from "@/lib/lanes";
import { attendeesNow, meetingLabel, walkPhase, type Attendee } from "@/lib/meeting";
import { askLine } from "@/lib/ask";
import { NOW_LABEL, agoVi, claimMatches, deskClip, roster, rosterSummary, stateChanges, type RoomNow } from "@/lib/now";
import { cloneCount, fmtDuration, fmtTokens, fmtUsd, roomFor, SEATS, type Visit } from "@/lib/office";
import { rootKey } from "@/lib/preview";
import { companyRooms, groupByRepo, inScope, meetingShown, worktreeOf } from "@/lib/sidebar";
import { modelShort } from "@/lib/roles";
import { shirtFor, shirtOf } from "@/lib/sprite/frames";
import { cn } from "@/lib/utils";
import { isLocalHost } from "@/lib/hosts";
import { teamLabel } from "@/lib/labels";
import { EmptyState, ErrorNote } from "./bits";
import { IdleChip } from "./idle-chip";
import { NowRoster, type RosterRow } from "./now-roster";
import { RoleIcon } from "./role-badge";
import { SpriteCanvas, WalkerCanvas } from "./sprite-canvas";
import type { BoardsState } from "./use-board";
import { AskPanel, askRoomOf, type AskRoom } from "./ask-panel";
import { boostOn, TeamControls, TeamStarter } from "./team-controls";
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

/** State inks on the dark scene (AA on wall L 0.24). */
const SCENE_INK: Record<RoomNow["state"], string> = {
  needs: "text-[oklch(0.84_0.14_75)]",
  blocked: "text-[oklch(0.78_0.15_25)]",
  working: "text-[oklch(0.8_0.14_155)]",
  holding: "text-(--soft)",
  waiting: "text-(--soft)",
  idle: "text-(--soft)",
};

const DESK_PX = 72;
const SEAT_PX = 56;
const CLONE_PX = 40;
/** A visit whose text is the HQ assign prompt (app/api/tasks/route.ts `plain` / scheduledPrompt): someone brings a task in. */
const bringsTask = (text: string | null | undefined) => /^(New task:|Lên lịch)/.test(text ?? "");

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

const laneLabel = (k: string) => LANES.find((l) => l.key === k)?.label ?? k;

function RoomCard({
  room,
  n,
  labelOf,
  incoming,
  outgoing,
  selected,
  onOpen,
  members,
  now,
  cheer,
  canMeet,
}: {
  room: Room;
  /** What the room is doing (lib/now.ts): drives the label, the card line and the desk sprite. */
  n: RoomNow;
  labelOf: (key: string) => string;
  incoming: Visit[];
  outgoing: Visit[];
  selected: boolean;
  /** Live agent-team members of this session (lead first), from `8sync ccc hook idle`. */
  members: IdleRecord[];
  now: number;
  /** The room just moved its card on (latest board poll). */
  cheer: boolean;
  /** Two or more rooms in this repo: only then does a room walk to a meeting. */
  canMeet: boolean;
  onOpen: (room: Room) => void;
}) {
  const u = room.usage;
  const id = `room-${room.key.replace(/[^\w-]/g, "_")}`;
  const meetPhase = canMeet && room.meeting ? walkPhase(room.meeting.at, now) : null;
  const inMeeting = meetPhase != null;
  const bringing = room.pending > 0 && !incoming.slice(0, 2).some((v) => bringsTask(v.text));
  const seated = room.seats.filter((s) => s.key !== "lead" && (s.active.length > 0 || s.recent > 0));
  const working = seated.reduce((a, s) => a + s.active.length, 0);
  const settle = deskClip(n, room.state, { inMeeting });
  const clip = deskClip(n, room.state, { inMeeting, cheer });
  // Only numbers that were measured; "chưa đo" four times per room is noise, not information.
  const stats = [
    room.tokens != null && <Stat key="ctx" k="Context" v={fmtTokens(room.tokens)} title="Token đang nằm trong context của session (8sync ls)" />,
    u?.cost_usd != null && <Stat key="usd" k="Chi phí" v={fmtUsd(u.cost_usd)} title="cost.total_cost_usd Claude Code đưa cho status line" />,
    u?.duration_ms != null && <Stat key="dur" k="Thời gian" v={fmtDuration(u.duration_ms)} />,
    u?.lines_added != null && <Stat key="lines" k="Dòng" v={`+${u.lines_added} −${u.lines_removed ?? 0}`} />,
    room.tasks.done + room.tasks.open > 0 && <Stat key="task" k="Task" v={`${room.tasks.done} xong · ${room.tasks.open} mở`} />,
    room.cost_per_task != null && <Stat key="cpt" k="$/task" v={fmtUsd(room.cost_per_task)} />,
  ].filter(Boolean);
  return (
    <article
      aria-labelledby={id}
      data-state={n.state}
      className={cn(
        "group/room relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors duration-200",
        n.state === "needs" && "border-st-needs",
        n.state === "blocked" && "border-destructive/60",
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
          {room.model && <span className="shrink-0 text-[11px] text-(--soft)">{modelShort(room.model)}</span>}
          <span className="shrink-0 rounded border border-(--soft)/40 px-1 text-[10px] leading-4 text-(--soft)">{teamLabel(room.engine)}</span>
          {worktreeOf(room) && (
            <span className="inline-flex min-w-0 items-center gap-0.5 font-mono text-[11px] text-(--soft)" title={`worktree ${worktreeOf(room)}${room.project?.branch ? ` · nhánh ${room.project.branch}` : ""}`}>
              <GitBranchIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{room.project?.branch ?? worktreeOf(room)}</span>
            </span>
          )}
          <span className={cn("ml-auto shrink-0 text-xs font-medium", SCENE_INK[n.state])}>
            {inMeeting ? "Đi họp" : n.state === "needs" ? "Chờ anh trả lời" : NOW_LABEL[n.state]}
          </span>
        </header>
        <p className="truncate px-3.5 pt-1 text-xs text-(--soft)" title={n.card?.text}>
          {n.card ? (
            <>
              <span className="font-mono">#{n.card.id}</span> <span className="text-(--ink)">{n.card.text}</span> · {laneLabel(n.card.lane)}
            </>
          ) : (
            "Không giữ card"
          )}
        </p>
        <div className="relative mt-2 border-t-2 border-(--seam) bg-(--floor) px-3 pt-2.5 pb-2.5">
          <div className="flex min-w-0 items-end gap-4">
            <ul aria-label={`Bàn làm việc, ${working} agent chuyên gia đang chạy`} className="flex flex-wrap items-end gap-x-4 gap-y-3">
              {/* The session itself: its pose is its state (lib/now.ts deskClip), never a loop for show. */}
              <li className="flex min-w-0 flex-col items-center gap-1" title={`${room.label}: ${NOW_LABEL[n.state]}`}>
                <SpriteCanvas state={clip} after={settle} role={n.seat} shirt={shirtOf(n.seat, room.key)} seed={`${room.key}:desk`} size={DESK_PX} />
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
                  <WalkerCanvas shirt={shirtOf(n.seat, room.key)} ts={room.meeting.at} anim={meetPhase} dir={meetPhase === "back" ? "left" : "right"} />
                  <span className="min-w-0 truncate rounded-md bg-white/10 px-2 py-1 text-xs text-(--ink)">
                    {meetPhase === "out" ? `${room.label} đi họp sprint` : `${room.label} về chỗ`}
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

/** The shared sprint-meeting room of one project: every attending lead sits at the table with its "doing" line. */
function MeetingRoom({ attendees, rooms, until, now }: { attendees: Attendee[]; rooms: Room[]; until: number; now: number }) {
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
          <span className="max-w-full truncate text-[11px] leading-none font-medium text-(--ink)">{name}</span>
          <span className="line-clamp-2 text-center text-[10px] leading-tight text-(--soft)">{a.doing || "—"}</span>
          {a.blocked && <span className="line-clamp-2 text-center text-[10px] leading-tight text-[oklch(0.84_0.14_75)]">kẹt: {a.blocked}</span>}
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

/**
 * Pause / Run: HQ keeps `8sync ccc auto` on by default (useAuto); the owner can pause it. Next to it
 * the "Đội omp" switch (`8sync ccc auto omp on|off`) and where HQ can be reached from.
 */
function AutoBar({ token }: { token: string }) {
  const { status, busy, setAuto } = useAuto(token);
  if (!status) return <Skeleton className="h-8 w-56" />;
  const btn = autoButton(status);
  const stale = staleText(status);
  const lease = leaseText(status);
  const omp = !!status.teams?.includes("omp");
  // While blocked (omp on the anthropic provider) 8sync keeps the omp team off and refuses to turn it on.
  const blocked = status.omp_blocked || null;
  const host = status.remote?.host;
  // Status arrives client-side only (useAuto), so `window` is there; the remote view hides where HQ is reachable from.
  const local = isLocalHost(window.location.host);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" role="status">
      {stale && (
        <span className="basis-full text-amber-700 dark:text-amber-400" data-testid="ui-stale">
          {stale}
        </span>
      )}
      {btn && (
        <Button type="button" size="sm" variant={btn.action === "pause" ? "outline" : "default"} disabled={busy} onClick={() => void setAuto(btn.action)}>
          {btn.action === "pause" ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
          {btn.label}
        </Button>
      )}
      <span className="text-muted-foreground">{autoText(status)}</span>
      {/* "Critic trả lời ngay": on by default since v0.110.37 — a room's product/technical question
          is answered in-room at once (owner 2026-10-22: "không cần sau 1p auto trả lời, mặc định
          luôn bật"); Ship/secret/money still wait for the owner. Older 8sync: no switch. */}
      {!status.error && typeof status.delegate === "boolean" && (
        <Button
          type="button"
          size="sm"
          variant={status.delegate ? "secondary" : "outline"}
          aria-pressed={status.delegate}
          disabled={busy}
          title="Critic chọn thay owner cho câu hỏi sản phẩm/kỹ thuật của phòng (8sync ccc delegate on|off). Ship, secret, tiền, deploy vẫn chờ anh."
          onClick={() => void setAuto(status.delegate ? "critic-off" : "critic-on")}
        >
          <SparklesIcon aria-hidden />
          Critic trả lời ngay: {status.delegate ? "bật" : "tắt"}
        </Button>
      )}
      {/* "Công ty": one team for every project in scope (owner 2026-10-22: "1 cty rooms/roles agent nhận
          nhiều dự án"); `auto company on|off`. Older 8sync: no `company` in the status, no switch. */}
      {!status.error && typeof status.company === "boolean" && (
        <Button
          type="button"
          size="sm"
          variant={status.company ? "secondary" : "outline"}
          aria-pressed={status.company}
          disabled={busy}
          title="Một team làm mọi dự án trong scope: phòng hết card ở dự án mình thì lấy card gấp nhất ở dự án khác (8sync ccc auto company on|off). Board, inbox, Ship vẫn theo từng repo."
          onClick={() => void setAuto(status.company ? "company-off" : "company-on")}
        >
          <Building2Icon aria-hidden />
          Công ty: {status.company ? "bật" : "tắt"}
        </Button>
      )}
      {/* "Lease liên tục": absent on an older 8sync (no `lease_auto` in the status), so no switch there. */}
      {!status.error && typeof status.lease_auto === "boolean" && (
        <>
          <Button
            type="button"
            size="sm"
            variant={status.lease_auto ? "secondary" : "outline"}
            aria-pressed={status.lease_auto}
            disabled={busy}
            title={
              status.subscription === true
                ? "Tự gia hạn lease (tối đa 4 giờ) mỗi lần anh dùng HQ hoặc gõ prompt; gói subscription cần anh có mặt (8sync ccc auto lease auto on|off)"
                : "Tự gia hạn lease khi còn < 30 phút, dừng khi chạm ngân sách $/giờ (8sync ccc auto lease auto on|off)"
            }
            onClick={() => void setAuto(status.lease_auto ? "lease-auto-off" : "lease-auto-on")}
          >
            <RefreshCwIcon aria-hidden />
            Lease liên tục: {status.lease_auto ? "bật" : "tắt"}
          </Button>
          {lease && (
            <span className="text-xs text-muted-foreground" data-testid="lease-text">
              {lease}
            </span>
          )}
          {status.lease_error && <span className="text-destructive">{status.lease_error}</span>}
        </>
      )}
      {!status.error && (
        <Button
          type="button"
          size="sm"
          variant={omp ? "secondary" : "outline"}
          aria-pressed={omp}
          disabled={busy || (!!blocked && !omp)}
          title={blocked ? `Đội omp đang bị chặn: ${blocked}` : "Phòng omp làm việc cạnh phòng Claude Code (8sync ccc auto omp on|off)"}
          onClick={() => void setAuto(omp ? "omp-off" : "omp-on")}
        >
          <BotIcon aria-hidden />
          Đội omp: {omp ? "bật" : "tắt"}
        </Button>
      )}
      {blocked && <span className="text-xs text-muted-foreground">Đội omp bị chặn: {blocked}</span>}
      {status.omp_error && <span className="text-destructive">{status.omp_error}</span>}
      {local && (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {host ? (
            <>
              <GlobeIcon className="size-3.5" aria-hidden /> Link internet: <span className="font-mono">{host}</span>
            </>
          ) : (
            <>
              <LaptopIcon className="size-3.5" aria-hidden /> chỉ máy này · <code className="font-mono">8sync hq ui --public</code>
            </>
          )}
        </span>
      )}
    </div>
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
  boards,
  selected,
  onOpen,
  onStart,
  token,
  projects = [],
  repo = null,
  onAll,
}: {
  data: OfficeState;
  /** The shared board poll (use-board.ts): which card each room holds, and which cards just moved. */
  boards: BoardsState;
  /** The room whose chat is open (any of its names). */
  selected: string | null;
  onOpen: (room: Room) => void;
  onStart: () => void;
  /** HQ token: the Pause / Run control talks to /api/auto. */
  token: string;
  /** Folders added in the sidebar: the ones with no room get a "Mở team" button. */
  projects?: { path: string; name: string; missing?: boolean }[];
  /** The repo picked in the sidebar: only its rooms show (owner 2026-10-21: "mở dự án nào nó phải đúng cái đó"). */
  repo?: string | null;
  onAll?: () => void;
}) {
  // Company mode: each room sits at the project whose card it holds (lib/sidebar.ts companyRooms).
  const allRooms = useMemo(
    () => (office?.company ? companyRooms(office.rooms, boards.boards ?? []) : (office?.rooms ?? [])),
    [office, boards.boards],
  );
  // Worktree rooms sit under their repo (lib/sidebar.ts groupByRepo), like the sidebar.
  const allGroups = useMemo(() => groupByRepo(allRooms), [allRooms]);
  const groups = useMemo(() => (repo ? allGroups.filter((g) => rootKey(g.project.root) === rootKey(repo)) : allGroups), [allGroups, repo]);
  const rooms = useMemo(() => (repo ? groups.flatMap((g) => g.rooms) : allRooms), [repo, groups, allRooms]);
  // After a team button: read the office and the board again now, not at the next poll.
  const refresh = () => {
    retry();
    boards.reload();
  };
  const slash = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  // Company mode: a folder already in the company's scope is served by the one team (no "Mở team" there).
  const scope = office?.company ? (office.scope ?? []) : [];
  const added = projects.filter(
    (p) => !p.missing && !allGroups.some((g) => slash(g.project.root) === slash(p.path)) && (!repo || slash(p.path) === slash(repo)) && !inScope(scope, p.path),
  );
  // The project picked in the sidebar with no room running gets its team buttons too, even when it is
  // only pinned or known (owner 2026-10-22, ide "0 phòng": "mất nút mở lại team").
  const picked =
    repo && !allGroups.some((g) => slash(g.project.root) === slash(repo)) && !added.some((p) => slash(p.path) === slash(repo)) && !inScope(scope, repo)
      ? [{ path: repo, name: repo.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || repo }]
      : [];
  const idleFolders = [...added, ...picked];
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

  const rows: RosterRow[] = useMemo(
    () => roster(rooms, boards.boards ?? [], now).map((r) => ({ ...r, model: r.room.model, waiting: askLine(r.room.ask) ?? r.room.waiting })),
    [rooms, boards.boards, now],
  );
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  // Rooms stopped on the owner, in roster order (the longest wait is not reordered away), plus rooms
  // whose permission hook is counting down for the owner's click (Claude Code shows them as busy).
  const asking: AskRoom[] = useMemo(
    () =>
      rows.flatMap((n) => {
        const r = rooms.find((x) => x.key === n.key);
        if (!r || (n.state !== "needs" && !r.permit)) return [];
        return [askRoomOf(r)];
      }),
    [rows, rooms],
  );
  // Rooms whose state changed since the previous poll (React's "previous value in state" pattern).
  const sig = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, r.state])), [rows]);
  const [seen, setSeen] = useState<{ sig: Record<string, string> | null; changed: Set<string> }>({ sig: null, changed: new Set() });
  if (seen.sig !== sig && JSON.stringify(seen.sig) !== JSON.stringify(sig)) setSeen({ sig, changed: stateChanges(seen.sig, sig) });
  const changed = seen.changed;
  /** A room cheers (one-shot "done") when a card it held moved on in the latest board poll. */
  const cheers = (r: Room) => [...boards.moves.values()].some((m) => m.by != null && m.to !== "dropped" && claimMatches(m.by, r.label, r.name));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl min-[1600px]:max-w-none space-y-7 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <AutoBar token={token} />
          {rows.length > 0 && <p className="text-sm text-muted-foreground">{rosterSummary(rows)}</p>}
        </div>
        {error && !office ? (
          <ErrorNote what="văn phòng" error={error} onRetry={retry} />
        ) : !office ? (
          <OfficeSkeleton />
        ) : rooms.length === 0 ? (
          <>
            <EmptyState
              icon={<UsersIcon />}
              title={repo ? "Dự án này chưa có phòng nào chạy" : "Văn phòng đang trống"}
              action={<Button variant="outline" onClick={onStart}>Mở một session lẻ</Button>}
            >
              {repo && idleFolders.length
                ? "Bấm “Mở team” bên dưới: phòng của dự án mở lại, nối tiếp hội thoại cũ nếu có."
                : office.company
                ? "Công ty chưa có phòng nào chạy. Bấm “Mở team” ở một dự án: các phòng mở ra làm cho mọi dự án của công ty."
                : idleFolders.length
                  ? "Bấm “Mở team” ở dự án bên dưới: HQ mở 4 phòng nền (lead, dev, qa, review) và mọi thứ hiện ở đây."
                  : "Thêm thư mục dự án ở mục Projects bên trái, rồi bấm “Mở team” để mở 4 phòng nền (lead, dev, qa, review)."}
            </EmptyState>
            <TeamStarter projects={idleFolders} token={token} after={refresh} company={office.company} />
          </>
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
                  boardError={boards.error}
                  onOpen={(key) => {
                    const r = rooms.find((x) => x.key === key);
                    if (r) onOpen(r);
                  }}
                />
                {resting > 0 && (
                  <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MoonIcon className="size-3.5" aria-hidden />
                    <span>
                      <span className="font-medium text-foreground tabular">{resting}</span> thành viên team nghỉ hơn 10 phút
                    </span>
                  </p>
                )}
              </div>
              <div className="space-y-7">
                {groups.map((g) => {
                  // The repo's branch here; a worktree room shows its own branch on its card.
                  const branches = [...new Set(g.rooms.filter((r) => !worktreeOf(r)).map((r) => r.project?.branch).filter(Boolean))] as string[];
                  // A meeting needs two rooms of this repo; its file may sit in the repo or a worktree.
                  const m = meetingShown(g.rooms.length) ? meetings.find((x) => rootKey(x.root) === rootKey(g.project.root)) : undefined;
                  const here = m ? attendeesNow(m.attendees, now) : [];
                  const meeting = m && here.length ? { attendees: here, until: m.until } : null;
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
                        <span className="ml-auto">
                          <TeamControls root={g.project.root} name={g.project.name} token={token} boost={boostOn(g.rooms)} after={refresh} />
                        </span>
                      </header>
                      {meeting && <MeetingRoom attendees={meeting.attendees} rooms={g.rooms} until={meeting.until} now={now} />}
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
                              members={membersOf(r.team)}
                              now={now}
                              cheer={cheers(r)}
                          canMeet={meetingShown(g.rooms.length)}
                            />
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
                <TeamStarter projects={idleFolders} token={token} after={refresh} company={office.company} />
                {repo && office.company && inScope(scope, repo) && rooms.length === 0 && (
                  <p className="max-w-[75ch] rounded-lg border bg-card px-3.5 py-2.5 text-sm text-pretty">
                    Dự án này đã thuộc công ty nhưng chưa phòng nào làm. Thêm card ở tab Board: phòng rảnh của công ty nhận card gấp nhất, ở bất kỳ dự án nào.
                  </p>
                )}
                <details className="text-xs text-muted-foreground">
                  <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60">Cách đọc văn phòng</summary>
                  <p className="mt-2 max-w-[75ch] text-pretty">
                    Mỗi session là một phòng. Người ở bàn chính là chính session: gõ phím khi đang làm, giơ tay khi chờ anh, dấu chấm than khi card bị kẹt, ngồi yên khi rảnh, reo
                    lên một lần khi vừa chuyển card sang cột kế. Bàn phụ chỉ hiện khi agent chuyên gia ({SEATS.slice(1)
                      .map((s) => s.label)
                      .join(", ")}) đang chạy hoặc vừa xong. Khi session nhắn sang session khác, người đó đi sang phòng kia.
                  </p>
                </details>
              </div>
            </div>
          </>
        )}
        {/* Shown even with no live room: resting members never disappear. */}
        {orphans.length > 0 && (
          <section aria-labelledby="idle-orphans" className="space-y-2">
            <h2 id="idle-orphans" className="text-sm font-semibold">
              Thành viên team không còn phòng
            </h2>
            <ul className="flex flex-wrap gap-1.5">
              {orphans.map((m) => (
                <IdleChip key={`${m.team}/${m.name}`} r={m} now={now} variant="plain" />
              ))}
            </ul>
          </section>
        )}
        {old.length > 0 && (
          <details className="group/old text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{old.length} trạng thái team cũ (hơn 6 giờ)</summary>
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
