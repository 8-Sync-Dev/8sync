"use client";

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChannelNotice, WaitingBadge } from "./bits";
import { KeyBar } from "./key-bar";
import type { Session } from "./types";
import { ApiError, type Api } from "./use-hq";

const REFRESH_MS = 1500;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const THEMES = {
  dark: { background: "#00000000", foreground: "#e6e6e6", cursor: "#00000000" },
  light: { background: "#00000000", foreground: "#1f1f1f", cursor: "#00000000", black: "#1f1f1f", white: "#6b6b6b", brightWhite: "#404040" },
};

type PaneState = "loading" | "ok" | "gone" | "error";

/**
 * The drawer body: what the session is waiting on, how messages reach it, the
 * live pane, and the key bar that answers Claude Code's dialogs.
 */
export function TerminalPanel({ api, name, session }: { api: Api; name: string; session?: Session }) {
  const [nudge, setNudge] = useState(0);
  const [state, setState] = useState<PaneState>("loading");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {(session?.waiting || session?.channel_state) && (
        <div className="space-y-2">
          {session.waiting && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <WaitingBadge what={session.waiting} />
              <span className="text-muted-foreground">{session.waiting} Answer with the keys below.</span>
            </p>
          )}
          <ChannelNotice state={session.channel_state} />
        </div>
      )}
      <TerminalView api={api} name={name} nudge={nudge} onState={setState} />
      <KeyBar api={api} name={name} disabled={state === "gone"} onSent={() => setNudge((n) => n + 1)} />
    </div>
  );
}

/**
 * Live view of a tmux pane: `capture-pane -p -e` every 1.5 s (sooner after a
 * key is sent), written into an xterm with stdin disabled. Input goes through
 * the key bar only, never through this element.
 */
export function TerminalView({
  api,
  name,
  nudge = 0,
  onState,
}: {
  api: Api;
  name: string;
  nudge?: number;
  onState?: (s: PaneState) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const [state, setState] = useState<PaneState>("loading");
  const refresh = useRef<() => void>(() => {});
  const [error, setError] = useState("");
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? THEMES.light : THEMES.dark;
  const themeRef = useRef(theme);

  useEffect(() => onState?.(state), [state, onState]);

  // After a key is sent, show its effect without waiting for the next tick.
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => refresh.current(), 250);
    return () => clearTimeout(t);
  }, [nudge]);

  useEffect(() => {
    themeRef.current = theme;
    if (term.current) term.current.options.theme = theme;
  }, [theme]);

  useEffect(() => {
    let alive = true;
    let last = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    const ac = new AbortController();

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      if (!alive || !host.current) return;
      const t = new Terminal({
        disableStdin: true,
        convertEol: true,
        cursorBlink: false,
        cursorInactiveStyle: "none",
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace",
        fontSize: 12,
        lineHeight: 1.15,
        scrollback: 0,
        allowTransparency: true,
        theme: themeRef.current,
      });
      t.open(host.current);
      term.current = t;

      const tick = async () => {
        // One loop only: a nudge during a fetch is covered by that fetch.
        if (busy) return;
        busy = true;
        clearTimeout(timer);
        try {
          const r = await api<{ text: string }>(`/api/sessions/${encodeURIComponent(name)}/screen`, { signal: ac.signal });
          if (!alive) return;
          if (r.text !== last) {
            last = r.text;
            const lines = r.text.replace(/\n+$/, "").split("\n");
            const cols = Math.min(240, Math.max(80, ...lines.map((l) => l.replace(ANSI, "").length)));
            t.resize(cols, Math.max(10, lines.length));
            t.reset();
            t.write(lines.join("\n"));
          }
          setState("ok");
        } catch (e) {
          if (!alive) return;
          if (e instanceof ApiError && e.status === 404) setState("gone");
          else {
            setError((e as Error).message);
            setState("error");
          }
        }
        busy = false;
        clearTimeout(timer);
        if (alive) timer = setTimeout(tick, REFRESH_MS);
      };
      refresh.current = () => void tick();
      void tick();
    })();

    return () => {
      alive = false;
      ac.abort();
      clearTimeout(timer);
      term.current?.dispose();
      term.current = null;
    };
  }, [api, name]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {state === "loading" && (
        <div className="absolute inset-0 space-y-2 p-4" aria-busy="true">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      )}
      {state === "gone" && (
        <p className="p-4 text-sm text-muted-foreground">This tmux session is no longer running.</p>
      )}
      {state === "error" && (
        <p role="alert" className="p-4 text-sm text-destructive">
          Could not read the pane: {error}. Retrying.
        </p>
      )}
      <div
        ref={host}
        role="img"
        aria-label={`Live terminal view of ${name}`}
        className="hq-term min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/40"
      />
    </div>
  );
}
