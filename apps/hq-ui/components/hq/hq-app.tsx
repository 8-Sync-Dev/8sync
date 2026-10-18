"use client";

import { addressOf, deliveryOf, sessionLabel } from "@/lib/labels";
import { roomNow } from "@/lib/now";
import { limitsView, matchesSession } from "@/lib/office";
import { CircleHelpIcon, MenuIcon, SendIcon } from "lucide-react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityView } from "./activity-view";
import { AssignDialog } from "./assign-dialog";
import { shortName, StatusDot } from "./bits";
import { BoardView } from "./board-view";
import { BroadcastComposer } from "./broadcast";
import { FirstRun } from "./first-run";
import { FlowView, type LoopsState } from "./flow-view";
import { Guide, useGuideFirstRun } from "./guide";
import { Nav, type Scope } from "./nav";
import { RoomBrief } from "./room-brief";
import { OfficeView } from "./office-view";
import { OverviewView } from "./overview-view";
import { PreviewView, type PreviewState } from "./preview-view";
import { ReportView } from "./report-view";
import { SessionsView } from "./sessions-view";
import { TeamThread } from "./team-thread";
import { TeamView } from "./team-view";
import { TerminalDrawer } from "./terminal-drawer";
import { WebTerminalSheet } from "./web-terminal-sheet";
import { useBoards } from "./use-board";
import { useHq } from "./use-hq";
import { useOffice, type Room } from "./use-office";
import { usePoll } from "./use-poll";
import { MachineChip } from "./machine-chip";
import type { Session } from "./types";

/** office: every session is a room · group: all rooms talking · room: one room's chat. */
type Tab = "overview" | "office" | "group" | "room" | "board" | "preview" | "flow" | "report" | "sessions" | "activity";

/** Tổng quan is the first screen on a wide monitor; below this the office stays the default. */
const WIDE_QUERY = "(min-width: 1600px)";
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const isWide = () => window.matchMedia(WIDE_QUERY).matches;
const PREVIEW_POLL_MS = 15_000;
const LOOPS_POLL_MS = 30_000;

/** Scope by any name a session goes by: hq name, Claude session id, or its label. */
const isScoped = (s: Session, key: string | null) => matchesSession({ ...s, label: sessionLabel(s) }, key);
const SESSION_NAME_INPUT = "start-session-name";

