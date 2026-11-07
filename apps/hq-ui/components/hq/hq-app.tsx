"use client";

import { roomNameOf, sessionLabel } from "@/lib/labels";
import { roomNow } from "@/lib/now";
import { limitsView, matchesSession } from "@/lib/office";
import { CircleHelpIcon, SquareTerminalIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNarrow } from "@/hooks/use-narrow";
import { useIsMobile } from "@/hooks/use-mobile";
import { botStatus, botSummary, openBotKey } from "@/lib/bots";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { shortName, StatusDot } from "./bits";
import { FirstRun } from "./first-run";
import type { LoopsState } from "./loops-view";
import { Guide, useGuideFirstRun } from "./guide";
import { AddProjectDialog, SessionTreeView, type Scope } from "./nav";
import { useArchive, useSessionTree, useTreeOrder, useTreePrefs } from "./use-session-tree";
import { COMPOSER_ID, useWorkspace, workspace } from "./workspace-store";
import { cycleKey, groupSessions, type TreeSession } from "@/lib/session-tree";
import { RoomBar, RoomBrief } from "./room-brief";
import { RoomLogProvider } from "./room-outputs";
import { RoomReport } from "./room-report";
import { FilesPane, filesRootOf } from "./files-sheet";
import { PathOpenProvider } from "./path-open";
import type { PreviewState } from "./preview-view";
import { FloatShell } from "./float-shell";
import { TerminalDrawer } from "./terminal-drawer";
import { WebTerminalSheet } from "./web-terminal-sheet";
import { WorkspaceView } from "./workspace-view";
import { useHq } from "./use-hq";
import { useReloadOnNewUi } from "./use-ui-version";
import { useOffice, type Room } from "./use-office";
import { usePoll } from "./use-poll";
import { MachineChip, type MachineView as MachineData } from "./machine-chip";
import { PinnedAsks } from "./pinned-asks";
import { rootKey } from "@/lib/preview";
import { ARTIFACT_PARAM } from "@/lib/artifacts";
import { moreTabs, viewHeader, type MoreTab, type NavItem } from "@/lib/tabs";
import { botRepo } from "@/lib/roster";
import { groupKey } from "@/lib/sidebar";
import { BottomTabs } from "./bottom-tabs";
import { BotHistory } from "./bots/bot-history";
import type { BotViews } from "./bots/bot-thread";
import { NewGroupDialog } from "./bots/groups-section";
import { NewBotSheet } from "./bots/new-bot-sheet";
import { useRoster } from "./bots/use-roster";
import { GroupsPage } from "./groups-page";
import { SearchView } from "./search-view";
import { Sidebar } from "./sidebar";
import type { Session } from "./types";

/** A view's chunk on its way: the shape of a page (title, two rows), not a spinner. */
function ViewLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-6 sm:px-6" aria-busy="true" aria-label="Đang tải">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
// Every tab but the first screen loads its own chunk on first open (Radix unmounts hidden tabs, so they also stop working).
const OverviewView = dynamic(() => import("./overview-view").then((m) => m.OverviewView), { loading: ViewLoading });
// Client only: it reads the screen width (a bot's page beside Nhật ký from 1280 px).
const BotsView = dynamic(() => import("./bots/bots-view").then((m) => m.BotsView), { ssr: false, loading: ViewLoading });
const OfficeView = dynamic(() => import("./office-view").then((m) => m.OfficeView), { loading: ViewLoading });
const TeamThread = dynamic(() => import("./team-thread").then((m) => m.TeamThread), { loading: ViewLoading });
const TeamView = dynamic(() => import("./team-view").then((m) => m.TeamView), { loading: ViewLoading });
const PreviewView = dynamic(() => import("./preview-view").then((m) => m.PreviewView), { loading: ViewLoading });
const ReportView = dynamic(() => import("./report-view").then((m) => m.ReportView), { loading: ViewLoading });
const UsageView = dynamic(() => import("./usage-view").then((m) => m.UsageView), { loading: ViewLoading });
const MachineView = dynamic(() => import("./machine-view").then((m) => m.MachineView), { loading: ViewLoading });
const KnowView = dynamic(() => import("./know-view").then((m) => m.KnowView), { loading: ViewLoading });
const LoopsView = dynamic(() => import("./loops-view").then((m) => m.LoopsView), { loading: ViewLoading });
const SessionsView = dynamic(() => import("./sessions-view").then((m) => m.SessionsView), { loading: ViewLoading });
const ActivityView = dynamic(() => import("./activity-view").then((m) => m.ActivityView), { loading: ViewLoading });
const ContentView = dynamic(() => import("./content-view").then((m) => m.ContentView), { loading: ViewLoading });
const ArtifactsView = dynamic(() => import("./artifacts-view").then((m) => m.ArtifactsView), { loading: ViewLoading });
const CodemapView = dynamic(() => import("./codemap-view").then((m) => m.CodemapView), { loading: ViewLoading });

