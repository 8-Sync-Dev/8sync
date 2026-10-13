"use client";

import { CornerDownLeftIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Api } from "./use-hq";

/** Mirrors KEY_ALLOW in lib/server/proc.ts; the server is the gate. */
const GROUPS: { label: string; keys: { id: string; cap: string; name: string }[] }[] = [
  {
    label: "Confirm or cancel",
    keys: [
      { id: "Enter", cap: "Enter", name: "Enter" },
      { id: "Esc", cap: "Esc", name: "Escape" },
    ],
  },
  {
    label: "Move",
    keys: [
      { id: "Up", cap: "↑", name: "Up arrow" },
      { id: "Down", cap: "↓", name: "Down arrow" },
      { id: "Tab", cap: "Tab", name: "Tab" },
    ],
  },
  {
    label: "Pick an option",
    keys: [
      { id: "1", cap: "1", name: "1" },
      { id: "2", cap: "2", name: "2" },
      { id: "3", cap: "3", name: "3" },
    ],
  },
  {
    label: "Yes or no",
    keys: [
      { id: "y", cap: "y", name: "y" },
      { id: "n", cap: "n", name: "n" },
    ],
  },
];

type Status = { kind: "idle" } | { kind: "sent"; what: string } | { kind: "error"; message: string };

/**
 * Answers Claude Code's terminal dialogs (folder trust, auto mode, permission
 * prompts) without opening a terminal. Each press is one POST; presses are
 * queued so a quick ↓ ↓ Enter arrives in order.
 */
export function KeyBar({
  api,
  name,
  disabled,
  onSent,
}: {
  api: Api;
  name: string;
  disabled?: boolean;
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [enter, setEnter] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputId = useId();
  const enterId = useId();
  useEffect(() => () => clearTimeout(clearTimer.current), []);

  function post(body: unknown, what: string): Promise<boolean> {
    const run = async () => {
      try {
        await api(`/api/sessions/${encodeURIComponent(name)}/keys`, { method: "POST", body });
        setStatus({ kind: "sent", what });
        clearTimeout(clearTimer.current);
        clearTimer.current = setTimeout(() => setStatus({ kind: "idle" }), 2500);
        onSent?.();
        return true;
      } catch (e) {
        setStatus({ kind: "error", message: (e as Error).message });
        return false;
      }
    };
    const p = queue.current.then(run, run);
    queue.current = p;
    return p;
  }

  async function typeText(e: FormEvent) {
    e.preventDefault();
    const t = text;
    if (!t.trim() || disabled) return;
    if (await post({ text: t, enter }, enter ? "text + Enter" : "text")) setText("");
  }

  return (
    <section aria-label={`Send keys to ${name}`} className="shrink-0 space-y-2.5 border-t pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {GROUPS.map((g) => (
          <div key={g.label} role="group" aria-label={g.label} className="flex gap-1">
            {g.keys.map((k) => (
              <Button
                key={k.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => void post({ keys: [k.id] }, k.cap)}
                aria-label={`Send ${k.name}`}
                className={cn(
                  "h-9 min-w-9 px-2 font-mono text-[13px] shadow-[inset_0_-1px_0_var(--border)] sm:h-8",
                  k.id === "Enter" && "gap-1",
                )}
              >
                {k.id === "Enter" && <CornerDownLeftIcon aria-hidden />}
                {k.cap}
              </Button>
            ))}
          </div>
        ))}
        <p
          aria-live="polite"
          className={cn(
            "min-h-5 min-w-0 flex-1 basis-40 text-right text-xs",
            status.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status.kind === "sent" && <>Sent {status.what}</>}
          {status.kind === "error" && <>Not sent: {status.message}</>}
        </p>
      </div>

      <form onSubmit={typeText} className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          Text to type into {name}
        </label>
        <Input
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, " "))}
          placeholder="Type into the terminal, e.g. a path or a short answer"
          maxLength={2000}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="h-9 min-w-48 flex-1 font-mono text-[13px] sm:h-8"
        />
        <div className="flex items-center gap-2">
          <label htmlFor={enterId} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
            <input
              id={enterId}
              type="checkbox"
              checked={enter}
              onChange={(e) => setEnter(e.target.checked)}
              disabled={disabled}
              className="size-3.5 accent-primary"
            />
            Press Enter after
          </label>
          <Button type="submit" size="sm" variant="secondary" className="h-9 sm:h-8" disabled={disabled || !text.trim()}>
            Type it
          </Button>
        </div>
      </form>
      {disabled && <p className="text-xs text-muted-foreground">The session is not running, so keys have nowhere to go.</p>}
    </section>
  );
}
