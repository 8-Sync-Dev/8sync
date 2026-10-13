"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KEY = "hq.firstrun.dismissed";
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode: the card just comes back next time */
  }
  listeners.forEach((l) => l());
}

export type FirstRunState = { hasProject: boolean; hasSession: boolean; hasChannel: boolean; orgBlocked?: boolean };

/**
 * Shown until the two required steps are done; the optional Channels step
 * can be dismissed. Each step says what to do, not just what is missing.
 */
export function FirstRun({
  state,
  onAddProject,
  onStartSession,
}: {
  state: FirstRunState;
  onAddProject: () => void;
  onStartSession: () => void;
}) {
  const dismissed = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    readDismissed,
    () => false,
  );
  const required = state.hasProject && state.hasSession;
  if (required && (state.hasChannel || dismissed)) return null;

  const steps = [
    {
      done: state.hasProject,
      title: "Add a project folder",
      body: "Paste the absolute path of a repo in the sidebar. Sessions start inside it.",
      action: !state.hasProject && (
        <Button size="sm" onClick={onAddProject}>
          Add folder
        </Button>
      ),
    },
    {
      done: state.hasSession,
      title: "Start a session",
      body: "Runs the official claude CLI in a tmux session named hq-<name> on this machine.",
      action: state.hasProject && !state.hasSession && (
        <Button size="sm" onClick={onStartSession}>
          Start session
        </Button>
      ),
    },
    {
      done: state.hasChannel,
      optional: true,
      title: "Enable Channels for two-way chat",
      body: state.orgBlocked ? (
        <>
          Your Claude org has Channels turned off, so messages are typed into the terminal and replies arrive when a
          turn ends. An org Owner can enable Channels in claude.ai → Org settings → Claude Code; then start a new
          session.
        </>
      ) : (
        <>
          Run <code className="rounded bg-muted px-1 font-mono text-[12px]">pnpm run mcp-config</code> in{" "}
          <code className="rounded bg-muted px-1 font-mono text-[12px]">apps/hq-channel</code>, then start a new session.
          Replies come back here. Without it, your messages are typed into the session&apos;s terminal.
        </>
      ),
    },
  ];

  return (
    <section aria-labelledby="first-run-title" className="relative rounded-xl border bg-card px-4 py-4 sm:px-5">
      {required && (
        <Button
          size="icon-sm"
          variant="ghost"
          className="absolute top-2 right-2 text-muted-foreground"
          onClick={dismiss}
          aria-label="Hide setup checklist"
        >
          <XIcon />
        </Button>
      )}
      <h2 id="first-run-title" className="text-sm font-semibold">
        Set up your team
      </h2>
      <ol className="mt-3 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular",
                s.done ? "border-transparent bg-st-running text-white dark:text-black" : "text-muted-foreground",
              )}
            >
              {s.done ? <CheckIcon className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through decoration-1")}>
                {s.title}
                {s.optional && <span className="ml-1.5 font-normal text-muted-foreground">(optional)</span>}
                <span className="sr-only">{s.done ? ", done" : ", to do"}</span>
              </p>
              {!s.done && <p className="mt-0.5 max-w-prose text-[13px] text-pretty text-muted-foreground">{s.body}</p>}
            </div>
            {!s.done && s.action && <div className="shrink-0 self-center">{s.action}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
