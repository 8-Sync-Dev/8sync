"use client";

import { ChevronRightIcon, FolderIcon, FolderPlusIcon, FolderXIcon, LayersIcon, MoonIcon, RadioIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { splitStale, sessionLabel } from "@/lib/labels";
import { ErrorNote, STATUS_LABEL, StatusDot, WaitingBadge } from "./bits";
import type { Hq, Live } from "./use-hq";
import type { Project, Session } from "./types";

export type Scope = { project: number | null; session: string | null };

const item =
  "group flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 aria-[current=true]:bg-sidebar-accent aria-[current=true]:font-medium";

export function Nav({ hq, scope, onScope }: { hq: Hq; scope: Scope; onScope: (s: Scope) => void }) {
  const { projects, sessions } = hq;
  const unassigned = sessions.data.filter((s) => s.project_id == null || !projects.data.some((p) => p.id === s.project_id));

  return (
    <nav aria-label="Projects and sessions" className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
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
          aria-current={scope.project == null && scope.session == null}
          onClick={() => onScope({ project: null, session: null })}
        >
          <LayersIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate">Everything</span>
          <Count n={sessions.data.filter((s) => s.status !== "ended").length} />
        </button>

        <p className="mt-4 mb-1 px-2 text-xs font-medium text-muted-foreground">Projects</p>
        {projects.loading ? (
          <div className="space-y-2 px-2 py-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : projects.error ? (
          <div className="px-1">
            <ErrorNote what="projects" error={projects.error} onRetry={hq.reload.projects} />
          </div>
        ) : projects.data.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No folders yet. Add one below.</p>
        ) : (
          <ProjectList projects={projects.data} sessions={sessions.data} scope={scope} onScope={onScope} />
        )}

        {unassigned.length > 0 && (
          <>
            <p className="mt-4 mb-1 px-2 text-xs font-medium text-muted-foreground">Other sessions</p>
            <ul className="space-y-0.5">
              <SessionList sessions={unassigned} scope={scope} onScope={onScope} />
            </ul>
          </>
        )}
      </div>

      <AddProject hq={hq} onAdded={(id) => onScope({ project: id, session: null })} />
    </nav>
  );
}

/** Projects on disk first; folders that no longer exist fold under one disclosure (open if one is selected). */
function ProjectList({
  projects,
  sessions,
  scope,
  onScope,
}: {
  projects: Project[];
  sessions: Session[];
  scope: Scope;
  onScope: (s: Scope) => void;
}) {
  const here = projects.filter((p) => !p.missing);
  const gone = projects.filter((p) => p.missing);
  const hasSelected = gone.some(
    (p) => scope.project === p.id || sessions.some((s) => s.project_id === p.id && s.name === scope.session),
  );
  const render = (p: Project) => (
    <ProjectItem
      key={p.id}
      project={p}
      sessions={sessions.filter((s) => s.project_id === p.id)}
      scope={scope}
      onScope={onScope}
    />
  );
  return (
    <ul className="space-y-0.5">
      {here.map(render)}
      {gone.length > 0 && (
        <li>
          <details className="group/gone" open={hasSelected || undefined}>
            <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="size-3 transition-transform group-open/gone:rotate-90" aria-hidden />
              Không còn thư mục ({gone.length})
            </summary>
            <ul className="space-y-0.5">{gone.map(render)}</ul>
          </details>
        </li>
      )}
    </ul>
  );
}

function ProjectItem({
  project,
  sessions,
  scope,
  onScope,
}: {
  project: Project;
  sessions: Session[];
  scope: Scope;
  onScope: (s: Scope) => void;
}) {
  const active = sessions.filter((s) => s.status !== "ended");
  return (
    <li>
      <button
        type="button"
        title={project.missing ? `${project.path} (thư mục không còn trên máy)` : project.path}
        className={cn(item, "h-8", project.missing && "text-muted-foreground")}
        aria-current={scope.project === project.id && scope.session == null}
        onClick={() => onScope({ project: project.id, session: null })}
      >
        {project.missing ? (
          <FolderXIcon className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <FolderIcon className="size-4 text-muted-foreground" aria-hidden />
        )}
        <span className="flex-1 truncate">{project.name}</span>
        <Count n={active.length} />
      </button>
      {sessions.length > 0 && (
        <ul className="mt-0.5 ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
          <SessionList sessions={sessions} scope={scope} onScope={onScope} />
        </ul>
      )}
    </li>
  );
}

/** Fresh sessions first; idle > 1 day and ended ones sit under a disclosure (kept open if one is selected). */
function SessionList({ sessions, scope, onScope }: { sessions: Session[]; scope: Scope; onScope: (s: Scope) => void }) {
  const { fresh, stale } = splitStale(sessions);
  const hasSelected = stale.some((s) => s.name === scope.session);
  return (
    <>
      {fresh.map((s) => (
        <SessionItem key={s.name} s={s} scope={scope} onScope={onScope} />
      ))}
      {stale.length > 0 && (
        <li>
          <details className="group/old" open={hasSelected || undefined}>
            <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="size-3 transition-transform group-open/old:rotate-90" aria-hidden />
              Older ({stale.length})
            </summary>
            <ul className="space-y-0.5">
              {stale.map((s) => (
                <SessionItem key={s.name} s={s} scope={scope} onScope={onScope} />
              ))}
            </ul>
          </details>
        </li>
      )}
    </>
  );
}

function SessionItem({ s, scope, onScope }: { s: Session; scope: Scope; onScope: (s: Scope) => void }) {
  return (
    <li>
      <button
        type="button"
        className={cn(item, "h-7", s.status === "ended" && "text-muted-foreground")}
        aria-current={scope.session === s.name}
        onClick={() => onScope({ project: s.project_id, session: s.name })}
        title={`${sessionLabel(s)}: ${s.waiting ? `Claude is waiting for you (${s.waiting})` : STATUS_LABEL[s.status]}${s.channel ? ", channel connected" : s.channel_state === "blocked-by-org" ? ", Channels off by org" : ""}`}
      >
        <StatusDot status={s.status} />
        <span className="flex-1 truncate text-[13px]">{sessionLabel(s)}</span>
        {s.channel && <RadioIcon className="size-3 text-via-channel" aria-label="channel connected" />}
        {s.waiting ? (
          <WaitingBadge what={s.waiting} compact />
        ) : (
          s.status === "needs_input" && <span className="text-[11px] text-st-needs">needs you</span>
        )}
      </button>
    </li>
  );
}

function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="tabular text-xs text-muted-foreground">{n}</span>;
}

function LiveDot({ live }: { live: Live }) {
  const label = live === "live" ? "Live" : live === "connecting" ? "Connecting" : "Reconnecting";
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          live === "live" ? "bg-st-running" : "animate-pulse bg-st-needs",
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
      toast.success(r.existed ? `${r.project.name} is already added` : `Added ${r.project.name}`);
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
          Add project folder
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
            aria-describedby={error ? "add-project-error" : undefined}
            className="h-8 font-mono text-xs"
          />
          <Button type="submit" size="icon" variant="outline" disabled={busy || !path.trim()} aria-label="Add folder">
            <FolderPlusIcon />
          </Button>
        </div>
        {error && (
          <p id="add-project-error" className="text-xs text-destructive">
            {error}
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
        {mounted && dark ? "Light theme" : "Dark theme"}
      </Button>
    </div>
  );
}

const noop = () => () => {};
