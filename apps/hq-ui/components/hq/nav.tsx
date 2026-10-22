"use client";

import { ChevronRightIcon, FolderIcon, FolderPlusIcon, GitBranchIcon, HandIcon, LayersIcon, MoonIcon, PinIcon, PlusIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { teamLabel } from "@/lib/labels";
import type { BoardRef, NowState } from "@/lib/now";
import { matchesSession } from "@/lib/office";
import { SIDEBAR_WORD, companySidebar, groupKey, peopleWord, pinSidebar, sidebarGroups, splitClosed, type CompanyProject, type HiddenProject, type SidebarGroup, type SidebarRoom, projectsHeading } from "@/lib/sidebar";
import { ErrorNote } from "./bits";
import { BrandMark } from "./brand-mark";
import { CloseDialog, ClosedProjects, ProjectMenu, RoomEndDialog, RoomMenu, WorktreeDialog, useWorktreeKeys, type Confirm, type RoomAction } from "./nav-actions";
import { RoleIcon } from "./role-badge";
import type { Hq, Live } from "./use-hq";
import type { OfficeState, Room } from "./use-office";
import type { KnownProject } from "@/lib/known-projects";
import type { Project } from "./types";

export type Scope = { project: number | null; session: string | null };

/** Hover stays neutral; only the current item takes the accent (a brand wash and hairline, like the ZUS IDE selection).
 *  10 %, not more: the small "Đang làm" status text on it keeps 4.56:1 in the light theme. */
const item =
  "group flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 aria-[current=true]:bg-primary/10 aria-[current=true]:font-medium aria-[current=true]:ring-1 aria-[current=true]:ring-primary/30";

/** Amber that passes AA as text on light surfaces (same mix as now-roster / idle-chip). */
const NEEDS_INK = "text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs";

const WORD_INK: Record<NowState, string> = {
  needs: NEEDS_INK,
  blocked: "text-destructive",
  working: "text-st-running",
  holding: "text-muted-foreground",
  waiting: "text-muted-foreground",
  idle: "text-muted-foreground",
};

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * The owner's control list: every live room under its repo (worktrees folded in), with its state in
 * words. A click opens that room (what it does, what it asks, the message box), not a filter.
 */
export function Nav({
  hq,
  scope,
  office,
  boards,
  onHome,
  onOpenRoom,
  onOpenFolder,
  onOpenRepo,
  repo,
}: {
  hq: Hq;
  scope: Scope;
  office: OfficeState;
  boards: BoardRef[];
  onHome: () => void;
  onOpenRoom: (r: Room) => void;
  onOpenFolder: (id: number, p?: { path: string; name: string }) => void;
  /** A repo with rooms: its Tổng quan (that project's block only). */
  onOpenRepo: (root: string, name: string) => void;
  /** The repo Tổng quan is focused on, if any. */
  repo: string | null;
}) {
  const data = office.office;
  const now = data?.at ?? 0;
  const groups = useMemo(() => sidebarGroups(data?.rooms ?? [], boards, now), [data, boards, now]);
  const live = groups.reduce((n, g) => n + g.rooms.length, 0);
  // Folders added in HQ that have no room yet: the only reason to add a folder is to start a team there.
  const roomless = useMemo(() => hq.projects.data.filter((p) => !p.missing && !groups.some((g) => g.key === norm(p.path))), [hq.projects.data, groups]);
  const worktrees = useWorktreeKeys(hq.api, groups.map((g) => g.key).join("\n"));
  // The last close / show, applied until an /api/office newer than it carries the same row.
  const [overlay, setOverlay] = useState<{ at: number; key: string; row: HiddenProject | null } | null>(null);
  const split = useMemo(() => {
    let hidden = data?.hidden ?? [];
    if (overlay && (data?.at ?? 0) <= overlay.at) hidden = [...hidden.filter((h) => h.key !== overlay.key), ...(overlay.row ? [overlay.row] : [])];
    return splitClosed(groups, hidden);
  }, [groups, data, overlay]);
  // Pinned projects (`8sync ccc auto pin`) first under "Ghim", rooms or not; the rest as before.
  const side = useMemo(() => pinSidebar(data?.pins ?? [], split.shown, split.closed, roomless), [data, split, roomless]);
  const { shown, closed } = side;
  // Company mode (owner 2026-10-22: one company serves every project, not a full team per project):
  // one list of rooms, each tagged with the project it works on, then the projects with how many work there.
  const company = data?.company === true;
  const co = useMemo(() => (company ? companySidebar(data?.rooms ?? [], boards, now, data?.scope ?? []) : null), [company, data, boards, now]);
  const pinnedKeys = useMemo(() => new Set((data?.pins ?? []).map((p) => groupKey(p.root))), [data]);
  const coProjects = useMemo(
    () => (co ? [...co.projects].sort((a, b) => Number(pinnedKeys.has(b.key)) - Number(pinnedKeys.has(a.key))) : []),
    [co, pinnedKeys],
  );
  const heading = projectsHeading(company, co ? co.projects.length : shown.length);
  // "Dự án trên máy": known repos that are neither added folders nor live groups.
  const knownRest = useMemo(() => (hq.knownProjects ?? []).filter((k) => !groups.some((g) => g.key === norm(k.path)) && !hq.projects.data.some((p) => norm(p.path) === norm(k.path))), [hq.knownProjects, hq.projects.data, groups]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // The project whose "Hiện lại" is in flight: its "⋯" and "Hiện lại" stay disabled meanwhile.
  const [hiding, setHiding] = useState<string | null>(null);
  // The project whose pin / unpin is in flight.
  const [pinning, setPinning] = useState<string | null>(null);

  async function pin(root: string, name: string, on: boolean) {
    setPinning(groupKey(root));
    try {
      await hq.api("/api/projects/pin", { method: "POST", body: { root, pinned: on } });
      office.retry();
      toast.success(on ? `Đã ghim ${name}: luôn ở đầu sidebar, usage chặt thì lease tập trung vào đây` : `Đã bỏ ghim ${name}`);
    } catch (e) {
      toast.error(`Không ${on ? "ghim" : "bỏ ghim"} được ${name}: ${(e as Error).message}`);
    } finally {
      setPinning(null);
    }
  }

  const group = (g: SidebarGroup<Room>, pinned: boolean) => (
    <RepoGroup
      key={g.key}
      g={g}
      selected={scope.session}
      current={repo != null && norm(repo) === g.key && scope.session == null}
      onOpen={onOpenRoom}
      onOpenRepo={onOpenRepo}
      worktree={worktrees.worktrees.includes(g.key)}
      hiding={hiding === g.key}
      onClose={() => setConfirm({ kind: "close", g })}
      onDelete={() => setConfirm({ kind: "worktree", g })}
      onRoom={(x, action) => setConfirm({ kind: "room", x, action })}
      pin={<PinButton name={g.name} pinned={pinned} busy={pinning === g.key} onPin={() => void pin(g.root, g.name, !pinned)} />}
    />
  );

  function refresh() {
    office.retry();
    void hq.reload.sessions();
    worktrees.reload();
  }

  async function show(g: SidebarGroup<Room>) {
    setHiding(g.key);
    try {
      await hq.api("/api/projects/sidebar", { method: "POST", body: { root: g.root, hidden: false } });
      setOverlay({ at: data?.at ?? 0, key: g.key, row: null });
      office.retry();
      toast.success(`Đã hiện lại ${g.name}`);
    } catch (e) {
      toast.error(`Không hiện lại được ${g.name}: ${(e as Error).message}`);
    } finally {
      setHiding(null);
    }
  }

  return (
    <nav aria-label="Dự án và phòng" className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <BrandMark className="h-6 w-4 shrink-0 text-primary dark:drop-shadow-[0_0_6px_color-mix(in_oklch,var(--brand)_45%,transparent)]" />
        <span className="text-[15px] font-semibold tracking-tight">8 Sync HQ</span>
        <LiveDot live={hq.live} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <button
          type="button"
          className={cn(item, "h-8")}
          aria-current={scope.project == null && scope.session == null && repo == null}
          onClick={onHome}
        >
          <LayersIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate">Tất cả phòng</span>
          <Count n={live} />
        </button>

        {!co && side.pinned.length > 0 && (
          <>
            <h2 className="mt-4 mb-1 flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
              <PinIcon className="size-3" aria-hidden />
              Ghim
            </h2>
            <ul className="space-y-1" aria-label="Dự án ghim">
              {side.pinned.map((p) =>
                p.group ? (
                  group(p.group, true)
                ) : p.folder ? (
                  <FolderItem
                    key={p.key}
                    p={p.folder}
                    current={scope.project === p.folder.id && scope.session == null}
                    onOpen={onOpenFolder}
                    pin={<PinButton name={p.name} pinned busy={pinning === p.key} onPin={() => void pin(p.root, p.name, false)} />}
                  />
                ) : (
                  <li key={p.key} className="group/row flex items-center">
                    <button
                      type="button"
                      className={cn(item, "h-8 min-w-0 flex-1 gap-1.5 max-sm:h-11")}
                      aria-current={repo != null && norm(repo) === p.key && scope.session == null}
                      title={`${p.root}: chưa có phòng nào chạy`}
                      onClick={() => onOpenRepo(p.root, p.name)}
                    >
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">0 phòng</span>
                    </button>
                    <PinButton name={p.name} pinned busy={pinning === p.key} onPin={() => void pin(p.root, p.name, false)} />
                  </li>
                ),
              )}
            </ul>
          </>
        )}

        {co ? (
          <>
            {/* Projects first: a few rows; 18 rooms on a phone pushed them off screen. */}
            <h2 className="mt-4 mb-1 px-2 text-xs font-medium text-muted-foreground" title={heading.hint ?? undefined}>
              {heading.title}
            </h2>
            <ul className="space-y-0.5" aria-label="Dự án của công ty">
              {coProjects.map((p) => (
                <CompanyProjectRow
                  key={p.key}
                  p={p}
                  current={repo != null && norm(repo) === p.key && scope.session == null}
                  onOpen={() => onOpenRepo(p.root, p.name)}
                  pin={<PinButton name={p.name} pinned={pinnedKeys.has(p.key)} busy={pinning === p.key} onPin={() => void pin(p.root, p.name, !pinnedKeys.has(p.key))} />}
                />
              ))}
            </ul>
            <h2 className="mt-5 mb-1 px-2 text-xs font-medium text-muted-foreground" title="Một team chung: phòng nhận card gấp nhất ở mọi dự án, chữ nhỏ bên phải là dự án phòng đang làm">
              Phòng của công ty · {co.rooms.length}
            </h2>
            {co.rooms.length === 0 ? (
              <p className="px-2 py-1 text-xs leading-relaxed text-pretty text-muted-foreground">Chưa có phòng nào chạy. Bấm “Mở team” ở một dự án là cả công ty có người.</p>
            ) : (
              <ul className="space-y-0.5" aria-label="Phòng của công ty">
                {co.rooms.map((x) => (
                  <RoomRows key={x.room.key} x={{ ...x, worktree: null }} at={x.working ? x.at.name : undefined} first={false} selected={scope.session} onOpen={onOpenRoom} onPick={(a) => setConfirm({ kind: "room", x, action: a })} />
                ))}
              </ul>
            )}
            <KnownProjects items={knownRest} hq={hq} onOpen={onOpenFolder} />
          </>
        ) : (
          <>
        <h2 className="mt-4 mb-1 px-2 text-xs font-medium text-muted-foreground" title={heading.hint ?? undefined}>
          {heading.title}
        </h2>
        {!data && office.error ? (
          <div className="px-1">
            <ErrorNote what="danh sách phòng" error={office.error} onRetry={office.retry} />
          </div>
        ) : !data ? (
          <div className="space-y-2 px-2 py-1" aria-busy="true" aria-label="Đang tải phòng">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="ml-4 h-4 w-1/2" />
            <Skeleton className="ml-4 h-4 w-2/3" />
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 py-1 text-xs leading-relaxed text-pretty text-muted-foreground">
            Chưa có phòng nào chạy. Dự án có phòng đang chạy tự hiện ở đây, kể cả session mở ngoài HQ.
          </p>
        ) : (
          <>
            {shown.length === 0 ? (
              closed.length > 0 && (
                <p className="px-2 py-1 text-xs leading-relaxed text-pretty text-muted-foreground">
                  Mọi dự án đang đóng. Dự án tự hiện lại khi có phòng hoạt động hoặc chờ anh.
                </p>
              )
            ) : (
              <ul className="space-y-1">{shown.map((g) => group(g, false))}</ul>
            )}
            <ClosedProjects closed={closed} busy={hiding} onShow={(g) => void show(g)} />
            <KnownProjects items={knownRest} hq={hq} onOpen={onOpenFolder} />
          </>
        )}
          </>
        )}

        {side.folders.length > 0 && (
          <>
            <h2 className="mt-5 mb-1 px-2 text-xs font-medium text-muted-foreground">Chưa có team</h2>
            <ul className="space-y-0.5">
              {side.folders.map((p) => (
                <FolderItem
                  key={p.id}
                  p={p}
                  current={scope.project === p.id && scope.session == null}
                  onOpen={onOpenFolder}
                  pin={<PinButton name={p.name} pinned={false} busy={pinning === groupKey(p.path)} onPin={() => void pin(p.path, p.name, true)} />}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <AddProject hq={hq} onAdded={onOpenFolder} company={company} />

      {confirm?.kind === "room" && (
        <RoomEndDialog
          hq={hq}
          x={confirm.x}
          action={confirm.action}
          onCancel={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            refresh();
          }}
        />
      )}
      {confirm?.kind === "worktree" && (
        <WorktreeDialog
          hq={hq}
          g={confirm.g}
          onCancel={() => setConfirm(null)}
          onRoomsClosed={refresh}
          onDone={() => {
            setConfirm(null);
            refresh();
          }}
        />
      )}
      {confirm?.kind === "close" && (
        <CloseDialog
          hq={hq}
          g={confirm.g}
          onCancel={() => setConfirm(null)}
          onHidden={(row) => {
            setOverlay({ at: data?.at ?? 0, key: confirm.g.key, row });
            setConfirm(null);
            refresh();
          }}
        />
      )}
    </nav>
  );
}

/**
 * One repo, open by default; worktree rooms sit under a `⎇ <worktree>` line after the repo's own rooms.
 * The folder opens that project's Tổng quan; the chevron alone folds the list.
 */
function RepoGroup({
  g,
  selected,
  current,
  onOpen,
  onOpenRepo,
  worktree,
  hiding,
  onClose,
  onDelete,
  onRoom,
  pin,
}: {
  g: SidebarGroup<Room>;
  selected: string | null;
  current: boolean;
  onOpen: (r: Room) => void;
  onOpenRepo: (root: string, name: string) => void;
  /** The project folder is a git worktree: "Xóa worktree" shows. */
  worktree: boolean;
  hiding: boolean;
  onClose: () => void;
  onDelete: () => void;
  onRoom: (x: SidebarRoom<Room>, action: RoomAction) => void;
  /** The pin / unpin button. */
  pin: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const list = `repo-${g.key.replace(/[^\w-]/g, "_")}`;
  return (
    <li>
      <div className="group/row flex items-center">
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-expanded={open}
          aria-controls={list}
          aria-label={`${open ? "Thu gọn" : "Mở"} ${g.name}`}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRightIcon className={cn("size-3 transition-transform motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        </button>
        <button type="button" className={cn(item, "h-8 min-w-0 flex-1 gap-1.5 pl-1 max-sm:h-11")} aria-current={current} title={`${g.root}: Tổng quan của dự án`} onClick={() => onOpenRepo(g.root, g.name)}>
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
          {g.needs > 0 ? (
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-st-needs/15 px-1.5 text-[11px] font-semibold tabular", NEEDS_INK)}>
              <HandIcon className="size-3" aria-hidden />
              {g.needs}
              <span className="sr-only"> phòng chờ anh</span>
            </span>
          ) : (
            <Count n={g.rooms.length} />
          )}
        </button>
        {pin}
        <ProjectMenu g={g} worktree={worktree} busy={hiding} onClose={onClose} onDelete={onDelete} />
      </div>
      <ul id={list} hidden={!open} className="mt-0.5 ml-[13px] space-y-0.5 border-l border-sidebar-border pl-1.5">
        {g.rooms.map((x, i) => (
          <RoomRows key={x.room.key} x={x} first={x.worktree != null && g.rooms[i - 1]?.worktree !== x.worktree} selected={selected} onOpen={onOpen} onPick={(a) => onRoom(x, a)} />
        ))}
      </ul>
    </li>
  );
}

function RoomRows({
  x,
  at,
  first,
  selected,
  onOpen,
  onPick,
}: {
  x: SidebarRoom<Room>;
  /** Company mode: the project this room works on now. */
  at?: string;
  first: boolean;
  selected: string | null;
  onOpen: (r: Room) => void;
  onPick: (a: RoomAction) => void;
}) {
  const { room, now: n } = x;
  const word = SIDEBAR_WORD[n.state];
  const what = room.ask ? null : (n.last?.text ?? null);
  return (
    <>
      {first && (
        <li aria-hidden className="flex h-6 items-center gap-1 px-2 pt-1 font-mono text-[11px] text-muted-foreground">
          <GitBranchIcon className="size-3 shrink-0" />
          <span className="truncate">{x.worktree}</span>
        </li>
      )}
      <li className="group/row flex items-center">
        <button
          type="button"
          className={cn(item, "h-8 min-w-0 flex-1 max-sm:h-11", x.worktree && "pl-3")}
          aria-current={matchesSession(room, selected)}
          aria-label={`${room.label}${x.worktree ? ` (worktree ${x.worktree})` : ""}${at ? ` ở ${at}` : ""} · ${teamLabel(room.engine)}: ${word}`}
          title={[room.label, at, word, what].filter(Boolean).join(" · ")}
          onClick={() => onOpen(room)}
        >
          <RoleIcon role={n.role ?? room.role} className="size-3.5 text-muted-foreground group-aria-[current=true]:text-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {room.label}
            {at && <span className="ml-1.5 text-[11px] text-muted-foreground">{at}</span>}
          </span>
          {room.engine === "omp" && <span className="shrink-0 text-[10px] text-muted-foreground">{teamLabel(room.engine)}</span>}
          {n.state === "needs" ? (
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-st-needs/15 px-1.5 py-px text-[11px] font-semibold", NEEDS_INK)}>
              <span aria-hidden className="size-1.5 rounded-full bg-st-needs motion-safe:animate-pulse" />
              {word}
            </span>
          ) : (
            <span className={cn("shrink-0 text-[11px]", WORD_INK[n.state], n.flagged && "font-medium text-foreground")}>{word}</span>
          )}
        </button>
        <RoomMenu x={x} onPick={onPick} />
      </li>
    </>
  );
}

/** One project the company serves: who works there now, its open cards, rooms waiting on the owner. */
function CompanyProjectRow({ p, current, onOpen, pin }: { p: CompanyProject; current: boolean; onOpen: () => void; pin: ReactNode }) {
  return (
    <li className="group/row flex items-center">
      <button
        type="button"
        className={cn(item, "h-8 min-w-0 flex-1 gap-1.5 max-sm:h-11")}
        aria-current={current}
        title={`${p.root}: ${peopleWord(p.people)} đang làm, ${p.open} card mở`}
        onClick={onOpen}
      >
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
        {p.needs > 0 && (
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-st-needs/15 px-1.5 text-[11px] font-semibold tabular", NEEDS_INK)}>
            <HandIcon className="size-3" aria-hidden />
            {p.needs}
            <span className="sr-only"> phòng chờ anh</span>
          </span>
        )}
        <span className={cn("shrink-0 text-[11px] tabular", p.people > 0 ? "text-foreground" : "text-muted-foreground")}>{peopleWord(p.people)}</span>
        {p.open > 0 && <span className="shrink-0 text-[11px] text-muted-foreground tabular">· {p.open} card</span>}
      </button>
      {pin}
    </li>
  );
}

function FolderItem({ p, current, onOpen, pin }: { p: Project; current: boolean; onOpen: (id: number) => void; pin: ReactNode }) {
  return (
    <li className="group/row flex items-center">
      <button type="button" className={cn(item, "h-8 min-w-0 flex-1")} aria-current={current} title={`${p.path}: mở Văn phòng để bấm “Mở team”`} onClick={() => onOpen(p.id)}>
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">Mở team</span>
      </button>
      {pin}
    </li>
  );
}

/**
 * Pin / unpin a project (`8sync ccc auto pin|unpin`): a pinned one sits under "Ghim" at the top, even
 * with no room, and gets the usage first when it runs short. Shown on hover/focus until pinned.
 */
function PinButton({ name, pinned, busy, onPin }: { name: string; pinned: boolean; busy: boolean; onPin: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 max-sm:size-11",
        pinned ? "text-primary" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:opacity-100",
      )}
      aria-pressed={pinned}
      aria-label={pinned ? `Bỏ ghim ${name}` : `Ghim ${name}`}
      title={pinned ? `Bỏ ghim ${name}` : `Ghim ${name}: luôn ở đầu sidebar; usage chặt thì lease tập trung vào dự án ghim`}
      disabled={busy}
      onClick={onPin}
    >
      <PinIcon className={cn("size-3.5", pinned && "fill-current")} aria-hidden />
    </button>
  );
}

function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="tabular text-xs text-muted-foreground">{n}</span>;
}

function LiveDot({ live }: { live: Live }) {
  const label = live === "live" ? "Live" : live === "polling" ? "Cập nhật 3 giây/lần" : live === "connecting" ? "Đang kết nối" : "Đang nối lại";
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          live === "live" || live === "polling" ? "bg-st-running shadow-glow-dot" : "bg-st-needs motion-safe:animate-pulse",
        )}
      />
      {label}
    </span>
  );
}

/**
 * "+ Dự án" (owner 2026-10-22: "không có nút tạo dự án … tạo xong giao spec mới để làm"): one dialog.
 * A folder that exists is added; one that does not is created (with git). With a spec, the team opens
 * at once with the spec as its first card (`auto up "<spec>"`, on the board before any room starts).
 */
function AddProject({ hq, onAdded, company }: { hq: Hq; onAdded: (id: number, p?: { path: string; name: string }) => void; company: boolean }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [spec, setSpec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { theme, setTheme, resolvedTheme } = useTheme();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = path.trim();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      type Added = { project: Project; existed?: boolean };
      let r: Added;
      let created = false;
      try {
        r = await hq.api<Added>("/api/projects", { method: "POST", body: { path: p } });
      } catch (err) {
        if (!/does not exist/.test((err as Error).message)) throw err;
        r = await hq.api<Added>("/api/projects", { method: "POST", body: { path: p, create: true } });
        created = true;
      }
      await hq.reload.projects();
      setOpen(false);
      setPath("");
      onAdded(r.project.id, r.project);
      const name = r.project.name;
      if (!spec.trim()) {
        toast.success(created ? `Đã tạo ${name}` : r.existed ? `${name} đã có trong HQ` : `Đã thêm ${name}`, { description: company ? "Bấm “Đưa vào công ty” trong Văn phòng." : "Bấm “Mở team” trong Văn phòng để có phòng làm." });
        return;
      }
      const wait = toast.loading(`Đang mở team cho ${name} với việc đầu tiên…`);
      try {
        await hq.api("/api/team", { method: "POST", body: { root: r.project.path, action: "up", task: spec.trim() } });
        toast.success(`${name}: team đã nhận việc`, { id: wait, description: "Lead viết AC từ spec, dev/qa/review kéo card theo cột. Xem ở Board." });
        setSpec("");
      } catch (err) {
        const m = (err as Error).message;
        toast.error(`${name}: chưa mở được team`, {
          id: wait,
          duration: 20_000,
          description: /trust/i.test(m)
            ? `Claude Code cần anh tin thư mục này một lần: mở terminal ở ${r.project.path}, chạy claude, chọn Yes, rồi bấm “Mở team”. Spec đã nằm trên Board.`
            : m,
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      void hq.reload.sessions();
    }
  }

  // The theme is only known in the browser; render the toggle after mount.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const dark = (theme === "system" ? resolvedTheme : theme) === "dark";
  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border p-2">
      <Button type="button" size="sm" className="flex-1" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden /> Dự án
      </Button>
      <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" onClick={() => setTheme(dark ? "light" : "dark")} disabled={!mounted} aria-label={mounted && dark ? "Giao diện sáng" : "Giao diện tối"}>
        {mounted && dark ? <SunIcon /> : <MoonIcon />}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Dự án</DialogTitle>
              <DialogDescription>Thư mục chưa có thì HQ tạo mới (kèm git). Có spec thì team mở ngay và nhận spec làm việc đầu tiên.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <label htmlFor="add-project" className="text-sm font-medium">
                Thư mục
              </label>
              <Input
                id="add-project"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="C:\\Users\\Projects\\du-an-moi"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!error}
                aria-describedby={error ? "add-project-error" : undefined}
                className="font-mono text-sm"
                autoFocus
              />
              {error && (
                <p id="add-project-error" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="add-project-spec" className="text-sm font-medium">
                Việc đầu tiên <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              </label>
              <Textarea id="add-project-spec" value={spec} onChange={(e) => setSpec(e.target.value)} rows={5} maxLength={4000} placeholder="Ví dụ: Trang landing cho ZUS, có form đăng ký email, deploy lên Vercel." />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Thôi
              </Button>
              <Button type="submit" disabled={busy || !path.trim()}>
                <FolderPlusIcon aria-hidden /> {busy ? "Đang làm…" : spec.trim() ? "Tạo và giao việc" : "Thêm dự án"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const noop = () => () => {};

/**
 * "Dự án trên máy" (owner 2026-10-22): repos 8sync has seen on this machine but the owner never added
 * to HQ. One tap adds the folder and opens it in the office, where "Mở team" waits.
 */
function KnownProjects({ items, hq, onOpen }: { items: KnownProject[]; hq: Hq; onOpen: (id: number, p?: { path: string; name: string }) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return null;
  async function add(k: KnownProject) {
    setBusy(k.path);
    try {
      const r = await hq.api<{ project: Project; existed?: boolean }>("/api/projects", { method: "POST", body: { path: k.path } });
      await hq.reload.projects();
      toast.success(`Đã thêm ${r.project.name}: bấm “Mở team” trong Văn phòng`);
      onOpen(r.project.id, r.project);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    // Every repo on the machine can be dozens: folded past 8 so the rooms stay on screen.
    <details className="group/known mt-3" open={items.length <= 8}>
      <summary
        id="known-projects"
        className="mb-1 flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        title="Repo trên máy này: Claude Code đã tin, 8sync đã chạy, hoặc tìm thấy cạnh các repo đó. Bấm một repo để thêm vào HQ và mở."
      >
        <ChevronRightIcon className="size-3 transition-transform group-open/known:rotate-90 motion-reduce:transition-none" aria-hidden />
        Dự án trên máy · {items.length}
      </summary>
      <ul className="space-y-1" aria-labelledby="known-projects">
        {items.map((k) => (
          <li key={k.path} className="flex items-center">
            <button type="button" className={cn(item, "h-8 min-w-0 flex-1")} disabled={busy === k.path} title={`${k.path} (${k.source}): thêm vào HQ và mở`} onClick={() => void add(k)}>
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{k.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{busy === k.path ? "…" : "Mở"}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
