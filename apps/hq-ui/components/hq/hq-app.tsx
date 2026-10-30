"use client";

import { sessionLabel } from "@/lib/labels";
import { roomNow } from "@/lib/now";
import { limitsView, matchesSession } from "@/lib/office";
import { ChevronDownIcon, CircleHelpIcon, MenuIcon, SquareTerminalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNarrow } from "@/hooks/use-narrow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityView } from "./activity-view";
import { shortName, StatusDot } from "./bits";
import { FirstRun } from "./first-run";
import { LoopsView, type LoopsState } from "./loops-view";
import { Guide, useGuideFirstRun } from "./guide";
import { Nav, type Scope } from "./nav";
import { RoomBar, RoomBrief } from "./room-brief";
import { OfficeView } from "./office-view";
import { OverviewView } from "./overview-view";
import { PreviewView, type PreviewState } from "./preview-view";
import { ReportView } from "./report-view";
import { SessionsView } from "./sessions-view";
import { FloatShell } from "./float-shell";
import { TeamThread } from "./team-thread";
import { TeamView } from "./team-view";
import { useEdgeFade } from "./scroll-strip";
import { TerminalDrawer } from "./terminal-drawer";
import { WebTerminalSheet } from "./web-terminal-sheet";
import { useHq } from "./use-hq";
import { useReloadOnNewUi } from "./use-ui-version";
import { useOffice, type Room } from "./use-office";
import { usePoll } from "./use-poll";
import { MachineChip, type MachineView as MachineData } from "./machine-chip";
import { rootKey } from "@/lib/preview";
import { MORE_LABEL, MORE_TABS, isMore, moreLabel } from "@/lib/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KnowView } from "./know-view";
import { MachineView } from "./machine-view";
import { UsageView } from "./usage-view";
import type { Session } from "./types";

/** office: every session is a room · group: all rooms talking · room: one room's chat · may: this machine · usage: plan limits and tokens. */
type Tab = "overview" | "office" | "group" | "room" | "preview" | "loops" | "report" | "usage" | "may" | "know" | "sessions" | "activity";
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
/** The header chip and the Máy tab share one poll. */
const MACHINE_POLL_MS = 5_000;
/** Scope by any name a session goes by: hq name, Claude session id, or its label. */
const isScoped = (s: Session, key: string | null) => matchesSession({ ...s, label: sessionLabel(s) }, key);
const SESSION_NAME_INPUT = "start-session-name";