/** bots: a bot's page · groups: a group's thread · search: Tìm · tree: every session by project · workspace: folders → omp sessions → windows · office: every session is a room · group: all rooms talking · room: one room's chat · may: this machine · usage: plan limits and tokens · artifacts: files rooms posted. */
type Tab = "bots" | "groups" | "search" | "tree" | "workspace" | "overview" | "office" | "group" | "room" | "preview" | "artifacts" | "codemap" | "loops" | "report" | "usage" | "may" | "know" | "content" | "sessions" | "activity";
const PREVIEW_POLL_MS = 15_000;
const LOOPS_POLL_MS = 30_000;
/** The header chip and the Máy tab share one poll. */
const MACHINE_POLL_MS = 5_000;
/** Scope by any name a session goes by: hq name, Claude session id, or its label. */
const isScoped = (s: Session, key: string | null) => matchesSession({ ...s, label: sessionLabel(s) }, key);
const SESSION_NAME_INPUT = "start-session-name";
/** A history entry while a phone shows a bot or a group full screen: the system Back returns to the list. */
const HISTORY_KEY = "hqBot";

export function HqApp({ token, ui }: { token: string; ui: string | null }) {
  const hq = useHq(token);
  useReloadOnNewUi(token, ui);
  const office = useOffice(token);
  const [scope, setScope] = useState<Scope>({ project: null, session: null });
  // The repo the owner opened from the sidebar: Tổng quan shows that project's block only.
  const [repo, setRepo] = useState<{ root: string; name: string } | null>(null);
  // null until the owner picks a tab: Bots is the first screen on every width (owner 2026-11-07, "giống Grok Bot").
  const [picked, setTab] = useState<Tab | null>(null);
  const narrow = useNarrow();
  const mobile = useIsMobile();
  const tab: Tab = picked ?? "bots";
  // The bot picked in Bots (a room key) and the group in Nhóm; a phone shows either full screen, without
  // HQ's header or bottom bar.
  const [bot, setBot] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  // "Bot mới" open, with the template an empty-state card picked; "Nhóm mới" open.
  const [newBot, setNewBot] = useState<{ template: string | null } | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  // The session whose live terminal is open in the right drawer (hq-* tmux sessions only).
  const [drawer, setDrawer] = useState<string | null>(null);
  const [firstGuide, dismissGuide] = useGuideFirstRun();
  const ws = useWorkspace();
  const { prefs } = useTreePrefs();
  const { order: treeOrder } = useTreeOrder();
  const archive = useArchive();
  const previews = usePoll<{ projects: NonNullable<PreviewState["data"]>["projects"] }>(hq.api, "/api/preview", PREVIEW_POLL_MS, tab === "preview" || tab === "overview");
  const machine = usePoll<MachineData>(hq.api, "/api/machine", MACHINE_POLL_MS, true);
  const openMachine = useCallback(() => setTab("may"), []);
  const loops = usePoll<NonNullable<LoopsState["data"]>>(hq.api, "/api/loops", LOOPS_POLL_MS, tab === "loops");
  // "Nội dung" exists only while a content DB is configured: asked once per load. A shared calendar
  // link (`?day=` / `?item=`) lands on that tab.
  const [contentOn, setContentOn] = useState(false);
  const { api } = hq;
  useEffect(() => {
    const ac = new AbortController();
    api<{ configured: boolean }>("/api/content?probe=1", { signal: ac.signal })
      .then((r) => {
        setContentOn(r.configured);
        if (r.configured && /[?&](day|item)=/.test(window.location.search)) setTab("content");
      })
      .catch(() => {});
    return () => ac.abort();
  }, [api]);

  const [guideOpen, setGuideOpen] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const onScope = useCallback((s: Scope) => {
    setScope(s);
    setRepo(null);
    if (s.session?.startsWith("hq-")) setTarget(s.session);
  }, []);

  // Everything below the header is filtered to the selected project or session.
  // `group` ignores the session scope on purpose: Chat tổng is every room talking.
  const scopeOf = useCallback(
    (session: string | null) => {
      const all = hq.sessions.data;
      const sessions =
        session != null
          ? all.filter((s) => isScoped(s, session))
          : scope.project != null
            ? all.filter((s) => s.project_id === scope.project)
            : all;
      const names = new Set(sessions.flatMap((s) => [s.name, s.session_id].filter(Boolean) as string[]));
      const scoped = scope.project != null || session != null;
      const inScope = (...xs: (string | null)[]) => !scoped || xs.some((x) => x != null && names.has(x));
      return {
        sessions,
        messages: hq.messages.data.filter((m) => inScope(m.session, m.from_, m.to_)),
      };
    },
    [hq.sessions.data, hq.messages.data, scope.project],
  );
  const view = useMemo(() => scopeOf(scope.session), [scopeOf, scope.session]);
  const group = useMemo(() => scopeOf(null), [scopeOf]);

  const project = hq.projects.data.find((p) => p.id === scope.project);
  // Projects come from each session's git folder, not only the folders registered in the sidebar.
  const officeRooms = office.office?.rooms ?? [];
  // Projects with a live room, one entry each: what the Tri thức tab lets the owner pick.
  const knowRoots = useMemo(() => {
    const seen = new Map<string, { root: string; name: string }>();
    for (const r of office.office?.rooms ?? []) if (r.project && r.status !== "ended" && !seen.has(rootKey(r.project.root))) seen.set(rootKey(r.project.root), { root: r.project.root, name: r.project.name });
    return [...seen.values()];
  }, [office.office?.rooms]);
  // Không gian's picker: repos with a live room, then the added folders, then "Dự án trên máy" (deduped there).
  const wsProjects = useMemo(
    () => [
      ...knowRoots.map((r) => ({ path: r.root, name: r.name })),
      ...hq.projects.data.filter((p) => !p.missing).map((p) => ({ path: p.path, name: p.name })),
      ...hq.knownProjects.map((k) => ({ path: k.path, name: k.name })),
    ],
    [knowRoots, hq.projects.data, hq.knownProjects],
  );
  const officeSummary = office.office
    ? `${new Set(officeRooms.map((r) => r.project?.root ?? r.cwd)).size} dự án · ${officeRooms.length} phòng`
    : "";
  const scoped = scope.session ? hq.sessions.data.find((x) => isScoped(x, scope.session)) : undefined;
  // The room Chat phòng is about: its office row (doing, ask) feeds the brief above the timeline.
  const room = scope.session ? officeRooms.find((r) => matchesSession(r, scope.session) || (scoped != null && (r.name === scoped.name || (scoped.session_id != null && r.session_id === scoped.session_id)))) : undefined;
  // The session on screen: the active window in Không gian, the room in Chat phòng. It reads as
  // current in the sidebar and never collects a blue dot.
  const viewKey = tab === "workspace" ? (ws.composer ? null : ws.ws.active) : tab === "room" ? (room?.key ?? null) : null;
  const tree = useSessionTree(hq, office, viewKey);
  const roster = useRoster(hq, office, tree.sessions);
  // The open bot by key (lib/bots openBotKey): the pick, else the one HQ opened by itself, which keeps the
  // page while other rooms re-sort above it. A wider screen opens the roster's top bot when none is held.
  const liveBots = useMemo(() => roster.all.map((b) => b.key), [roster.all]);
  const [held, setHeld] = useState<string | null>(null);
  const openKey = openBotKey(liveBots, roster.sections[0]?.bots[0]?.key ?? null, bot, held, !mobile);
  // Adjusting state while rendering (react.dev "storing information from previous renders"): no extra
  // commit with the wrong bot. A null (rooms not loaded yet, a phone) keeps the last one held.
  if (openKey != null && openKey !== held) setHeld(openKey);
  const fullScreen = mobile && ((tab === "bots" && openKey != null) || (tab === "groups" && roster.groups.some((g) => g.id === groupId)));
  // An omp session's sidebar row is keyed by its omp id, not its room's key: its Chat phòng lights that row.
  const activeKey =
    tab === "room" && room
      ? (tree.sessions.find((s) => s.room === room.key)?.key ?? room.key)
      : tab === "bots" && openKey
        ? (tree.sessions.find((s) => s.room === openKey)?.key ?? openKey)
        : viewKey;
  const { unread, markSeen } = roster;
  useEffect(() => {
    if (tab === "bots" && openKey && unread.has(openKey)) markSeen(openKey);
  }, [tab, openKey, unread, markSeen]);
  // Không gian titles the window on screen (or the composer), like Claude Code Desktop.
  const pane = tab === "workspace" && !ws.composer ? ws.ws.panes.find((p) => p.id === ws.ws.active) : undefined;
  const paneSession = pane ? tree.sessions.find((s) => s.ompId === pane.id) : undefined;
  const liveRoomsNow = officeRooms.filter((r) => r.status !== "ended");
  const named = viewHeader(tab, repo?.name ?? null);
  const title =
    tab === "bots"
      ? "Bots"
      : tab === "workspace"
      ? pane
        ? (paneSession?.title ?? pane.name)
        : "Phiên mới"
      : named
        ? named.title
      : scope.session
        ? scoped
          ? sessionLabel(scoped)
          : shortName(scope.session)
        : project
          ? project.name
          : (repo?.name ?? "Tất cả phòng");
  const subtitle =
    tab === "bots"
      ? office.office
        ? botSummary(liveRoomsNow.map((r) => ({ status: botStatus(r) }))) || "Chưa có bot nào đang chạy"
        : ""
      : tab === "workspace"
      ? (pane?.cwd ?? ws.folder ?? "")
      : named
        ? named.subtitle
      : scope.session
        ? (view.sessions[0]?.cwd ?? project?.path ?? "")
        : project
          ? project.path
          : (repo?.root ?? officeSummary);
  const needsYou = view.sessions.filter((s) => s.status === "needs_input").length;
  const running = view.sessions.filter((s) => s.status !== "ended").length;
  // Plan usage (contract C1): the freshest status-line snapshot, drawn like Orca's meter.
  const limits = limitsView(office.office?.limits, office.office?.at);

  const firstRun = {
    hasProject: hq.projects.data.length > 0,
    hasSession: hq.sessions.data.some((s) => s.tmux),
    hasChannel: hq.sessions.data.some((s) => s.channel),
    orgBlocked: hq.sessions.data.some((s) => s.channel_state === "blocked-by-org"),
  };
  const loaded = !hq.projects.loading && !hq.sessions.loading;

  const drawerSession = drawer ? (hq.sessions.data.find((x) => x.name === drawer) ?? null) : null;
  /** Open the live terminal when HQ runs the session in tmux; otherwise open that room's chat. */
  const openSession = (name: string) => {
    const s = hq.sessions.data.find((x) => isScoped(x, name));
    if (s?.tmux) return setDrawer(s.name);
    onScope({ project: null, session: s?.name ?? name });
    setTab("room");
  };
  /** A room picked in the office or the report: its chat, addressed by the name the composer knows. */
  const openRoom = (r: Room) => {
    const s = hq.sessions.data.find((x) => x.name === r.name || (r.session_id != null && x.session_id === r.session_id));
    onScope({ project: null, session: s?.name ?? r.session_id ?? r.name });
    setTarget(s?.name ?? r.name);
    setTab("room");
  };
  /** A repo, from its sidebar heading: its Tổng quan. */
  const openRepo = (root: string, name: string) => {
    onScope({ project: null, session: null });
    setRepo({ root, name });
    setTab("overview");
  };
  /** A bot's page (Bots). A phone pushes a history entry so its Back returns to the list. */
  const openBot = useCallback(
    (key: string) => {
      if (mobile && window.history.state?.[HISTORY_KEY] == null) window.history.pushState({ ...window.history.state, [HISTORY_KEY]: key }, "");
      setBot(key);
      setTab("bots");
    },
    [mobile],
  );
  /** A group's thread (Nhóm). */
  const openGroup = useCallback(
    (id: string) => {
      if (mobile && window.history.state?.[HISTORY_KEY] == null) window.history.pushState({ ...window.history.state, [HISTORY_KEY]: `group:${id}` }, "");
      setGroupId(id);
      setTab("groups");
    },
    [mobile],
  );
  /** Back from a bot's page or a group: a phone returns to the list; a wider screen puts focus on the bot's row. */
  const back = () => {
    if (mobile && window.history.state?.[HISTORY_KEY] != null) window.history.back();
    else if (mobile || tab === "groups") {
      setBot(null);
      setGroupId(null);
    } else document.querySelector<HTMLElement>(`[data-bot="${CSS.escape(openKey ?? "")}"]`)?.focus();
  };
  useEffect(() => {
    const onPop = () => {
      if (window.history.state?.[HISTORY_KEY] != null) return;
      setBot(null);
      setGroupId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  /** Bots · Nhóm · Tìm, or one of Thêm's views (lib/tabs). Bots on a phone is the roster. */
  const onNav = (to: Exclude<NavItem, "more"> | MoreTab) => {
    if (to === "overview") setRepo(null);
    if (to === "bots" && mobile) setBot(null);
    if (to === "groups" && mobile) setGroupId(null);
    setTab(to);
  };
  /** Another tab, opened at one thing named in the URL (that tab reads it when it mounts). */
  const openWith = (to: Tab, params: Record<string, string | null>) => {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      if (v == null) u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    }
    window.history.replaceState(window.history.state, "", u);
    setTab(to);
  };
  /** A post a room reported: its sheet in Nội dung (`?day=&item=`, ContentView). */
  const openPost = (id: number, day: string | null) => openWith("content", { item: String(id), day });
  /** A file a room reported: shown in Kết quả. */
  const openArtifact = (id: string) => openWith("artifacts", { [ARTIFACT_PARAM]: id });
  const roomState = room ? roomNow(room, office.office?.at ?? 0) : null;
  const openTerminal = () => {
    const s = room ? hq.sessions.data.find((x) => x.name === room.name || (room.session_id != null && x.session_id === room.session_id)) : undefined;
    if (s?.tmux) setDrawer(s.name);
  };
  const liveRooms = hq.sessions.data.filter((s) => s.status !== "ended");
  const roleOf = (name: string) => hq.sessions.data.find((x) => x.name === name || x.session_id === name)?.role ?? null;
  // Chat names a room "core · su-code", not its raw "omp-c1f506dd…" id (UI audit 2026-11-07).
  const nameOf = (id: string) => roomNameOf(hq.sessions.data, id);

  const focusAddProject = () => setAddOpen(true);
  const focusStartSession = () => {
    setTab("sessions");
    setTimeout(() => document.getElementById(SESSION_NAME_INPUT)?.focus(), 60);
  };
  /** "+ Phiên mới" (Ctrl+N / Alt+N) or a group's "+": Không gian's composer, in that folder when given. */
  const newSession = useCallback((root: string | null) => {
    if (root) workspace.folder(root);
    workspace.composer(true);
    setTab("workspace");
    setTimeout(() => document.getElementById(COMPOSER_ID)?.focus(), 60);
  }, []);
  /**
   * A session from Phiên & dự án, Tìm, a bot's Lịch sử phiên or Tổng quan: a live bot opens its page; another
   * live room its Chat phòng. An omp session with no live room, or any omp session on `split`, opens in Không gian.
   */
  const openTreeSession = (s: TreeSession, split: boolean) => {
    const r = s.room ? officeRooms.find((x) => x.key === s.room) : undefined;
    if (r && !(split && s.ompId)) {
      if (liveBots.includes(r.key)) openBot(r.key);
      else openRoom(r);
    } else if (s.ompId) {
      workspace.open(token, { id: s.ompId, name: s.name, cwd: s.cwd ?? s.folder }, split);
      setTab("workspace");
    }
  };
  const openTreeRef = useRef(openTreeSession);
  useEffect(() => {
    openTreeRef.current = openTreeSession;
  });
  // The sidebar's order, for Ctrl+Tab / Alt+↓↑.
  const order = useMemo(() => groupSessions(tree.sessions.filter((s) => !archive.keys.includes(s.key)), prefs.group, prefs.sort, treeOrder).flatMap((g) => g.sessions), [tree.sessions, archive.keys, prefs.group, prefs.sort, treeOrder]);
  const activeRef = useRef(activeKey);
  const orderRef = useRef(order);
  useEffect(() => {
    activeRef.current = activeKey;
    orderRef.current = order;
  }, [activeKey, order]);
  // Claude Code Desktop's keys. Capture phase: they work inside a terminal too. A browser keeps Ctrl+N
  // and Ctrl+Tab for itself in a normal tab (they work in an installed app), so Alt+N and Alt+↓/↑ always do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "KeyN" && !e.shiftKey && ((mod && !e.altKey) || (e.altKey && !mod))) {
        e.preventDefault();
        e.stopPropagation();
        newSession(null);
        return;
      }
      const dir = (mod && e.key === "Tab") ? (e.shiftKey ? -1 : 1) : e.altKey && !mod && e.key === "ArrowDown" ? 1 : e.altKey && !mod && e.key === "ArrowUp" ? -1 : 0;
      if (!dir) return;
      const list = orderRef.current;
      const next = cycleKey(
        list.map((s) => s.key),
        activeRef.current,
        dir,
      );
      const s = next ? list.find((x) => x.key === next) : undefined;
      if (!s) return;
      e.preventDefault();
      e.stopPropagation();
      openTreeRef.current(s, false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [newSession]);
  /** A bot page's Lịch sử phiên and Bản đồ code (its repo's map; registered projects of that repo only, so it never falls back to another repo). */
  const botViews = (key: string): BotViews => {
    const b = roster.all.find((x) => x.key === key);
    const where = b ? botRepo(b.room) : null;
    return {
      history: () =>
        b && (
          <BotHistory
            bot={{ key, display: b.display, root: where?.root ?? null, section: where?.name ?? b.project ?? "Khác" }}
            sessions={tree.sessions}
            now={roster.now}
            api={hq.api}
            onOpen={(s) => openTreeSession(s, s.room === key)}
            onOpenRepo={openRepo}
          />
        ),
      codemap: () =>
        where ? (
          <CodemapView
            token={token}
            projects={hq.projects.data.filter((p) => groupKey(p.path) === groupKey(where.root))}
            others={[{ path: where.root, name: where.name }]}
            onAdded={hq.reload.projects}
            repo={where.root}
            active
          />
        ) : (
          <p className="px-4 py-6 text-sm text-muted-foreground">{b?.display ?? "Bot này"} không chạy trong repo git nào, nên chưa có bản đồ code.</p>
        ),
    };
  };
  const more = moreTabs(contentOn, scope.session != null || tab === "room");
  const newBotFrom = (template?: string) => setNewBot({ template: template ?? null });

  return (
    <>
      {/* viewport-fit=cover (layout.tsx): the notch side in landscape stays clear. */}
      <div className="grid h-dvh grid-cols-1 grid-rows-1 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:grid-cols-[288px_minmax(0,1fr)]">
        {!mobile && (
          <aside className="hidden min-h-0 border-r border-sidebar-border md:block">
            <Sidebar
              live={hq.live}
              roster={roster}
              tab={tab}
              openBot={openKey}
              openGroup={groupId}
              more={more}
              onNav={onNav}
              onOpenBot={openBot}
              onOpenGroup={openGroup}
              onNewBot={newBotFrom}
              onNewGroup={() => setNewGroup(true)}
              onAddProject={focusAddProject}
              onHelp={() => setGuideOpen(true)}
            />
          </aside>
        )}

        {/* The composers end at the bottom edge: keep them above a phone's home indicator (the bottom bar does that itself). */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className={cn("flex min-h-0 flex-col gap-0", (!mobile || fullScreen) && "pb-[env(safe-area-inset-bottom)]")}>
          {/* A phone's open bot or group is a full screen of its own (back arrow, safe area): no HQ header over it. */}
          <header className={cn("shrink-0 border-b bg-background/90 pt-[env(safe-area-inset-top)]", fullScreen && "hidden")}>
            {/* Phones: 44 px targets; px-3 and gap-2 leave the title room at 360 px. */}
            <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
                <p
                  className={cn("truncate text-xs text-muted-foreground", /^([a-z]:[\\/]|[/~])/i.test(subtitle) && "font-mono")}
                  title={subtitle}
                >
                  {subtitle || " "}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 max-sm:gap-0.5">
                <Button size="sm" variant="ghost" className="max-sm:hidden" onClick={() => setGuideOpen(true)} aria-label="Cách dùng HQ">
                  <CircleHelpIcon /> <span className="hidden lg:inline">Cách dùng</span>
                </Button>
                <Button size="sm" variant={shellOpen ? "secondary" : "ghost"} className="-mr-1 max-sm:size-11 max-sm:px-0 sm:mr-0" onClick={() => setShellOpen((o) => !o)} aria-label="Shell trên máy (Ctrl+`)" aria-pressed={shellOpen} title="Shell trên máy (Ctrl+`)">
                  <SquareTerminalIcon /> <span className="hidden lg:inline">Terminal</span>
                </Button>
              </div>
              {/* Below xl the header has no room for these (they pushed the page wider than a tablet); Hạn mức and Quản lý phiên carry the same numbers. */}
              <dl className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground xl:flex">
                <div className="flex items-baseline gap-1.5">
                  <dt>Phòng mở</dt>
                  <dd className="font-mono text-sm font-medium text-foreground tabular">{running}</dd>
                </div>
                {limits.length > 0 && (
                  <div className="flex items-center gap-2" title="Hạn mức gói Claude (5 giờ / 7 ngày), từ status line của phiên mới nhất; tự chạy lại khi reset">
                    <dt className="sr-only">Hạn mức</dt>
                    <dd className="flex items-center gap-2 text-foreground tabular">
                      {limits.map((w, i) => (
                        <span key={w.label} className="flex items-center gap-1.5">
                          {i === 0 && (
                            <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                              <span
                                className={`block h-full rounded-full ${w.pct >= 90 ? "bg-destructive" : w.pct >= 70 ? "bg-st-needs" : "bg-primary"}`}
                                style={{ width: `${w.pct}%` }}
                              />
                            </span>
                          )}
                          {i > 0 && <span aria-hidden className="text-muted-foreground">·</span>}
                          <span>
                            {i === 0 ? `Đã dùng ${w.pct}%` : `${w.label} ${w.pct}%`}
                            {w.left && <span className="text-muted-foreground"> {w.left}</span>}
                          </span>
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                {needsYou > 0 && (
                  <div className="flex items-baseline gap-1.5 text-st-needs">
                    <dt>Chờ anh</dt>
                    <dd className="font-mono text-sm font-semibold tabular">{needsYou}</dd>
                  </div>
                )}
              </dl>
              <div className="shrink-0">
                <MachineChip m={machine.data} onOpen={openMachine} compact={narrow} />
              </div>
            </div>
          </header>
          {/* Bots lists the waiting bots first and shows each one's question in its thread. */}
          {tab !== "bots" && <PinnedAsks office={office.office} token={token} onOpenRoom={openRoom} />}
          <main className="min-h-0 flex-1">
            <TabsContent value="bots" className="h-full">
              <BotsView hq={hq} roster={roster} openKey={openKey} mobile={mobile} onOpen={openBot} onBack={back} onDrawer={setDrawer} onNew={newBotFrom} views={botViews} />
            </TabsContent>
            <TabsContent value="groups" className="h-full">
              <GroupsPage hq={hq} roster={roster} groupId={groupId} mobile={mobile} onOpen={openGroup} onBack={back} onNew={() => setNewGroup(true)} />
            </TabsContent>
            <TabsContent value="search" className="h-full">
              <SearchView roster={roster} sessions={tree.sessions} onOpenBot={openBot} onOpenGroup={openGroup} onOpenSession={(s) => openTreeSession(s, false)} />
            </TabsContent>
            <TabsContent value="tree" className="h-full overflow-y-auto">
              <SessionTreeView
                hq={hq}
                office={office}
                tree={tree}
                active={activeKey}
                onNew={newSession}
                onOpenSession={openTreeSession}
                onOpenRoom={openRoom}
                onOpenRepo={openRepo}
                onOpenFolder={(id, p) => {
                  const f = p ?? hq.projects.data.find((x) => x.id === id);
                  if (f) newSession(f.path);
                }}
              />
            </TabsContent>
            <TabsContent value="workspace" className="h-full">
              <WorkspaceView token={token} projects={wsProjects} sessions={tree.sessions} />
            </TabsContent>
            <TabsContent value="overview" className="h-full">
              <OverviewView
                office={office}
                previews={previews}
                messages={hq.messages.data}
                token={token}
                onTab={setTab}
                onOpenRoom={openRoom}
                focus={repo?.root ?? null}
                onAll={() => setRepo(null)}
                sessions={tree.sessions}
                onOpenSession={(s) => openTreeSession(s, false)}
              />
            </TabsContent>
            <TabsContent value="office" className="h-full">
              <OfficeView data={office} selected={scope.session} onOpen={openRoom} onStart={focusStartSession} token={token} repo={repo?.root ?? null} onAll={() => setRepo(null)} />
            </TabsContent>
            <TabsContent value="group" className="flex h-full min-h-0 flex-col">
              <TeamThread rows={group.messages} filters={{ roleOf }} token={token} onOpenSession={openSession} nameOf={nameOf} />
            </TabsContent>
            <TabsContent value="room" className="h-full">
              {scope.session == null ? (
                <RoomPicker
                  sessions={liveRooms}
                  onPick={(s) => {
                    onScope({ project: null, session: s.name });
                    setTarget(s.name);
                  }}
                />
              ) : (
              <RoomLogProvider sessionId={room?.session_id ?? null} token={token} working={roomState?.state === "working"}>
              <PathOpenProvider token={token} base={room?.cwd ?? null}>
                <TeamView
                  hq={hq}
                  messages={view.messages}
                  sessions={view.sessions}
                  target={target}
                  onTarget={setTarget}
                  onStartSession={focusStartSession}
                  bar={room && roomState ? <RoomBar room={room} n={roomState} token={token} onTerminal={openTerminal} /> : null}
                  split={room && roomState ? <RoomBrief room={room} n={roomState} now={office.office?.at ?? 0} token={token} onTerminal={openTerminal} /> : null}
                  report={room ? <RoomReport key={room.key} room={room} token={token} onOpenPost={openPost} onOpenFile={openArtifact} /> : null}
                  files={room && filesRootOf(room) ? <FilesPane root={filesRootOf(room)!} token={token} /> : null}
                  header={
                    !(room && roomState) && loaded && !liveRooms.length ? (
                      <FirstRun state={firstRun} onAddProject={focusAddProject} onStartSession={focusStartSession} />
                    ) : null
                  }
                />
              </PathOpenProvider>
              </RoomLogProvider>
              )}
            </TabsContent>
            <TabsContent value="report" className="h-full">
              <ReportView data={office} onOpen={openRoom} repo={repo?.root ?? null} />
            </TabsContent>
            <TabsContent value="usage" className="h-full">
              <UsageView token={token} />
            </TabsContent>
            <TabsContent value="may" className="h-full">
              <MachineView m={machine.data} reload={machine.reload} api={hq.api} rooms={officeRooms} active={tab === "may"} />
            </TabsContent>
            <TabsContent value="know" className="h-full">
              <KnowView token={token} roots={knowRoots} repo={repo?.root ?? null} active={tab === "know"} />
            </TabsContent>
            <TabsContent value="content" className="h-full">
              {contentOn && <ContentView token={token} active={tab === "content"} onOpenFile={openArtifact} />}
            </TabsContent>
            <TabsContent value="artifacts" className="h-full">
              <ArtifactsView token={token} repo={repo?.root ?? null} active={tab === "artifacts"} rooms={officeRooms} onAsk={openRoom} />
            </TabsContent>
            <TabsContent value="codemap" className="h-full">
              <CodemapView token={token} projects={hq.projects.data} others={wsProjects} onAdded={hq.reload.projects} repo={repo?.root ?? null} active={tab === "codemap"} />
            </TabsContent>
            <TabsContent value="preview" className="h-full">
              <PreviewView state={previews} token={token} rooms={officeRooms} repo={repo?.root ?? null} />
            </TabsContent>
            <TabsContent value="loops" className="h-full">
              <LoopsView loops={loops} repo={repo?.root ?? null} token={token} rooms={officeRooms} />
            </TabsContent>
            <TabsContent value="sessions" className="h-full">
              <SessionsView
                hq={hq}
                sessions={view.sessions}
                projects={hq.projects.data}
                projectId={scope.project}
                nameInputId={SESSION_NAME_INPUT}
              />
            </TabsContent>
            <TabsContent value="activity" className="h-full">
              <ActivityView hq={hq} messages={view.messages} />
            </TabsContent>
          </main>
          {mobile && !fullScreen && (
            <BottomTabs tab={tab} needs={roster.bots.filter((b) => b.status === "needs").length} more={more} onNav={onNav} onAddProject={focusAddProject} onHelp={() => setGuideOpen(true)} />
          )}
        </Tabs>
      </div>
      <TerminalDrawer
        session={drawerSession}
        token={token}
        onClose={() => setDrawer(null)}
        role={drawerSession?.role}
        model={drawerSession?.model}
      />
      <WebTerminalSheet token={token} />
      <FloatShell
        token={token}
        cwd={tab === "workspace" ? (pane?.cwd ?? ws.folder ?? null) : scope.session ? (view.sessions[0]?.cwd ?? null) : (project?.path ?? repo?.root ?? null)}
        open={shellOpen}
        onOpenChange={setShellOpen}
      />
      <Guide
        open={guideOpen || firstGuide}
        onOpenChange={(open) => {
          setGuideOpen(open);
          if (!open) dismissGuide();
        }}
      />
      <AddProjectDialog
        hq={hq}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(_id, p) => {
          if (p) newSession(p.path);
        }}
      />
      <NewBotSheet
        hq={hq}
        open={newBot != null}
        onOpenChange={(o) => !o && setNewBot(null)}
        initialTemplate={newBot?.template}
        onCreated={(key) => {
          office.retry();
          openBot(key);
        }}
      />
      <NewGroupDialog
        hq={hq}
        open={newGroup}
        onOpenChange={setNewGroup}
        all={roster.all}
        onCreated={(id) => {
          roster.reloadGroups();
          openGroup(id);
        }}
      />
      <Toaster position="bottom-right" />
    </>
  );
}

/** Chat phòng with no room picked: choose which session's room to talk to. */
function RoomPicker({ sessions, onPick }: { sessions: Session[]; onPick: (s: Session) => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6 sm:px-6">
        <h2 className="text-sm font-semibold">Chọn phòng để chat</h2>
        <p className="text-sm text-muted-foreground">
          Chat phòng chỉ gồm tin của một session và team của nó. Tin giữa mọi phòng nằm ở Chat tổng.
        </p>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có session nào đang chạy.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {sessions.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  className="flex h-10 w-full min-w-0 items-center gap-2.5 px-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <StatusDot status={s.status} />
                  {/* The name never shrinks (a long worktree path cut it to "r…"); the path is cut from the left instead. */}
                  <span className="shrink-0 font-medium">{sessionLabel(s)}</span>
                  <span className="ml-auto min-w-0 truncate font-mono text-xs text-muted-foreground [direction:rtl] text-left" title={s.cwd ?? undefined}>
                    <bdi>{s.cwd}</bdi>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
