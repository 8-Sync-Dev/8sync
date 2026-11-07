"use client";

// The sidebar, laid out like Claude Code Desktop (owner 2026-11-02, from a screenshot): "+ Phiên mới",
// Tìm and the views as plain rows; then the sessions by project folder → session → sub-session
// (omp `task` subagents, a Claude Code room's running agents), with "Nhóm & sắp xếp" on a group
// heading; the account and settings at the bottom. Rules: lib/session-tree.ts.
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  BotIcon,
  Building2Icon,
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  ColumnsIcon,
  EllipsisIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  ImageIcon,
  LayoutDashboardIcon,
  LoaderIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  MoonIcon,
  PlusIcon,
  PowerIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Fragment, useMemo, useState, useSyncExternalStore, type DragEvent, type FormEvent, type MouseEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { branchIndex, dirOf, folderNote, groupBranches, homeOf, shownOrder, spotOf, type WorktreeSpot } from "@/lib/branches";
import { botStatus } from "@/lib/bots";
import { agoShort } from "@/lib/now";
import { GROUP_WORD, SORT_WORD, TREE_WORD, groupSessions, isUnread, moveKey, orderGroups, splitChildren, type GroupBy, type SortBy, type TreeChild, type TreeGroup, type TreeSession } from "@/lib/session-tree";
import { groupKey, sidebarGroups, type HiddenProject, type SidebarGroup, type SidebarRoom } from "@/lib/sidebar";
import { MORE_LABEL, MORE_TABS, moreTabs } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { ErrorNote } from "./bits";
import { BrandMark } from "./brand-mark";
import { CloseDialog, OmpDeleteDialog, ProjectDeleteDialog, RoomEndDialog, WorktreeDialog, useBranches, useWorktreeKeys, type Confirm } from "./nav-actions";
import { useArchive, useTreeOrder, useTreePrefs, useUnread, type SessionTree } from "./use-session-tree";
import type { Hq, Live } from "./use-hq";
import type { OfficeState, Room } from "./use-office";
import type { KnownProject } from "@/lib/known-projects";
import type { Project } from "./types";

/** The owner's account line (owner 2026-11-02: "Alex · 8 Sync"). HQ is one owner's local tool: no login. */
const ACCOUNT = "Alex · 8 Sync";

/** Plain rows: neutral hover, the current one a gray layer (no brand wash: lime is only the mark and the primary button). */
const row =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 aria-[current=true]:bg-sidebar-accent aria-[current=true]:font-medium motion-reduce:transition-none";

/** Hover-only controls on a row or heading: always there on touch screens and phones. */
const HOVER =
  "opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none";

const ICON_BTN =
  "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-black/5 dark:hover:bg-white/10 dark:data-[state=open]:bg-white/10 max-md:size-9";

export type NavView = "bots" | "overview" | "office" | "preview" | "group" | "loops" | (typeof MORE_TABS)[number];

const VIEWS: { tab: NavView; label: string; icon: typeof SearchIcon }[] = [
  { tab: "bots", label: "Bots", icon: BotIcon },
  { tab: "overview", label: "Tổng quan", icon: LayoutDashboardIcon },
  { tab: "office", label: "Văn phòng", icon: Building2Icon },
  { tab: "preview", label: "Preview", icon: ImageIcon },
  { tab: "group", label: "Chat", icon: MessagesSquareIcon },
  { tab: "loops", label: "Vòng lặp", icon: CalendarClockIcon },
];
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

