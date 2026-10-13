"use client";

import { MenuIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityView } from "./activity-view";
import { shortName } from "./bits";
import { BoardView } from "./board-view";
import { FirstRun } from "./first-run";
import { Nav, type Scope } from "./nav";
import { SessionsView } from "./sessions-view";
import { TeamView } from "./team-view";
import { useHq } from "./use-hq";

type Tab = "team" | "board" | "sessions" | "activity";
const SESSION_NAME_INPUT = "start-session-name";

export function HqApp({ token }: { token: string }) {
  const hq = useHq(token);
  const [scope, setScope] = useState<Scope>({ project: null, session: null });
  const [tab, setTab] = useState<Tab>("team");
  const [target, setTarget] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const onScope = useCallback((s: Scope) => {
    setScope(s);
    if (s.session?.startsWith("hq-")) setTarget(s.session);
    setNavOpen(false);
  }, []);

  // Everything below the header is filtered to the selected project or session.
  const view = useMemo(() => {
    const all = hq.sessions.data;
    const sessions =
      scope.session != null
        ? all.filter((s) => s.name === scope.session)
        : scope.project != null
          ? all.filter((s) => s.project_id === scope.project)
          : all;
    const names = new Set(sessions.flatMap((s) => [s.name, s.session_id].filter(Boolean) as string[]));
    const scoped = scope.project != null || scope.session != null;
    const inScope = (...xs: (string | null)[]) => !scoped || xs.some((x) => x != null && names.has(x));
    return {
      sessions,
      messages: hq.messages.data.filter((m) => inScope(m.session, m.from_, m.to_)),
      tasks: hq.tasks.data.filter((t) => inScope(t.session)),
    };
  }, [hq.sessions.data, hq.messages.data, hq.tasks.data, scope]);

  const project = hq.projects.data.find((p) => p.id === scope.project);
  const title = scope.session ? shortName(scope.session) : project ? project.name : "Everything";
  const subtitle = scope.session
    ? (view.sessions[0]?.cwd ?? project?.path ?? "")
    : project
      ? project.path
      : `${hq.projects.data.length} project${hq.projects.data.length === 1 ? "" : "s"}`;
  const needsYou = view.sessions.filter((s) => s.status === "needs_input").length;
  const running = view.sessions.filter((s) => s.status !== "ended").length;

  const firstRun = {
    hasProject: hq.projects.data.length > 0,
    hasSession: hq.sessions.data.some((s) => s.tmux),
    hasChannel: hq.sessions.data.some((s) => s.channel),
    orgBlocked: hq.sessions.data.some((s) => s.channel_state === "blocked-by-org"),
  };
  const loaded = !hq.projects.loading && !hq.sessions.loading;

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
          <Nav hq={hq} scope={scope} onScope={onScope} />
        </aside>
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-72 p-0 md:hidden" showCloseButton={false}>
            <SheetTitle className="sr-only">Projects and sessions</SheetTitle>
            <Nav hq={hq} scope={scope} onScope={onScope} />
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
              <dl className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
                <div className="flex items-baseline gap-1.5">
                  <dt>Running</dt>
                  <dd className="text-sm font-medium text-foreground tabular">{running}</dd>
                </div>
                {needsYou > 0 && (
                  <div className="flex items-baseline gap-1.5 text-st-needs">
                    <dt>Needs you</dt>
                    <dd className="text-sm font-semibold tabular">{needsYou}</dd>
                  </div>
                )}
              </dl>
            </div>
            <TabsList variant="line" className="mt-2 h-9 gap-4 px-4 sm:px-6">
              <TabsTrigger value="team" className="flex-none px-0">Team</TabsTrigger>
              <TabsTrigger value="board" className="flex-none px-0">
                Board
                {view.tasks.length > 0 && <span className="text-xs text-muted-foreground tabular">{view.tasks.filter((t) => t.status !== "done").length}</span>}
              </TabsTrigger>
              <TabsTrigger value="sessions" className="flex-none px-0">
                Sessions
                {needsYou > 0 && <span aria-label={`${needsYou} need you`} className="size-1.5 rounded-full bg-st-needs" />}
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex-none px-0">Activity</TabsTrigger>
            </TabsList>
          </header>

          <main className="min-h-0 flex-1">
            <TabsContent value="team" className="h-full">
              <TeamView
                hq={hq}
                messages={view.messages}
                sessions={view.sessions}
                target={target}
                onTarget={setTarget}
                header={
                  loaded ? (
                    <FirstRun state={firstRun} onAddProject={focusAddProject} onStartSession={focusStartSession} />
                  ) : null
                }
              />
            </TabsContent>
            <TabsContent value="board" className="h-full">
              <BoardView hq={hq} tasks={view.tasks} sessions={view.sessions} />
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
      <Toaster position="bottom-right" />
    </>
  );
}