export function HqApp({ token }: { token: string }) {
  const hq = useHq(token);
  const office = useOffice(token);
  // One board poll for Văn phòng (who holds which card) and Board (lanes).
  const boards = useBoards(hq.api);
  const [scope, setScope] = useState<Scope>({ project: null, session: null });
  // The repo the owner opened from the sidebar: Tổng quan shows that project's block only.
  const [repo, setRepo] = useState<{ root: string; name: string } | null>(null);
  // null until the owner picks a tab: the default follows the screen (Tổng quan on a wide monitor).
  const [picked, setTab] = useState<Tab | null>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const tab: Tab = picked ?? (wide ? "overview" : "office");
  const [target, setTarget] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  // The session whose live terminal is open in the right drawer (hq-* tmux sessions only).
  const [drawer, setDrawer] = useState<string | null>(null);
  const [assign, setAssign] = useState<{ open: boolean; session?: string; n: number }>({ open: false, n: 0 });
  const [firstGuide, dismissGuide] = useGuideFirstRun();
  // A card another tab asked Board to open ("Mở card"); `n` makes each request new.
  const [focusCard, setFocusCard] = useState<{ root: string; id: number; n: number } | null>(null);
  const previews = usePoll<{ projects: NonNullable<PreviewState["data"]>["projects"] }>(hq.api, "/api/preview", PREVIEW_POLL_MS, tab === "preview" || tab === "overview");
  const loops = usePoll<NonNullable<LoopsState["data"]>>(hq.api, "/api/loops", LOOPS_POLL_MS, tab === "flow");

  const openCard = useCallback((root: string, id: number) => {
    setFocusCard((f) => ({ root, id, n: (f?.n ?? 0) + 1 }));
    setTab("board");
  }, []);
  const [guideOpen, setGuideOpen] = useState(false);

  const onScope = useCallback((s: Scope) => {
    setScope(s);
    setRepo(null);
    if (s.session?.startsWith("hq-")) setTarget(s.session);
    setNavOpen(false);
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
        tasks: hq.tasks.data.filter((t) => inScope(t.session)),
      };
    },
    [hq.sessions.data, hq.messages.data, hq.tasks.data, scope.project],
  );
  const view = useMemo(() => scopeOf(scope.session), [scopeOf, scope.session]);
  const group = useMemo(() => scopeOf(null), [scopeOf]);

  const project = hq.projects.data.find((p) => p.id === scope.project);
  // Projects come from each session's git folder, not only the folders registered in the sidebar.
  const officeRooms = office.office?.rooms ?? [];
  const officeSummary = office.office
    ? `${new Set(officeRooms.map((r) => r.project?.root ?? r.cwd)).size} dự án · ${officeRooms.length} phòng`
    : "";
  const scoped = scope.session ? hq.sessions.data.find((x) => isScoped(x, scope.session)) : undefined;
  const title = scope.session ? (scoped ? sessionLabel(scoped) : shortName(scope.session)) : project ? project.name : (repo?.name ?? "Tất cả phòng");
  const subtitle = scope.session
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
  const goHome = () => {
    onScope({ project: null, session: null });
    setTab("office");
  };
  /** A repo with rooms, from the sidebar: its Tổng quan. */
  const openRepo = (root: string, name: string) => {
    onScope({ project: null, session: null });
    setRepo({ root, name });
    setTab("overview");
  };
  /** A folder with no room yet: the office lists it under "Dự án chưa có team" with its Mở team button. */
  const openFolder = (id: number) => {
    onScope({ project: id, session: null });
    setTab("office");
  };
  // The room Chat phòng is about: its office row (doing, card, ask) feeds the brief above the timeline.
  const room = scope.session ? officeRooms.find((r) => matchesSession(r, scope.session) || (scoped != null && (r.name === scoped.name || (scoped.session_id != null && r.session_id === scoped.session_id)))) : undefined;
  const roomState = room ? roomNow(room, boards.boards ?? [], office.office?.at ?? 0) : null;
  const openTerminal = () => {
    const s = room ? hq.sessions.data.find((x) => x.name === room.name || (room.session_id != null && x.session_id === room.session_id)) : undefined;
    if (s?.tmux) setDrawer(s.name);
  };
  const liveRooms = hq.sessions.data.filter((s) => s.status !== "ended");
  const openAssign = (session?: string) => setAssign((a) => ({ open: true, session, n: a.n + 1 }));
  const roleOf = (name: string) => hq.sessions.data.find((x) => x.name === name || x.session_id === name)?.role ?? null;

  const focusAddProject = () => {
    setNavOpen(true);
    // The input lives in the sidebar (or the mobile sheet once it opens).
    setTimeout(() => {
      const els = document.querySelectorAll<HTMLInputElement>("#add-project");
      [...els].find((el) => el.offsetParent !== null)?.focus();
    }, 60);
  };
  const focusStartSession = () => {
    setTab("sessions");
    setTimeout(() => document.getElementById(SESSION_NAME_INPUT)?.focus(), 60);
  };

  return (
    <>
      <div className="grid h-dvh grid-cols-1 grid-rows-1 md:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-sidebar-border md:block">
          <Nav hq={hq} scope={scope} office={office} boards={boards.boards ?? []} onHome={goHome} onOpenRoom={openRoom} onOpenFolder={openFolder} onOpenRepo={openRepo} repo={repo?.root ?? null} />
        </aside>
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-72 p-0 md:hidden" showCloseButton={false}>
            <SheetTitle className="sr-only">Dự án và phòng</SheetTitle>
            <Nav hq={hq} scope={scope} office={office} boards={boards.boards ?? []} onHome={goHome} onOpenRoom={openRoom} onOpenFolder={openFolder} onOpenRepo={openRepo} repo={repo?.root ?? null} />
          </SheetContent>
        </Sheet>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-col gap-0">
          <header className="shrink-0 border-b">
            <div className="flex items-center gap-3 px-4 pt-3 sm:px-6">
              <Button size="icon-sm" variant="ghost" className="-ml-1 md:hidden" onClick={() => setNavOpen(true)} aria-label="Open projects">
                <MenuIcon />
              </Button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
                <p
                  className={cn("truncate text-xs text-muted-foreground", subtitle.startsWith("/") && "font-mono")}
                  title={subtitle}
                >
                  {subtitle || " "}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" onClick={() => openAssign()} disabled={!hq.projects.data.length && !running}>
                  <SendIcon /> Giao việc
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setGuideOpen(true)} aria-label="Cách dùng HQ">
                  <CircleHelpIcon /> <span className="hidden lg:inline">Cách dùng</span>
                </Button>
              </div>
              <dl className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
                <div className="flex items-baseline gap-1.5">
                  <dt>Running</dt>
                  <dd className="text-sm font-medium text-foreground tabular">{running}</dd>
                </div>
                {limits.length > 0 && (
                  <div className="flex items-center gap-2" title="Hạn mức gói Claude (5 giờ / 7 ngày), từ status line của phiên mới nhất; tự chạy lại khi reset">
                    <dt className="sr-only">Usage</dt>
                    <dd className="flex items-center gap-2 text-foreground tabular">
                      {limits.map((w, i) => (
                        <span key={w.label} className="flex items-center gap-1.5">
                          {i === 0 && (
                            <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                              <span
                                className={`block h-full rounded-full ${w.pct >= 90 ? "bg-destructive" : w.pct >= 70 ? "bg-st-needs" : "bg-foreground/70"}`}
                                style={{ width: `${w.pct}%` }}
                              />
                            </span>
                          )}
                          {i > 0 && <span aria-hidden className="text-muted-foreground">·</span>}
                          <span>
                            {i === 0 ? `${w.pct}% used` : `${w.label} ${w.pct}%`}
                            {w.left && <span className="text-muted-foreground"> {w.left}</span>}
                          </span>
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                {needsYou > 0 && (
                  <div className="flex items-baseline gap-1.5 text-st-needs">
                    <dt>Needs you</dt>
                    <dd className="text-sm font-semibold tabular">{needsYou}</dd>
                  </div>
                )}
              </dl>
              <div className="hidden shrink-0 sm:block">
                <MachineChip api={hq.api} />
              </div>
            </div>
            <TabsList variant="line" className="mt-2 h-9 w-full max-w-full justify-start gap-4 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6">
              <TabsTrigger value="overview" className="flex-none px-0">Tổng quan</TabsTrigger>
              <TabsTrigger value="office" className="flex-none px-0">Văn phòng</TabsTrigger>
              <TabsTrigger value="group" className="flex-none px-0">Chat tổng</TabsTrigger>
              <TabsTrigger value="room" className="flex-none px-0">Chat phòng</TabsTrigger>
              <TabsTrigger value="board" className="flex-none px-0">
                Board
                {view.tasks.length > 0 && <span className="text-xs text-muted-foreground tabular">{view.tasks.filter((t) => t.status !== "done").length}</span>}
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex-none px-0">Preview</TabsTrigger>
              <TabsTrigger value="flow" className="flex-none px-0">Flow</TabsTrigger>
              <TabsTrigger value="report" className="flex-none px-0">Báo cáo</TabsTrigger>
              <TabsTrigger value="sessions" className="flex-none px-0">
                Sessions
                {needsYou > 0 && <span aria-label={`${needsYou} need you`} className="size-1.5 rounded-full bg-st-needs" />}
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex-none px-0">Activity</TabsTrigger>
            </TabsList>
          </header>

          <main className="min-h-0 flex-1">
            <TabsContent value="overview" className="h-full">
              <OverviewView
                office={office}
                boards={boards}
                previews={previews}
                messages={hq.messages.data}
                token={token}
                onTab={setTab}
                onOpenRoom={openRoom}
                onOpenCard={openCard}
                focus={repo?.root ?? null}
                onAll={() => setRepo(null)}
              />
            </TabsContent>
            <TabsContent value="office" className="h-full">
              <OfficeView data={office} boards={boards} selected={scope.session} onOpen={openRoom} onStart={focusStartSession} token={token} projects={hq.projects.data} />
            </TabsContent>
            <TabsContent value="group" className="flex h-full min-h-0 flex-col">
              <TeamThread rows={group.messages} filters={{ roleOf, tasks: group.tasks }} onOpenSession={openSession} />
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
              <TeamView
                hq={hq}
                messages={view.messages}
                sessions={view.sessions}
                target={target}
                onTarget={setTarget}
                onStartSession={focusStartSession}
                header={
                  room && roomState ? (
                    <RoomBrief room={room} n={roomState} now={office.office?.at ?? 0} token={token} onTerminal={openTerminal} />
                  ) : loaded && !liveRooms.length ? (
                    <FirstRun state={firstRun} onAddProject={focusAddProject} onStartSession={focusStartSession} />
                  ) : null
                }
              />
              )}
            </TabsContent>
            <TabsContent value="report" className="h-full">
              <ReportView data={office} onOpen={openRoom} />
            </TabsContent>
            <TabsContent value="board" className="h-full">
              <BoardView hq={hq} tasks={view.tasks} sessions={view.sessions} boards={boards} focus={focusCard} />
            </TabsContent>
            <TabsContent value="preview" className="h-full">
              <PreviewView state={previews} boards={boards.boards} token={token} onOpenCard={openCard} />
            </TabsContent>
            <TabsContent value="flow" className="h-full">
              <FlowView state={boards} loops={loops} />
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
          {/* Văn phòng and Chat tổng show every room, so the box that reaches every room sits under them. */}
          {(tab === "overview" || tab === "office" || tab === "group") && <BroadcastComposer hq={hq} rooms={officeRooms} preferRoot={project?.path} />}
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
      <AssignDialog
        key={assign.n}
        hq={hq}
        open={assign.open}
        onOpenChange={(open) => setAssign((a) => ({ ...a, open }))}
        sessions={hq.sessions.data}
        projects={hq.projects.data}
        rooms={office.office?.rooms}
        defaultSession={assign.session ?? (scoped && deliveryOf(scoped) && scoped.status !== "ended" ? addressOf(scoped) : undefined)}
        defaultProjectId={scope.project}
      />
      <Guide
        open={guideOpen || firstGuide}
        onOpenChange={(open) => {
          setGuideOpen(open);
          if (!open) dismissGuide();
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