export function Nav({
  hq,
  office,
  tree,
  tab,
  active,
  onTab,
  onNew,
  onOpenSession,
  onOpenRoom,
  onOpenRepo,
  onOpenFolder,
  onAddProject,
  onHelp,
  contentOn,
}: {
  hq: Hq;
  office: OfficeState;
  tree: SessionTree;
  /** The open tab: its row reads as current. */
  tab: string;
  /** The session on screen (pane or room chat). */
  active: string | null;
  onTab: (t: NavView | "may") => void;
  /** "+ Phiên mới" (root null) or a group's "+" (that folder). */
  onNew: (root: string | null) => void;
  /** `split`: Alt+click or "Mở cạnh nhau". */
  onOpenSession: (s: TreeSession, split: boolean) => void;
  onOpenRoom: (r: Room) => void;
  onOpenRepo: (root: string, name: string) => void;
  onOpenFolder: (id: number, p?: { path: string; name: string }) => void;
  onAddProject: () => void;
  onHelp: () => void;
  /** A content DB is configured: "Nội dung" is offered. */
  contentOn: boolean;
}) {
  const MORE = useMemo(() => moreTabs(contentOn).filter((t) => t !== "loops" && t !== "may"), [contentOn]);
  const { prefs, setGroup, setSort, toggleCollapsed } = useTreePrefs();
  const { order, set: setOrder } = useTreeOrder();
  const archive = useArchive();
  const unread = useUnread();
  const [query, setQuery] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const data = office.office;
  const botsNeed = (data?.rooms ?? []).filter((r) => r.status !== "ended" && botStatus(r) === "needs").length;
  // The newest server clock seen (office or the session poll); 0 until one answers (no times shown).
  const now = Math.max(data?.at ?? 0, tree.at);

  // The office's room groups: the close / delete dialogs act on them.
  const roomGroups = useMemo(() => sidebarGroups(data?.rooms ?? [], now), [data, now]);
  const worktrees = useWorktreeKeys(hq.api, roomGroups.map((g) => g.key).join("\n"));
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // The last hide / show, applied until an /api/office newer than it carries the same row.
  const [overlay, setOverlay] = useState<{ at: number; key: string; row: HiddenProject | null } | null>(null);
  const hidden = useMemo(() => {
    let h = data?.hidden ?? [];
    if (overlay && (data?.at ?? 0) <= overlay.at) h = [...h.filter((x) => x.key !== overlay.key), ...(overlay.row ? [overlay.row] : [])];
    return h;
  }, [data, overlay]);
  const [showing, setShowing] = useState<string | null>(null);

  // Git's worktrees of every known project (null until the first answer: no branch headers yet),
  // asked again from git when the sessions' folders change.
  const dirs = useMemo(() => [...new Set(tree.sessions.map((s) => groupKey(dirOf(s) ?? "")))].sort().join("\n"), [tree.sessions]);
  const repos = useBranches(hq.api, dirs);
  const branches = useMemo(() => (repos ? branchIndex(repos) : null), [repos]);

  // A hidden project comes back by itself on new activity or when a session waits on the owner.
  // A session in a linked worktree hides with its repo's project too (it shows under it).
  const hiddenAt = useMemo(() => new Map(hidden.map((h) => [h.key, h.hidden_at])), [hidden]);
  const isHidden = (s: TreeSession) => {
    const at = (s.root ? hiddenAt.get(groupKey(s.root)) : undefined) ?? hiddenAt.get(homeOf(s, branches).key);
    return at != null && s.state !== "needs" && (s.at ?? 0) <= at;
  };
  const q = query ? fold(query.trim()) : "";
  const visible = tree.sessions.filter(
    (s) => !archive.keys.includes(s.key) && !isHidden(s) && (!q || fold(`${s.title} ${s.name} ${s.folder} ${spotOf(dirOf(s), branches)?.label ?? ""}`).includes(q)),
  );
  const stored = tree.sessions.filter((s) => archive.keys.includes(s.key));
  // Folders added in HQ with no session yet: a heading with "+" to start one there. A linked worktree
  // of a repo already on screen is not one: it is listed under that repo's branches.
  const groups = useMemo(() => {
    const gs = groupSessions(visible, prefs.group, prefs.sort, order, branches);
    if (prefs.group !== "project" || q) return gs;
    const onScreen = (p: string) => gs.some((g) => g.root && groupKey(g.root) === groupKey(p));
    const extra: TreeGroup[] = hq.projects.data
      .filter((p) => {
        const spot = spotOf(p.path, branches);
        return !p.missing && !onScreen(p.path) && !(spot && !spot.main && spot.key === groupKey(p.path) && onScreen(spot.repo)) && !hiddenAt.has(groupKey(p.path));
      })
      .map((p) => ({ key: groupKey(p.path), label: p.name, root: p.path, sessions: [] }));
    return prefs.sort === "manual" ? orderGroups([...gs, ...extra], order) : [...gs, ...extra];
    // `visible` is rebuilt every render; its inputs are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.sessions, archive.keys, hidden, q, prefs.group, prefs.sort, order, hq.projects.data, branches]);
  // By project: each group's sessions under their worktree's branch (lib/branches.ts).
  const branchesOf = useMemo(() => new Map(groups.map((g) => [g.key, prefs.group === "project" ? groupBranches(g, branches) : null])), [groups, branches, prefs.group]);

  // Drag & drop: a session moves inside its own group, a project heading among the projects (not
  // while searching: the list on screen is then a subset). A drop pins the whole list as it is now,
  // read across the branch headers (a session keeps its branch: that is git's, not the order's).
  const [drag, setDrag] = useState<{ kind: "s" | "g"; key: string; group: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const groupDrag = prefs.group === "project" && !q;
  const shownSessions = groups.flatMap((g) => shownOrder(g, branchesOf.get(g.key) ?? null).map((s) => s.key));
  const shownGroups = groups.map((g) => g.key);
  const dropOn = (kind: "s" | "g", to: string) => {
    if (!drag || drag.kind !== kind || drag.key === to) return;
    const pinGroups = prefs.group === "project" && shownGroups.length > 0;
    setOrder({
      sessions: moveKey(order.sessions, shownSessions, kind === "s" ? drag.key : shownSessions[0], kind === "s" ? to : shownSessions[0]),
      groups: pinGroups ? moveKey(order.groups, shownGroups, kind === "g" ? drag.key : shownGroups[0], kind === "g" ? to : shownGroups[0]) : order.groups,
    });
  };
  /** Where the dragged row would land on `key`: above it when coming from below, else below it. */
  const landing = (kind: "s" | "g", key: string): "above" | "below" | null => {
    if (!drag || drag.kind !== kind || over !== key) return null;
    const list = kind === "s" ? shownSessions : shownGroups;
    return list.indexOf(drag.key) > list.indexOf(key) ? "above" : "below";
  };
  const dnd = (kind: "s" | "g", key: string, group: string, on: boolean) =>
    on
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", key);
            setDrag({ kind, key, group });
          },
          onDragEnd: () => {
            setDrag(null);
            setOver(null);
          },
          onDragOver: (e: DragEvent) => {
            if (!drag || drag.kind !== kind || (kind === "s" && drag.group !== group)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (over !== key) setOver(key);
          },
          onDrop: (e: DragEvent) => {
            if (!drag || drag.kind !== kind) return;
            e.preventDefault();
            e.stopPropagation();
            dropOn(kind, key);
            setDrag(null);
            setOver(null);
          },
        }
      : {};
  const knownRest = useMemo(
    () => (hq.knownProjects ?? []).filter((k) => !tree.sessions.some((s) => s.root && groupKey(s.root) === groupKey(k.path)) && !hq.projects.data.some((p) => groupKey(p.path) === groupKey(k.path))),
    [hq.knownProjects, hq.projects.data, tree.sessions],
  );

  const roomOf = (s: TreeSession): SidebarRoom<Room> | null => {
    for (const g of roomGroups) for (const x of g.rooms) if (x.room.key === s.room) return x;
    return null;
  };
  const groupOf = (g: TreeGroup): SidebarGroup<Room> | null => {
    if (!g.root) return null;
    const key = groupKey(g.root);
    return roomGroups.find((x) => x.key === key) ?? { key, name: g.label, root: g.root, needs: 0, rooms: [] };
  };

  function refresh() {
    office.retry();
    tree.reload();
    void hq.reload.sessions();
    worktrees.reload();
  }

  async function show(h: HiddenProject) {
    setShowing(h.key);
    try {
      await hq.api("/api/projects/sidebar", { method: "POST", body: { root: h.root, hidden: false } });
      setOverlay({ at: data?.at ?? 0, key: h.key, row: null });
      office.retry();
      toast.success(`Đã hiện lại ${h.name}`);
    } catch (e) {
      toast.error(`Không hiện lại được ${h.name}: ${(e as Error).message}`);
    } finally {
      setShowing(null);
    }
  }

  const open = (s: TreeSession, split: boolean) => {
    unread.seen(s.key);
    onOpenSession(s, split);
  };

  const sortMenu = (g: TreeGroup | null) => (
    <GroupMenu
      label={g ? g.label : "danh sách phiên"}
      group={prefs.group}
      sort={prefs.sort}
      onGroup={setGroup}
      onSort={setSort}
      project={
        g?.root
          ? {
              onOverview: () => onOpenRepo(g.root!, g.label),
              worktree: worktrees.worktrees.includes(groupKey(g.root)),
              onHide: () => setConfirm({ kind: "close", g: groupOf(g)! }),
              onDelete: () => setConfirm({ kind: "worktree", g: groupOf(g)! }),
              onDeleteAll: () => setConfirm({ kind: "project", g }),
            }
          : null
      }
    />
  );

  return (
    <nav aria-label="Phiên và dự án" className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        {/* The mark keeps the 8 Sync lime/leaf whatever the UI accent is (brand kit: never recolour it). */}
        <BrandMark className="h-6 w-4 shrink-0 text-brand-ink dark:text-brand" />
        <span className="text-[15px] font-semibold tracking-tight">8 Sync HQ</span>
        <LiveDot live={hq.live} />
      </div>

      <div className="shrink-0 space-y-0.5 px-2 pb-2">
        <button
          type="button"
          onClick={() => onNew(null)}
          title="Phiên mới (Ctrl+N hoặc Alt+N)"
          className="mb-1.5 flex h-8 w-full items-center gap-2 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-xs outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar motion-reduce:transition-none max-md:h-10"
        >
          <PlusIcon className="size-4" aria-hidden /> Phiên mới
          <kbd className="ml-auto font-sans text-[11px] font-normal opacity-75 max-md:hidden">Ctrl N</kbd>
        </button>
        {query == null ? (
          <button type="button" className={cn(row, "h-7 max-md:h-10")} onClick={() => setQuery("")}>
            <SearchIcon className="size-4 text-muted-foreground" aria-hidden /> Tìm
          </button>
        ) : (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery(null)}
              placeholder="Tìm phiên, dự án…"
              aria-label="Tìm phiên theo tên hoặc dự án"
              className="h-7 bg-background pr-7 pl-8 text-[13px] max-md:h-10"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className={cn(ICON_BTN, "absolute top-1/2 right-0.5 -translate-y-1/2")} aria-label="Đóng tìm kiếm" onClick={() => setQuery(null)}>
              <XIcon className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
        {VIEWS.map((v) => (
          <button key={v.tab} type="button" className={cn(row, "h-7 max-md:h-10")} aria-current={tab === v.tab} onClick={() => onTab(v.tab)}>
            <v.icon className="size-4 text-muted-foreground" aria-hidden /> {v.label}
            {v.tab === "bots" && botsNeed > 0 && (
              <span className="ml-auto rounded-full bg-st-needs/20 px-1.5 text-[11px] font-semibold text-[color-mix(in_oklch,var(--st-needs),black_42%)] tabular dark:text-st-needs" aria-label={`${botsNeed} bot chờ anh`}>
                {botsNeed}
              </span>
            )}
          </button>
        ))}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger className={cn(row, "h-7 max-md:h-10")} aria-current={(MORE as readonly string[]).includes(tab)}>
            <EllipsisIcon className="size-4 text-muted-foreground" aria-hidden />
            {(MORE as readonly string[]).includes(tab) ? MORE_LABEL[tab as (typeof MORE)[number]] : "Thêm"}
          </DropdownMenuTrigger>
          {/* No exit fade (`!`: the primitive's animate-out sorts later): an item switches the view, and a
              fade stalled by a busy or hidden window left the half-transparent menu over the session list
              (UAT 2026-11-07). */}
          <DropdownMenuContent align="start" className="min-w-44 data-closed:animate-none!">
            {MORE.map((t) => (
              <DropdownMenuItem key={t} onSelect={() => onTab(t)} className={cn(tab === t && "font-semibold")}>
                {MORE_LABEL[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {archived ? (
          <ArchiveView
            sessions={stored}
            hidden={hidden}
            showing={showing}
            now={now}
            onBack={() => setArchived(false)}
            onRestore={(k) => archive.toggle(k)}
            onShow={(h) => void show(h)}
            onOpen={(s) => open(s, false)}
          />
        ) : (
          <>
            <div className="group/row flex h-7 items-center gap-1 pr-0.5 pl-2">
              <h2 className="flex-1 text-xs font-medium text-muted-foreground">
                Phiên
                {prefs.group !== "project" && <span className="font-normal"> · {GROUP_WORD[prefs.group].toLowerCase()}</span>}
              </h2>
              <span className={HOVER}>{sortMenu(null)}</span>
            </div>
            {tree.error ? (
              <div className="px-1">
                <ErrorNote what="danh sách phiên" error={tree.error} onRetry={refresh} />
              </div>
            ) : tree.loading ? (
              <div className="space-y-2 px-2 py-1" aria-busy="true" aria-label="Đang tải phiên">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="ml-3 h-4 w-1/2" />
                <Skeleton className="ml-3 h-4 w-2/3" />
              </div>
            ) : groups.length === 0 ? (
              <p className="px-2 py-1 text-xs leading-relaxed text-pretty text-muted-foreground">
                {q ? `Không có phiên nào khớp “${query}”.` : "Chưa có phiên nào. Bấm Phiên mới để bắt đầu trong một thư mục."}
              </p>
            ) : (
              <ul className="space-y-2">
                {groups.map((g) => {
                  const folded = prefs.collapsed.includes(`g:${g.key}`);
                  const listId = `grp-${g.key.replace(/[^\w-]/g, "_")}`;
                  const gl = landing("g", g.key);
                  const b = branchesOf.get(g.key) ?? null;
                  // Folded by default: `w:<group>` in the prefs list means the owner opened it.
                  const idleOpen = prefs.collapsed.includes(`w:${g.key}`);
                  const sessionRow = (s: TreeSession) => (
                    <SessionRow
                      key={s.key}
                      dnd={dnd("s", s.key, g.key, true)}
                      dragging={drag?.key === s.key}
                      landing={landing("s", s.key)}
                      s={s}
                      branch={prefs.group === "project" ? null : (spotOf(dirOf(s), branches)?.label ?? null)}
                      now={now}
                      current={active === s.key || (s.room != null && active === s.room)}
                      unread={isUnread(s, unread.keys)}
                      folded={prefs.collapsed.includes(`s:${s.key}`)}
                      onFold={() => toggleCollapsed(`s:${s.key}`)}
                      onOpen={open}
                      onChat={() => {
                        const x = roomOf(s);
                        if (x) onOpenRoom(x.room);
                      }}
                      onArchive={() => {
                        archive.toggle(s.key);
                        toast.success(`Đã lưu trữ “${s.title}”`, { description: "Chỉ ẩn trong HQ trên trình duyệt này; không xoá gì trên máy.", action: { label: "Hoàn tác", onClick: () => archive.toggle(s.key) } });
                      }}
                      room={roomOf(s)}
                      onEnd={(x, action) => setConfirm({ kind: "room", x, action })}
                      onDelete={() => setConfirm({ kind: "omp", s })}
                    />
                  );
                  return (
                    <li key={g.key} {...dnd("g", g.key, "", groupDrag)} className={cn(drag?.key === g.key && "opacity-50", gl === "above" && "shadow-[inset_0_2px_0_var(--primary)]", gl === "below" && "shadow-[inset_0_-2px_0_var(--primary)]")}>
                      <div className="group/row flex h-7 items-center gap-0.5 pr-0.5 max-md:h-10">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                          aria-expanded={!folded}
                          aria-controls={listId}
                          title={g.root ?? g.label}
                          onClick={() => toggleCollapsed(`g:${g.key}`)}
                        >
                          <span className="truncate">{g.label}</span>
                          <ChevronDownIcon className={cn("size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", folded && "-rotate-90")} aria-hidden />
                          {folded && g.sessions.length > 0 && <span className="text-[11px] font-normal text-muted-foreground tabular">{g.sessions.length}</span>}
                        </button>
                        <span className={HOVER}>{sortMenu(g)}</span>
                        {g.root && (
                          <button type="button" className={ICON_BTN} aria-label={`Phiên mới trong ${g.label}`} title={`Phiên mới trong ${g.label}`} onClick={() => onNew(g.root)}>
                            <PlusIcon className="size-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                      <ul id={listId} hidden={folded} className="space-y-px">
                        {b
                          ? b.sections.map((sec) =>
                              sec.spot ? (
                                <li key={sec.key}>
                                  <BranchHeader
                                    spot={sec.spot}
                                    count={sec.sessions.length}
                                    onOverview={sec.spot.main ? null : () => onOpenRepo(sec.spot!.path, sec.spot!.name)}
                                    onDelete={
                                      !sec.spot.main && worktrees.worktrees.includes(sec.spot.key)
                                        ? () => setConfirm({ kind: "worktree", g: groupOf({ key: sec.spot!.key, label: sec.spot!.name, root: sec.spot!.path, sessions: [] })! })
                                        : null
                                    }
                                  />
                                  <ul className="space-y-px" aria-label={`Phiên trên branch ${sec.spot.label}`}>
                                    {sec.sessions.map(sessionRow)}
                                  </ul>
                                </li>
                              ) : (
                                <Fragment key={sec.key}>{sec.sessions.map(sessionRow)}</Fragment>
                              ),
                            )
                          : g.sessions.map(sessionRow)}
                        {b && b.idle.length > 0 && (
                          <IdleWorktrees id={`${listId}-idle`} spots={b.idle} open={idleOpen} onToggle={() => toggleCollapsed(`w:${g.key}`)} onOpen={(sp) => onOpenRepo(sp.path, sp.name)} />
                        )}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
            <KnownProjects items={knownRest} hq={hq} onOpen={onOpenFolder} />
            {(stored.length > 0 || hidden.length > 0) && (
              <button type="button" className={cn(row, "mt-3 h-7 text-xs text-muted-foreground max-md:h-10")} onClick={() => setArchived(true)}>
                <ArchiveIcon className="size-3.5" aria-hidden />
                <span className="flex-1">Đã lưu trữ</span>
                <span className="tabular">{stored.length + hidden.length}</span>
              </button>
            )}
          </>
        )}
      </div>

      <Account onAddProject={onAddProject} onHelp={onHelp} onSettings={() => onTab("may")} settingsCurrent={tab === "may"} />

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
      {confirm?.kind === "omp" && (
        <OmpDeleteDialog
          hq={hq}
          s={confirm.s}
          onCancel={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            refresh();
          }}
        />
      )}
      {confirm?.kind === "project" && (
        <ProjectDeleteDialog
          hq={hq}
          g={confirm.g}
          roomOf={roomOf}
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
          onHidden={(r) => {
            setOverlay({ at: data?.at ?? 0, key: confirm.g.key, row: r });
            setConfirm(null);
            refresh();
          }}
        />
      )}
    </nav>
  );
}

/** "Nhóm & sắp xếp" (persisted in this browser), plus the project's own actions on a project heading. */
function GroupMenu({
  label,
  group,
  sort,
  onGroup,
  onSort,
  project,
}: {
  label: string;
  group: GroupBy;
  sort: SortBy;
  onGroup: (g: GroupBy) => void;
  onSort: (s: SortBy) => void;
  project: { onOverview: () => void; worktree: boolean; onHide: () => void; onDelete: () => void; onDeleteAll: () => void } | null;
}) {
  return (
    // Non-modal: an item opens a dialog, and a modal menu would hand focus back over it.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={ICON_BTN} aria-label={`Nhóm & sắp xếp: ${label}`} title="Nhóm & sắp xếp">
        <EllipsisIcon className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Nhóm theo</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={group} onValueChange={(v) => onGroup(v as GroupBy)}>
          {(Object.keys(GROUP_WORD) as GroupBy[]).map((g) => (
            <DropdownMenuRadioItem key={g} value={g} className="max-md:min-h-10">
              {GROUP_WORD[g]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Sắp xếp</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onSort(v as SortBy)}>
          {(Object.keys(SORT_WORD) as SortBy[]).map((s) => (
            <DropdownMenuRadioItem key={s} value={s} className="max-md:min-h-10">
              {SORT_WORD[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {project && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="max-md:min-h-10" onSelect={project.onOverview}>
              <LayoutDashboardIcon aria-hidden /> Tổng quan dự án
            </DropdownMenuItem>
            <DropdownMenuItem className="max-md:min-h-10" onSelect={project.onHide}>
              <EyeOffIcon aria-hidden /> Ẩn dự án…
            </DropdownMenuItem>
            {project.worktree && (
              <DropdownMenuItem className="max-md:min-h-10" variant="destructive" onSelect={project.onDelete}>
                <Trash2Icon aria-hidden /> Xóa worktree…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="max-md:min-h-10" variant="destructive" onSelect={project.onDeleteAll}>
              <Trash2Icon aria-hidden /> Xóa mọi phiên…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The running spinner: the palette's running green, thicker strokes, a soft neon glow on dark. */
function RunSpinner({ className, label }: { className: string; label?: string }) {
  return (
    <LoaderIcon
      strokeWidth={2.5}
      className={cn("shrink-0 text-st-running motion-safe:animate-spin motion-safe:[animation-duration:1.6s] dark:drop-shadow-[0_0_3px_var(--st-running)]", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}

/** What a row says without colour alone: a spinner while working, the blue dot, ⚠ on error. */
function Mark({ state, unread }: { state: TreeSession["state"]; unread: boolean }) {
  if (state === "error") return <AlertTriangleIcon className="size-3.5 shrink-0 text-warning" aria-label={TREE_WORD.error} />;
  if (unread) return <span className="size-2 shrink-0 rounded-full bg-st-unread" role="img" aria-label={state === "needs" ? TREE_WORD.needs : "Xong, chưa xem"} />;
  if (state === "working") return <RunSpinner className="size-3.5" label={TREE_WORD.working} />;
  return null;
}

/** "chính": the repo's main worktree (a word, not a colour). */
function MainBadge() {
  return <span className="shrink-0 rounded border border-sidebar-border px-1 text-[10px] leading-4 font-normal text-muted-foreground">chính</span>;
}

/**
 * A branch over its sessions (Orca's layout): the branch, the worktree folder when its name says
 * something else, "chính" on the main worktree, the session count. A linked worktree's "⋯" opens its
 * Tổng quan and, when HQ may remove it, "Xóa worktree" (it is no project of its own any more).
 */
function BranchHeader({ spot, count, onOverview, onDelete }: { spot: WorktreeSpot; count: number; onOverview: (() => void) | null; onDelete: (() => void) | null }) {
  const note = folderNote(spot);
  const tip = [`branch ${spot.label}`, spot.path, spot.main ? "Worktree chính của repo" : "Worktree phụ (git worktree)", spot.locked ? "Đang khóa (git worktree lock)" : null].filter(Boolean).join("\n");
  return (
    <div className="group/row flex h-7 min-w-0 items-center gap-1.5 pr-0.5 pl-2 text-xs text-muted-foreground max-md:h-10" title={tip}>
      <GitBranchIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate font-medium text-sidebar-foreground/80">{spot.label}</span>
      {note && <span className="min-w-0 shrink-[2] truncate">· {note}</span>}
      {spot.main && <MainBadge />}
      {spot.locked && <span className="shrink-0 text-[11px]">· đang khóa</span>}
      <span className="ml-auto shrink-0 pl-1 text-[11px] tabular" aria-label={`${count} phiên`}>
        {count}
      </span>
      {onOverview && (
        <span className={HOVER}>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger className={ICON_BTN} aria-label={`Thao tác với worktree ${spot.name}`} title="Thao tác với worktree">
              <EllipsisIcon className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="max-md:min-h-10" onSelect={onOverview}>
                <LayoutDashboardIcon aria-hidden /> Tổng quan worktree
              </DropdownMenuItem>
              {onDelete && (
                <DropdownMenuItem className="max-md:min-h-10" variant="destructive" onSelect={onDelete}>
                  <Trash2Icon aria-hidden /> Xóa worktree…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
    </div>
  );
}

/** The repo's worktrees with no session, folded behind one row; each opens that worktree's Tổng quan. */
function IdleWorktrees({ id, spots, open, onToggle, onOpen }: { id: string; spots: WorktreeSpot[]; open: boolean; onToggle: () => void; onOpen: (s: WorktreeSpot) => void }) {
  return (
    <li>
      <button type="button" className={cn(row, "h-7 text-xs text-muted-foreground max-md:h-10")} aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <ChevronDownIcon className={cn("size-3 shrink-0 transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden />
        <span className="truncate">
          <span className="tabular">{spots.length}</span> worktree không có phiên
        </span>
      </button>
      <ul id={id} hidden={!open} className="space-y-px">
        {spots.map((sp) => {
          const note = folderNote(sp);
          return (
            <li key={sp.key}>
              <button type="button" className={cn(row, "h-7 text-xs text-muted-foreground max-md:h-10")} title={`Mở Tổng quan của worktree\nbranch ${sp.label}\n${sp.path}`} onClick={() => onOpen(sp)}>
                <GitBranchIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="min-w-0 truncate">{sp.label}</span>
                {note && <span className="min-w-0 shrink-[2] truncate opacity-80">· {note}</span>}
                {sp.main && <MainBadge />}
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/**
 * One session: the plain title (ellipsis), a ▾ after it when it has sub-sessions, and at the right
 * the sub-session count, the mark and how long ago (the "⋯" menu takes their place on hover). Its
 * sub-sessions hang under it on a └ line: running and recent ones, the rest behind "+N cũ hơn".
 * `branch`: the session's git branch, shown on the row when no branch header above carries it.
 */
function SessionRow({
  dnd,
  dragging,
  landing,
  s,
  branch,
  now,
  current,
  unread,
  folded,
  onFold,
  onOpen,
  onChat,
  onArchive,
  room,
  onEnd,
  onDelete,
}: {
  /** Drag & drop handlers from the Nav (the row is draggable inside its group). */
  dnd: object;
  dragging: boolean;
  landing: "above" | "below" | null;
  s: TreeSession;
  branch: string | null;
  now: number;
  current: boolean;
  unread: boolean;
  folded: boolean;
  onFold: () => void;
  onOpen: (s: TreeSession, split: boolean) => void;
  onChat: () => void;
  onArchive: () => void;
  room: SidebarRoom<Room> | null;
  onEnd: (x: SidebarRoom<Room>, action: "close" | "delete") => void;
  onDelete: () => void;
}) {
  const [more, setMore] = useState(false);
  const { shown, older } = useMemo(() => splitChildren(s.children, now), [s.children, now]);
  const kids = more ? [...shown, ...older] : shown;
  const hasKids = s.children.length > 0;
  const click = (e: MouseEvent) => onOpen(s, e.altKey);
  const tip = [s.title !== s.name ? `${s.title} (${s.name})` : s.title, TREE_WORD[s.state], s.doing, branch && `branch ${branch}`, s.cwd, s.ompId ? "Alt+click: mở cạnh nhau" : null]
    .filter(Boolean)
    .join("\n");
  const kidsId = `kids-${s.key.replace(/[^\w-]/g, "_")}`;
  return (
    <li {...dnd} className={cn("rounded-md", dragging && "opacity-50", landing === "above" && "shadow-[inset_0_2px_0_var(--primary)]", landing === "below" && "shadow-[inset_0_-2px_0_var(--primary)]")}>
      <div className={cn("group/row relative flex h-7 items-center rounded-md transition-colors hover:bg-sidebar-accent max-md:h-10 motion-reduce:transition-none", current && "bg-sidebar-accent")}>
        <button type="button" className="flex h-full min-w-0 shrink items-center rounded-md pl-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-current={current} title={tip} onClick={click}>
          <span className={cn("truncate", current && "font-medium")}>{s.title}</span>
          {branch && (
            <span className="ml-1.5 inline-flex max-w-28 min-w-0 shrink-[0.5] items-center gap-0.5 text-[11px] text-muted-foreground">
              <GitBranchIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{branch}</span>
            </span>
          )}
          <span className="sr-only">
            {" "}
            · {unread && s.state !== "needs" ? "xong, chưa xem" : TREE_WORD[s.state]}
          </span>
        </button>
        {hasKids && (
          <button type="button" className="ml-0.5 grid size-5 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:size-8" aria-expanded={!folded} aria-controls={kidsId} aria-label={`${folded ? "Mở" : "Thu gọn"} ${s.children.length} phiên con`} onClick={onFold}>
            <ChevronDownIcon className={cn("size-3 transition-transform motion-reduce:transition-none", folded && "-rotate-90")} aria-hidden />
          </button>
        )}
        {/* The rest of the row opens the session too (a mouse target only; the title is the button). */}
        <span className="h-full min-w-2 flex-1 cursor-pointer" aria-hidden onClick={click} />
        <span className="flex shrink-0 items-center gap-1.5 pr-2 group-focus-within/row:hidden group-hover/row:hidden max-md:hidden [@media(hover:none)]:hidden">
          {hasKids && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground tabular" title={`${s.children.length} phiên con`}>
              <GitBranchIcon className="size-3 rotate-90" aria-hidden />
              {s.children.length}
            </span>
          )}
          <Mark state={s.state} unread={unread} />
          {s.state !== "working" && s.at != null && now > 0 && <span className="text-[11px] text-muted-foreground tabular">{agoShort(s.at, now)}</span>}
        </span>
        <span className="hidden shrink-0 items-center pr-0.5 group-focus-within/row:flex group-hover/row:flex max-md:flex [@media(hover:none)]:flex">
          <span className="mr-1 md:hidden">
            <Mark state={s.state} unread={unread} />
          </span>
          <RowMenu s={s} onOpen={onOpen} onChat={room ? onChat : null} onArchive={onArchive} room={room} onEnd={onEnd} onDelete={onDelete} />
        </span>
      </div>
      {hasKids && !folded && (
        <ul id={kidsId} className="mb-0.5 ml-3" aria-label={`Phiên con của ${s.title}`}>
          {kids.map((c, i) => (
            <ChildRow key={c.key} c={c} last={i === kids.length - 1 && older.length === 0} now={now} onOpen={() => onOpen(s, false)} />
          ))}
          {older.length > 0 && (
            <li className="relative pl-4">
              <span aria-hidden className="absolute top-0 left-0 h-1/2 w-3 rounded-bl border-b border-l border-sidebar-border" />
              <button type="button" className="h-6 rounded px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-9" aria-expanded={more} onClick={() => setMore((m) => !m)}>
                {more ? "Thu gọn" : `+${older.length} cũ hơn`}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** A sub-session on its └ connector: name, state glyph, when. Opens its parent session. */
function ChildRow({ c, last, now, onOpen }: { c: TreeChild; last: boolean; now: number; onOpen: () => void }) {
  return (
    <li className="relative pl-4">
      {/* └ for the last one, ├ (a line running on) for the others. */}
      <span aria-hidden className={cn("absolute top-0 left-0 w-px bg-sidebar-border", last ? "h-1/2" : "h-full")} />
      <span aria-hidden className="absolute top-1/2 left-0 h-px w-3 bg-sidebar-border" />
      <button
        type="button"
        className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-9"
        title={[c.title, TREE_WORD[c.state], c.detail].filter(Boolean).join("\n")}
        onClick={onOpen}
      >
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
        <span className="sr-only"> · {TREE_WORD[c.state]}</span>
        {c.state === "working" ? (
          <RunSpinner className="size-3" />
        ) : c.state === "error" ? (
          <AlertTriangleIcon className="size-3 shrink-0 text-warning" aria-hidden />
        ) : c.state === "done" ? (
          <CheckIcon className="size-3 shrink-0" aria-hidden />
        ) : null}
        {c.state !== "working" && c.at != null && now > 0 && <span className="shrink-0 text-[10px] tabular">{agoShort(c.at, now)}</span>}
      </button>
    </li>
  );
}

function RowMenu({
  s,
  onOpen,
  onChat,
  onArchive,
  room,
  onEnd,
  onDelete,
}: {
  s: TreeSession;
  onOpen: (s: TreeSession, split: boolean) => void;
  onChat: (() => void) | null;
  onArchive: () => void;
  room: SidebarRoom<Room> | null;
  onEnd: (x: SidebarRoom<Room>, action: "close" | "delete") => void;
  onDelete: () => void;
}) {
  const ccc = room && room.room.engine !== "omp";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={ICON_BTN} aria-label={`Thao tác với phiên ${s.title}`}>
        <EllipsisIcon className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {s.ompId && (
          <DropdownMenuItem className="max-md:min-h-10" onSelect={() => onOpen(s, true)}>
            <ColumnsIcon aria-hidden /> Mở cạnh nhau
            <span className="ml-auto text-xs text-muted-foreground">Alt+click</span>
          </DropdownMenuItem>
        )}
        {onChat && (
          <DropdownMenuItem className="max-md:min-h-10" onSelect={onChat}>
            <MessageSquareIcon aria-hidden /> Chat phòng
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="max-md:min-h-10" onSelect={onArchive}>
          <ArchiveIcon aria-hidden />
          <span className="flex flex-col">
            Lưu trữ
            <span className="text-xs text-muted-foreground">Ẩn khỏi danh sách, không dừng hay xoá gì</span>
          </span>
        </DropdownMenuItem>
        {ccc && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="max-md:min-h-10" onSelect={() => onEnd(room, "close")}>
              <PowerIcon aria-hidden /> Đóng phòng…
            </DropdownMenuItem>
            <DropdownMenuItem className="max-md:min-h-10" variant="destructive" onSelect={() => onEnd(room, "delete")}>
              <Trash2Icon aria-hidden /> Xóa phòng…
            </DropdownMenuItem>
          </>
        )}
        {!ccc && s.ompId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="max-md:min-h-10" variant="destructive" onSelect={onDelete}>
              <Trash2Icon aria-hidden /> Xóa phiên…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Đã lưu trữ": sessions put away in this browser (Bỏ lưu trữ) and projects hidden in HQ (Hiện lại). */
function ArchiveView({
  sessions,
  hidden,
  showing,
  now,
  onBack,
  onRestore,
  onShow,
  onOpen,
}: {
  sessions: TreeSession[];
  hidden: HiddenProject[];
  showing: string | null;
  now: number;
  onBack: () => void;
  onRestore: (key: string) => void;
  onShow: (h: HiddenProject) => void;
  onOpen: (s: TreeSession) => void;
}) {
  return (
    <section aria-labelledby="archived-h">
      <div className="flex h-7 items-center gap-1 pl-0.5">
        <button type="button" className={ICON_BTN} aria-label="Quay lại danh sách phiên" onClick={onBack}>
          <ArrowLeftIcon className="size-3.5" aria-hidden />
        </button>
        <h2 id="archived-h" className="text-xs font-medium text-muted-foreground">
          Đã lưu trữ
        </h2>
      </div>
      <p className="px-2 pb-2 text-[11px] leading-relaxed text-pretty text-muted-foreground">Chỉ ẩn trong HQ trên trình duyệt này. Không có gì bị xoá trên máy.</p>
      {sessions.length === 0 && hidden.length === 0 && <p className="px-2 text-xs text-muted-foreground">Trống.</p>}
      <ul className="space-y-px">
        {sessions.map((s) => (
          <li key={s.key} className="group/row flex h-7 items-center rounded-md hover:bg-sidebar-accent max-md:h-10">
            <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60" title={`${s.folder} · ${s.name}`} onClick={() => onOpen(s)}>
              <span className="truncate">{s.title}</span>
              <span className="ml-auto shrink-0 text-[11px] tabular">{now > 0 && agoShort(s.at, now)}</span>
            </button>
            <button type="button" className={ICON_BTN} aria-label={`Bỏ lưu trữ ${s.title}`} title="Bỏ lưu trữ" onClick={() => onRestore(s.key)}>
              <ArchiveRestoreIcon className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <>
          <h3 className="mt-3 px-2 pb-1 text-xs font-medium text-muted-foreground">Dự án đã ẩn</h3>
          <ul className="space-y-px">
            {hidden.map((h) => (
              <li key={h.key} className="flex h-7 items-center gap-1.5 pl-2 max-md:h-10">
                <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" title={h.root}>
                  {h.name}
                </span>
                <Button size="xs" variant="ghost" className="max-md:h-10" onClick={() => onShow(h)} disabled={showing === h.key} aria-label={`Hiện lại dự án ${h.name}`}>
                  <EyeIcon />
                  {showing === h.key ? "Đang hiện…" : "Hiện lại"}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Bottom: the account (theme, add a project, help) and the settings gear (the Máy tab). */
function Account({ onAddProject, onHelp, onSettings, settingsCurrent }: { onAddProject: () => void; onHelp: () => void; onSettings: () => void; settingsCurrent: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // The theme is only known in the browser.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const dark = mounted && (theme === "system" ? resolvedTheme : theme) === "dark";
  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border p-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className={cn(row, "h-9 flex-1 gap-2 max-md:h-11")}>
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background">
            A
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{ACCOUNT}</span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuItem className="max-md:min-h-10" onSelect={onAddProject}>
            <FolderPlusIcon aria-hidden /> Thêm dự án…
          </DropdownMenuItem>
          <DropdownMenuItem className="max-md:min-h-10" disabled={!mounted} onSelect={() => setTheme(dark ? "light" : "dark")}>
            {dark ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />} {dark ? "Giao diện sáng" : "Giao diện tối"}
          </DropdownMenuItem>
          <DropdownMenuItem className="max-md:min-h-10" onSelect={onHelp}>
            <CircleHelpIcon aria-hidden /> Cách dùng HQ
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" className={cn(ICON_BTN, "size-8 max-md:size-11", settingsCurrent && "bg-sidebar-accent text-foreground")} aria-label="Cài đặt máy" aria-current={settingsCurrent} title="Cài đặt máy" onClick={onSettings}>
        <SettingsIcon className="size-4" aria-hidden />
      </button>
    </div>
  );
}

const noop = () => () => {};

function LiveDot({ live }: { live: Live }) {
  const label = live === "live" ? "Live" : live === "polling" ? "Cập nhật 3 giây/lần" : live === "connecting" ? "Đang kết nối" : "Đang nối lại";
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <span aria-hidden className={cn("size-1.5 rounded-full", live === "live" || live === "polling" ? "bg-st-running" : "bg-st-needs motion-safe:animate-pulse")} />
      {label}
    </span>
  );
}

/** "+ Dự án": one dialog. A folder that exists is added; one that does not is created (with git). */
export function AddProjectDialog({ hq, open, onOpenChange, onAdded }: { hq: Hq; open: boolean; onOpenChange: (o: boolean) => void; onAdded: (id: number, p?: { path: string; name: string }) => void }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onOpenChange(false);
      setPath("");
      onAdded(r.project.id, r.project);
      const name = r.project.name;
      toast.success(created ? `Đã tạo ${name}` : r.existed ? `${name} đã có trong HQ` : `Đã thêm ${name}`, { description: "Bấm + cạnh tên dự án để mở phiên đầu tiên." });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      void hq.reload.sessions();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Dự án</DialogTitle>
            <DialogDescription>Thư mục chưa có thì HQ tạo mới (kèm git).</DialogDescription>
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Thôi
            </Button>
            <Button type="submit" disabled={busy || !path.trim()}>
              <FolderPlusIcon aria-hidden /> {busy ? "Đang làm…" : "Thêm dự án"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Dự án trên máy" (owner 2026-10-22): repos 8sync has seen on this machine but the owner never added
 * to HQ. One tap adds the folder and opens it.
 */
function KnownProjects({ items, hq, onOpen }: { items: KnownProject[]; hq: Hq; onOpen: (id: number, p?: { path: string; name: string }) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return null;
  async function add(k: KnownProject) {
    setBusy(k.path);
    try {
      const r = await hq.api<{ project: Project; existed?: boolean }>("/api/projects", { method: "POST", body: { path: k.path } });
      await hq.reload.projects();
      toast.success(`Đã thêm ${r.project.name}`);
      onOpen(r.project.id, r.project);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    // Every repo on the machine can be dozens: folded by default so the sessions stay on screen.
    <details className="group/known mt-3">
      <summary
        id="known-projects"
        className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-10"
        title="Repo trên máy này: Claude Code đã tin, 8sync đã chạy, hoặc tìm thấy cạnh các repo đó. Bấm một repo để thêm vào HQ."
      >
        <ChevronDownIcon className="size-3 -rotate-90 transition-transform group-open/known:rotate-0 motion-reduce:transition-none" aria-hidden />
        Dự án trên máy · {items.length}
      </summary>
      <ul className="space-y-px" aria-labelledby="known-projects">
        {items.map((k) => (
          <Fragment key={k.path}>
            <li>
              <button type="button" className={cn(row, "h-7 max-md:h-10")} disabled={busy === k.path} title={`${k.path} (${k.source}): thêm vào HQ`} onClick={() => void add(k)}>
                <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{k.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{busy === k.path ? "…" : "Thêm"}</span>
              </button>
            </li>
          </Fragment>
        ))}
      </ul>
    </details>
  );
}

/** What a pane or the room chat is scoped to (hq-app). */
export type Scope = { project: number | null; session: string | null };
