"use client";

import { MonitorIcon, PlayIcon, RadioIcon, ShieldOffIcon, SquareIcon, TerminalSquareIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { sessionLabel } from "@/lib/labels";
import { ROLES, modelShort } from "@/lib/roles";
import { RoleBadge } from "./role-badge";
import { EmptyState, ErrorNote, STATUS_LABEL, StatusDot, WaitingBadge, ago, shortName } from "./bits";
import type { Hq } from "./use-hq";
import type { ChannelMode, Project, Session } from "./types";

const TerminalPanel = dynamic(() => import("./terminal").then((m) => m.TerminalPanel), { ssr: false });
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function SessionsView({
  hq,
  sessions,
  projects,
  projectId,
  nameInputId,
}: {
  hq: Hq;
  sessions: Session[];
  projects: Project[];
  projectId: number | null;
  nameInputId: string;
}) {
  const [viewing, setViewing] = useState<string | null>(null);
  const { loading, error } = hq.sessions;
  const viewingSession = sessions.find((x) => x.name === viewing);
  const projectName = (id: number | null) => projects.find((p) => p.id === id)?.name ?? "No project";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-4 sm:px-6">
        <StartSession hq={hq} projects={projects} projectId={projectId} inputId={nameInputId} mode={hq.channelMode} />

        {error ? (
          <ErrorNote what="sessions" error={error} onRetry={hq.reload.sessions} />
        ) : loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState icon={<MonitorIcon />} title="No sessions here yet">
            Start one above. Sessions you run yourself with <code className="font-mono text-[12px]">claude</code> also
            show up once their hooks report in.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Sessions</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-3 py-2 font-medium">Session</th>
                  <th scope="col" className="px-3 py-2 font-medium">Project</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Messages</th>
                  <th scope="col" className="px-3 py-2 font-medium">Started</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.name} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2 text-[13px]" title={s.name}>
                        <StatusDot status={s.status} />
                        {sessionLabel(s)}
                        {s.role && <RoleBadge role={s.role} model={s.model ?? undefined} />}
                      </span>
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 text-muted-foreground" title={s.cwd ?? undefined}>
                      {projectName(s.project_id)}
                    </td>
                    <td className="px-3 py-2">
                      {s.waiting ? (
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <WaitingBadge what={s.waiting} />
                          <span className="text-xs text-muted-foreground">{s.waiting}</span>
                        </span>
                      ) : (
                        <>
                          <span className={cn(s.status === "needs_input" && "font-medium text-st-needs")}>
                            {STATUS_LABEL[s.status]}
                          </span>
                          {s.detail && <span className="ml-1 text-xs text-muted-foreground">({s.detail})</span>}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!s.tmux ? (
                        <span className="text-muted-foreground">Not started here</span>
                      ) : s.channel_state === "blocked-by-org" ? (
                        <span
                          className="inline-flex items-center gap-1 text-muted-foreground"
                          title="Channels are off for your Claude org; messages are typed into the terminal."
                        >
                          <ShieldOffIcon className="size-3" aria-hidden /> Terminal · Channels off by org
                        </span>
                      ) : s.channel ? (
                        <span className="inline-flex items-center gap-1 text-via-channel">
                          <RadioIcon className="size-3" aria-hidden /> Channel
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <TerminalSquareIcon className="size-3" aria-hidden /> Terminal
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular">{ago(s.started_at)}</td>
                    <td className="px-3 py-2">
                      {s.tmux && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant={s.waiting ? "outline" : "ghost"}
                            onClick={() => setViewing(s.name)}
                            aria-label={s.waiting ? `Answer ${sessionLabel(s)} in its terminal` : `Open ${sessionLabel(s)} terminal`}
                          >
                            <TerminalSquareIcon /> {s.waiting ? "Answer" : "Terminal"}
                          </Button>
                          <StopButton hq={hq} name={s.name} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Sheet open={viewing != null} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent side="right" className="w-full gap-3 p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
          <SheetHeader className="p-0 pr-8">
            <SheetTitle className="text-sm">{viewingSession ? sessionLabel(viewingSession) : shortName(viewing ?? "")}</SheetTitle>
            <SheetDescription>Live pane, refreshed every 1.5 s. The keys below go straight to this session.</SheetDescription>
          </SheetHeader>
          {viewing && <TerminalPanel api={hq.api} name={viewing} session={sessions.find((x) => x.name === viewing)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StopButton({ hq, name }: { hq: Hq; name: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function click() {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    clearTimeout(timer.current);
    setBusy(true);
    try {
      await hq.api(`/api/sessions/${encodeURIComponent(name)}/stop`, { method: "POST" });
      toast.success(`Stopped ${shortName(name)}`);
      await hq.reload.sessions();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <Button size="sm" variant={armed ? "destructive" : "ghost"} onClick={click} disabled={busy} aria-live="polite">
      <SquareIcon /> {armed ? "Confirm stop" : "Stop"}
    </Button>
  );
}

function StartSession({
  hq,
  projects,
  projectId,
  inputId,
  mode,
}: {
  hq: Hq;
  projects: Project[];
  projectId: number | null;
  inputId: string;
  mode: ChannelMode | null;
}) {
  const [picked, setPicked] = useState<string>("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projects.find((p) => String(p.id) === picked) ?? projects.find((p) => p.id === projectId) ?? projects[0];
  const bare = name.trim().replace(/^hq-/, "");
  const nameOk = NAME_RE.test(bare);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!project || !nameOk) {
      setError(project ? "Use 1-32 lowercase letters, digits or '-', starting with a letter or digit." : "Add a project folder first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await hq.api<{ channel: ChannelMode }>("/api/sessions", {
        method: "POST",
        body: role === "none" ? { project: project.id, name: bare } : { project: project.id, name: bare, role },
      });
      toast.success(
        r.channel.mode === "channel"
          ? `Started hq-${bare}. Approve the channel prompt in its terminal once.`
          : `Started hq-${bare} without a channel; messages are typed into its terminal.`,
      );
      setName("");
      await hq.reload.sessions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card px-4 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <span id="start-project-label" className="block text-xs font-medium text-muted-foreground">
            Project
          </span>
          <Select value={project ? String(project.id) : ""} onValueChange={setPicked} disabled={!projects.length}>
            <SelectTrigger size="sm" className="w-44" aria-labelledby="start-project-label">
              <SelectValue placeholder="No folders yet" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-40 flex-1 space-y-1">
          <label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground">
            Session name
          </label>
          <div className="flex h-7 items-center rounded-md border border-input bg-transparent font-mono text-[13px] focus-within:ring-2 focus-within:ring-ring/50 dark:bg-input/30">
            <span className="pl-2 text-muted-foreground select-none">hq-</span>
            <input
              id={inputId}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="api"
              maxLength={35}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!!error || (name !== "" && !nameOk)}
              aria-describedby="start-help"
              className="h-full min-w-0 flex-1 bg-transparent pr-2 outline-none"
            />
          </div>
        </div>
        <div className="space-y-1">
          <span id="start-role-label" className="block text-xs font-medium text-muted-foreground">
            Vai trò
          </span>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger size="sm" className="w-52" aria-labelledby="start-role-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Không gán (model mặc định)</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.labelVi} · {modelShort(r.model)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" size="sm" disabled={busy || !project || !nameOk}>
          <PlayIcon /> {busy ? "Starting…" : "Start session"}
        </Button>
      </div>
      <p id="start-help" className={cn("mt-2 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
        {error ??
          (mode?.mode === "off"
            ? `Runs claude in tmux. Channels off: ${mode.reason ?? "disabled"}.`
            : "Runs claude in tmux with the 8sync-hq channel loaded.")}
      </p>
    </form>
  );
}
