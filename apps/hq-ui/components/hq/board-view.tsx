"use client";

import { KanbanSquareIcon, PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { addressOf, inboxText, messageTargets, sessionLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote, ago, shortName } from "./bits";
import { LanesView } from "./lanes-view";
import type { Hq } from "./use-hq";
import { TASK_COLUMNS, type Message, type Session, type Task } from "./types";

/** Board tab: the project's cards by lane (`8sync ccc auto board`), or the sessions' own tasks. */
export function BoardView({ hq, tasks, sessions }: { hq: Hq; tasks: Task[]; sessions: Session[] }) {
  const [mode, setMode] = useState<"lanes" | "tasks">("lanes");
  const tab = (m: typeof mode, label: string) => (
    <Button type="button" size="sm" variant={mode === m ? "secondary" : "ghost"} aria-pressed={mode === m} onClick={() => setMode(m)}>
      {label}
    </Button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="group" aria-label="Kiểu board" className="flex shrink-0 items-center gap-1 border-b px-4 py-1.5 sm:px-6">
        {tab("lanes", "Card dự án")}
        {tab("tasks", "Task của session")}
      </div>
      <div className="min-h-0 flex-1">{mode === "lanes" ? <LanesView hq={hq} /> : <TaskBoard hq={hq} tasks={tasks} sessions={sessions} />}</div>
    </div>
  );
}

function TaskBoard({ hq, tasks, sessions }: { hq: Hq; tasks: Task[]; sessions: Session[] }) {
  const { loading, error } = hq.tasks;
  const byCol = new Map<string, Task[]>(TASK_COLUMNS.map((c) => [c.key, []]));
  for (const t of tasks) (byCol.get(t.status) ?? byCol.get("todo"))!.push(t);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NewTask hq={hq} sessions={sessions} />
      {error ? (
        <div className="p-4 sm:px-6">
          <ErrorNote what="tasks" error={error} onRetry={hq.reload.tasks} />
        </div>
      ) : !loading && tasks.length === 0 ? (
        <EmptyState icon={<KanbanSquareIcon />} title="No tasks yet">
          Tasks your sessions create (TaskCreated hooks) land in To do and move to Done when they finish. You can also
          hand one to a session above.
        </EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="grid h-full min-w-[960px] grid-cols-5 gap-3 px-4 py-4 sm:px-6">
            {TASK_COLUMNS.map((c) => {
              const list = byCol.get(c.key)!;
              return (
                <section key={c.key} aria-labelledby={`col-${c.key}`} className="flex min-h-0 flex-col rounded-xl bg-muted/50">
                  <h3 id={`col-${c.key}`} className="flex items-center gap-2 px-3 pt-3 pb-2 text-[13px] font-medium">
                    {c.label}
                    <span className="text-xs font-normal text-muted-foreground tabular">{loading ? "" : list.length}</span>
                  </h3>
                  <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
                    {loading
                      ? [0, 1].map((i) => (
                          <li key={i}>
                            <Skeleton className="h-14 rounded-lg" />
                          </li>
                        ))
                      : list.map((t) => <TaskCard key={t.task_id} t={t} />)}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const PRIO_STYLE: Record<string, string> = {
  P0: "text-destructive",
  P1: "text-st-needs",
};

function TaskCard({ t }: { t: Task }) {
  return (
    <li className="rounded-lg border bg-card px-2.5 py-2">
      <p className={cn("text-[13px] leading-snug text-pretty", t.status === "done" && "text-muted-foreground")}>
        {t.subject}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        {t.prio && <span className={cn("font-semibold", PRIO_STYLE[t.prio])}>{t.prio}</span>}
        {t.role && <span>{t.role}</span>}
        {t.session && <span className="font-mono">{shortName(t.session)}</span>}
        <span className="ml-auto tabular">{ago(t.updated_at)}</span>
      </div>
    </li>
  );
}

function NewTask({ hq, sessions }: { hq: Hq; sessions: Session[] }) {
  // Every live session HQ can reach: tmux panes, and sessions started elsewhere through their inbox.
  const targets = messageTargets(sessions);
  const [session, setSession] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [role, setRole] = useState("");
  const [prio, setPrio] = useState("P2");
  const [busy, setBusy] = useState(false);
  const target = targets.find((s) => s.name === session) ?? targets[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || !subject.trim() || target.waiting) return;
    setBusy(true);
    try {
      const r = await hq.api<{ task: Task; message: Message; delivery: string; live?: boolean; error: string | null }>("/api/tasks", {
        method: "POST",
        body: { session: addressOf(target), subject: subject.trim(), role: role.trim() || undefined, prio },
      });
      hq.mergeTasks([r.task]);
      hq.mergeMessages([r.message]);
      if (r.delivery === "failed") toast.error(`Task saved, but not delivered: ${r.error}`);
      else
        toast.success(
          `Đã giao cho ${sessionLabel(target)} ${r.delivery === "channel" ? "qua channel" : r.delivery === "inbox" ? inboxText(r.live) : "qua terminal"}`,
        );
      setSubject("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
      <label htmlFor="task-subject" className="sr-only">
        New task
      </label>
      <Input
        id="task-subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={300}
        placeholder={target ? "Hand a task to a session…" : "Start a session to hand it tasks"}
        disabled={!target}
        className="h-8 min-w-48 flex-1"
      />
      <Select value={target?.name ?? ""} onValueChange={setSession} disabled={!target}>
        <SelectTrigger size="sm" className="font-mono text-xs" aria-label="Session">
          <SelectValue placeholder="Session" />
        </SelectTrigger>
        <SelectContent>
          {targets.map((s) => (
            <SelectItem key={s.name} value={s.name} className="font-mono text-xs">
              {sessionLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label htmlFor="task-role" className="sr-only">
        Role
      </label>
      <Input
        id="task-role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        placeholder="role"
        maxLength={32}
        disabled={!target}
        className="h-8 w-24"
      />
      <Select value={prio} onValueChange={setPrio} disabled={!target}>
        <SelectTrigger size="sm" className="w-16 text-xs" aria-label="Priority">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {["P0", "P1", "P2", "P3"].map((p) => (
            <SelectItem key={p} value={p} className="text-xs">
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={!target || busy || !subject.trim() || !!target.waiting}
        title={target?.waiting ? "Claude is waiting for you in the terminal — answer it first (Open terminal)" : undefined}>
        <PlusIcon /> Add task
      </Button>
      {target?.waiting && (
        <p className="basis-full text-xs text-muted-foreground" role="status">
          Claude is waiting for you in the terminal — answer it first (Open terminal)
        </p>
      )}
    </form>
  );
}