export function HqApp({ token, ui }: { token: string; ui: string | null }) {
  const hq = useHq(token);
  useReloadOnNewUi(token, ui);
  const office = useOffice(token);
  const [scope, setScope] = useState<Scope>({ project: null, session: null });
  // The repo the owner opened from the sidebar: Tổng quan shows that project's block only.
  const [repo, setRepo] = useState<{ root: string; name: string } | null>(null);
  // null until the owner picks a tab: the default follows the screen (Tổng quan on a wide monitor).
  const [picked, setTab] = useState<Tab | null>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const narrow = useNarrow();
  const tab: Tab = picked ?? (wide ? "overview" : "office");
  const [target, setTarget] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  // The session whose live terminal is open in the right drawer (hq-* tmux sessions only).
  const [drawer, setDrawer] = useState<string | null>(null);
  const [firstGuide, dismissGuide] = useGuideFirstRun();
  const previews = usePoll<{ projects: NonNullable<PreviewState["data"]>["projects"] }>(hq.api, "/api/preview", PREVIEW_POLL_MS, tab === "preview" || tab === "overview");
  const machine = usePoll<MachineData>(hq.api, "/api/machine", MACHINE_POLL_MS, true);
  const openMachine = useCallback(() => setTab("may"), []);
  // Phones scroll the tab row: keep the active tab in view (the Máy chip opens the last ones).
  // The row is scrolled itself (scrollIntoView would also nudge the page).
  const tabRow = useRef<HTMLDivElement>(null);
  useEdgeFade(tabRow);
  useEffect(() => {
    const row = tabRow.current;
    const t = row?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!row || !t) return;
    const pad = 16;
    if (t.offsetLeft - pad < row.scrollLeft) row.scrollTo({ left: t.offsetLeft - pad });
    else if (t.offsetLeft + t.offsetWidth + pad > row.scrollLeft + row.clientWidth) row.scrollTo({ left: t.offsetLeft + t.offsetWidth + pad - row.clientWidth });
  }, [tab]);
  const loops = usePoll<NonNullable<LoopsState["data"]>>(hq.api, "/api/loops", LOOPS_POLL_MS, tab === "loops");

  const [guideOpen, setGuideOpen] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);

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
  /**
   * A folder with no room yet: the office, focused on that folder (owner 2026-10-22: "mở cũng không
   * được": the office kept every project on screen, so opening looked like nothing happened).
   */
  const openFolder = (id: number, p?: { path: string; name: string }) => {
    onScope({ project: id, session: null });
    const f = p ?? hq.projects.data.find((x) => x.id === id);
    if (f) setRepo({ root: f.path, name: f.name });
    setTab("office");
  };
  // The room Chat phòng is about: its office row (doing, ask) feeds the brief above the timeline.
  const room = scope.session ? officeRooms.find((r) => matchesSession(r, scope.session) || (scoped != null && (r.name === scoped.name || (scoped.session_id != null && r.session_id === scoped.session_id)))) : undefined;
  const roomState = room ? roomNow(room, office.office?.at ?? 0) : null;
  const openTerminal = () => {
    const s = room ? hq.sessions.data.find((x) => x.name === room.name || (room.session_id != null && x.session_id === room.session_id)) : undefined;
    if (s?.tmux) setDrawer(s.name);
  };
  const liveRooms = hq.sessions.data.filter((s) => s.status !== "ended");
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
      {/* viewport-fit=cover (layout.tsx): the notch side in landscape stays clear. */}
      <div className="grid h-dvh grid-cols-1 grid-rows-1 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-sidebar-border md:block">
          <Nav hq={hq} scope={scope} office={office} onHome={goHome} onOpenRoom={openRoom} onOpenFolder={openFolder} onOpenRepo={openRepo} repo={repo?.root ?? null} />
        </aside>
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-72 p-0 md:hidden" showCloseButton={false}>
            <SheetTitle className="sr-only">Dự án và phòng</SheetTitle>
            <Nav hq={hq} scope={scope} office={office} onHome={goHome} onOpenRoom={openRoom} onOpenFolder={openFolder} onOpenRepo={openRepo} repo={repo?.root ?? null} />
          </SheetContent>
        </Sheet>

        {/* The composers end at the bottom edge: keep them above a phone's home indicator. */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-col gap-0 pb-[env(safe-area-inset-bottom)]">
          <header className="shrink-0 border-b pt-[env(safe-area-inset-top)]">
            {/* Phones: 44 px targets; px-3 and gap-2 leave the title room at 360 px. */}
            <div className="flex items-center gap-2 px-3 pt-2 sm:gap-3 sm:px-6 sm:pt-3">
              <Button size="icon-sm" variant="ghost" className="-ml-1 max-sm:size-11 md:hidden" onClick={() => setNavOpen(true)} aria-label="Open projects">
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
              <div className="flex shrink-0 items-center gap-1.5 max-sm:gap-0.5">
                <Button size="sm" variant="ghost" className="max-sm:size-11 max-sm:px-0" onClick={() => setGuideOpen(true)} aria-label="Cách dùng HQ">
                  <CircleHelpIcon /> <span className="hidden lg:inline">Cách dùng</span>
                </Button>
                <Button size="sm" variant={shellOpen ? "secondary" : "ghost"} className="-mr-1 max-sm:size-11 max-sm:px-0 sm:mr-0" onClick={() => setShellOpen((o) => !o)} aria-label="Shell trên máy (Ctrl+`)" aria-pressed={shellOpen} title="Shell trên máy (Ctrl+`)">
                  <SquareTerminalIcon /> <span className="hidden lg:inline">Terminal</span>
                </Button>
              </div>
              {/* Below xl the header has no room for these (they pushed the page wider than a tablet); Hạn mức and Sessions carry the same numbers. */}
              <dl className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground xl:flex">
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
              {!narrow && (
                <div className="shrink-0">
                  <MachineChip m={machine.data} onOpen={openMachine} />
                </div>
              )}
            </div>
            <div className="mt-1 flex items-center sm:mt-2">
              {/* Phones: 12 tabs scroll (edges fade while more are hidden, snapping to a tab); each is a full 44 px tall target, its underline kept inside the scroller. */}
              <TabsList
                ref={tabRow}
                variant="line"
                className="hq-fade-x relative h-9 min-w-0 flex-1 snap-x snap-proximity scroll-px-4 justify-start gap-4 overflow-x-auto px-4 [scrollbar-width:none] max-sm:gap-5 max-sm:group-data-horizontal/tabs:h-[50px] max-sm:*:data-[slot=tabs-trigger]:h-11 max-sm:*:data-[slot=tabs-trigger]:snap-start max-sm:*:data-[slot=tabs-trigger]:after:bottom-0 sm:px-6"
              >
                <TabsTrigger value="overview" className="flex-none px-0">Tổng quan</TabsTrigger>
                <TabsTrigger value="office" className="flex-none px-0">Văn phòng</TabsTrigger>
                <TabsTrigger value="preview" className="flex-none px-0">Preview</TabsTrigger>
                <TabsTrigger value="group" className="flex-none px-0">Chat</TabsTrigger>
                {/* Chat phòng only while a room is open (owner 2026-10-22: "nhiều tab đang bị rối"). */}
                {(scope.session != null || tab === "room") && (
                  <TabsTrigger value="room" className="flex-none px-0">
                    Chat phòng
                  </TabsTrigger>
                )}
                {/* The other tabs, one menu (owner 2026-10-22: "ui ux loạn quá"); its label is the open one. */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger
                    className={cn(
                      "relative inline-flex h-full flex-none items-center gap-1 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      isMore(tab) ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-5px] after:h-0.5 after:bg-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-label={`Tab khác: ${moreLabel(tab)}`}
                  >
                    {moreLabel(tab)}
                    {needsYou > 0 && !isMore(tab) && <span aria-label={`${needsYou} need you`} className="size-1.5 rounded-full bg-st-needs" />}
                    <ChevronDownIcon aria-hidden className="size-3.5 opacity-70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-44">
                    {MORE_TABS.map((t) => (
                      <DropdownMenuItem key={t} onSelect={() => setTab(t)} className={cn(tab === t && "font-semibold")}>
                        {MORE_LABEL[t]}
                        {t === "sessions" && needsYou > 0 && <span aria-label={`${needsYou} need you`} className="ml-auto size-1.5 rounded-full bg-st-needs" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TabsList>
              {/* Phones: the header row has no room left, so the chip ends the tab row, compact and set apart by a rule. */}
              {narrow && (
                <div className="shrink-0 border-l pr-1.5 pl-1">
                  <MachineChip m={machine.data} onOpen={openMachine} compact />
                </div>
              )}
            </div>
          </header>

          <main className="min-h-0 flex-1">
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
              />
            </TabsContent>
            <TabsContent value="office" className="h-full">
              <OfficeView data={office} selected={scope.session} onOpen={openRoom} onStart={focusStartSession} token={token} repo={repo?.root ?? null} onAll={() => setRepo(null)} />
            </TabsContent>
            <TabsContent value="group" className="flex h-full min-h-0 flex-col">
              <TeamThread rows={group.messages} filters={{ roleOf }} token={token} onOpenSession={openSession} />
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
                bar={room && roomState ? <RoomBar room={room} n={roomState} token={token} onTerminal={openTerminal} /> : null}
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
            <TabsContent value="preview" className="h-full">
              <PreviewView state={previews} token={token} rooms={officeRooms} repo={repo?.root ?? null} />
            </TabsContent>
            <TabsContent value="loops" className="h-full">
              <LoopsView loops={loops} repo={repo?.root ?? null} />
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
      <FloatShell token={token} cwd={scope.session ? (view.sessions[0]?.cwd ?? null) : (project?.path ?? repo?.root ?? null)} open={shellOpen} onOpenChange={setShellOpen} />
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
