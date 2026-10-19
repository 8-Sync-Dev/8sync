"use client";

import { ChevronRightIcon, FolderIcon, FolderPlusIcon, GitBranchIcon, HandIcon, LayersIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { teamLabel } from "@/lib/labels";
import type { BoardRef, NowState } from "@/lib/now";
import { matchesSession } from "@/lib/office";
import { SIDEBAR_WORD, sidebarGroups, type SidebarGroup, type SidebarRoom } from "@/lib/sidebar";
import { ErrorNote } from "./bits";
import { RoleIcon } from "./role-badge";
import type { Hq, Live } from "./use-hq";
import type { OfficeState, Room } from "./use-office";
import type { Project } from "./types";

export type Scope = { project: number | null; session: string | null };

const item =
  "group flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 aria-[current=true]:bg-sidebar-accent aria-[current=true]:font-medium";

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
  onOpenFolder: (id: number) => void;
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
  const roomless = hq.projects.data.filter((p) => !p.missing && !groups.some((g) => g.key === norm(p.path)));

  return (
    <nav aria-label="Dự án và phòng" className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- local 4 KB svg, no optimizer needed */}
        <img src="/8sync-mark.svg" alt="" width={24} height={24} className="size-6 shrink-0 rounded-md" />
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

        <h2 className="mt-4 mb-1 px-2 text-xs font-medium text-muted-foreground">Dự án</h2>
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
          <ul className="space-y-1">
            {groups.map((g) => (
              <RepoGroup key={g.key} g={g} selected={scope.session} current={repo != null && norm(repo) === g.key && scope.session == null} onOpen={onOpenRoom} onOpenRepo={onOpenRepo} />
            ))}
          </ul>
        )}

        {roomless.length > 0 && (
          <>
            <h2 className="mt-5 mb-1 px-2 text-xs font-medium text-muted-foreground">Chưa có team</h2>
            <ul className="space-y-0.5">
              {roomless.map((p) => (
                <FolderItem key={p.id} p={p} current={scope.project === p.id && scope.session == null} onOpen={onOpenFolder} />
              ))}
            </ul>
          </>
        )}
      </div>

      <AddProject hq={hq} onAdded={onOpenFolder} />
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
}: {
  g: SidebarGroup<Room>;
  selected: string | null;
  current: boolean;
  onOpen: (r: Room) => void;
  onOpenRepo: (root: string, name: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const list = `repo-${g.key.replace(/[^\w-]/g, "_")}`;
  return (
    <li>
      <div className="flex items-center">
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
        <button type="button" className={cn(item, "h-8 gap-1.5 pl-1")} aria-current={current} title={`${g.root}: Tổng quan của dự án`} onClick={() => onOpenRepo(g.root, g.name)}>
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
      </div>
      <ul id={list} hidden={!open} className="mt-0.5 ml-[13px] space-y-0.5 border-l border-sidebar-border pl-1.5">
        {g.rooms.map((x, i) => (
          <RoomRows key={x.room.key} x={x} first={x.worktree != null && g.rooms[i - 1]?.worktree !== x.worktree} selected={selected} onOpen={onOpen} />
        ))}
      </ul>
    </li>
  );
}

function RoomRows({ x, first, selected, onOpen }: { x: SidebarRoom<Room>; first: boolean; selected: string | null; onOpen: (r: Room) => void }) {
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
      <li>
        <button
          type="button"
          className={cn(item, "h-8", x.worktree && "pl-3")}
          aria-current={matchesSession(room, selected)}
          aria-label={`${room.label}${x.worktree ? ` (worktree ${x.worktree})` : ""} · ${teamLabel(room.engine)}: ${word}`}
          title={[room.label, word, what].filter(Boolean).join(" · ")}
          onClick={() => onOpen(room)}
        >
          <RoleIcon role={n.role ?? room.role} className="size-3.5 text-muted-foreground group-aria-[current=true]:text-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px]">{room.label}</span>
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
      </li>
    </>
  );
}

function FolderItem({ p, current, onOpen }: { p: Project; current: boolean; onOpen: (id: number) => void }) {
  return (
    <li>
      <button type="button" className={cn(item, "h-8")} aria-current={current} title={`${p.path}: mở Văn phòng để bấm “Mở team”`} onClick={() => onOpen(p.id)}>
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">Mở team</span>
      </button>
    </li>
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
          live === "live" || live === "polling" ? "bg-st-running" : "bg-st-needs motion-safe:animate-pulse",
        )}
      />
      {label}
    </span>
  );
}

function AddProject({ hq, onAdded }: { hq: Hq; onAdded: (id: number) => void }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { theme, setTheme, resolvedTheme } = useTheme();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await hq.api<{ project: Project; existed?: boolean }>("/api/projects", {
        method: "POST",
        body: { path: path.trim() },
      });
      toast.success(r.existed ? `${r.project.name} đã có trong HQ` : `Đã thêm ${r.project.name}: bấm “Mở team” trong Văn phòng`);
      setPath("");
      await hq.reload.projects();
      await hq.reload.sessions();
      onAdded(r.project.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The theme is only known in the browser; render the toggle after mount.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const dark = (theme === "system" ? resolvedTheme : theme) === "dark";
  return (
    <div className="shrink-0 border-t border-sidebar-border p-3">
      <form onSubmit={submit} className="space-y-1.5">
        <label htmlFor="add-project" className="text-xs font-medium text-muted-foreground">
          Mở team ở repo mới
        </label>
        <div className="flex gap-1.5">
          <Input
            id="add-project"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/home/you/code/app"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? "add-project-error" : "add-project-hint"}
            className="h-8 font-mono text-xs"
          />
          <Button type="submit" size="icon" variant="outline" disabled={busy || !path.trim()} aria-label="Thêm thư mục">
            <FolderPlusIcon />
          </Button>
        </div>
        {error ? (
          <p id="add-project-error" className="text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p id="add-project-hint" className="text-[11px] leading-snug text-pretty text-muted-foreground">
            Chỉ cần khi repo chưa có phòng nào. Dự án đang có phòng chạy tự hiện ở trên.
          </p>
        )}
      </form>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 -ml-1 text-muted-foreground"
        onClick={() => setTheme(dark ? "light" : "dark")}
        disabled={!mounted}
      >
        {mounted && dark ? <SunIcon /> : <MoonIcon />}
        {mounted && dark ? "Giao diện sáng" : "Giao diện tối"}
      </Button>
    </div>
  );
}

const noop = () => () => {};
