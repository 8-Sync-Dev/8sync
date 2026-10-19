"use client";

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isLocalHost } from "@/lib/hosts";

/** Remote link: poll gap while the room prints, and while it is quiet. */
const POLL_BUSY_MS = 150;
const POLL_IDLE_MS = 600;
/** Remote link: polls in a row that may fail (tunnel hiccup) before the terminal says so. */
const POLL_TRIES = 5;

const FONT_SIZE = 13;
const THEMES = {
  dark: { background: "#0b0c0e", foreground: "#e6e6e6", cursor: "#e6e6e6" },
  light: { background: "#fbfbfa", foreground: "#1f1f1f", cursor: "#1f1f1f", selectionBackground: "#00000022" },
};

type State = "connecting" | "live" | "ended" | "error";

/** Columns and rows that fit `el` for a monospace cell measured once in the page's mono font. */
function fit(el: HTMLElement, font: string): { cols: number; rows: number } {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${FONT_SIZE}px ${font};line-height:normal`;
  probe.textContent = "W".repeat(50);
  document.body.appendChild(probe);
  const cw = probe.getBoundingClientRect().width / 50 || 8;
  const ch = probe.getBoundingClientRect().height || 16;
  probe.remove();
  return { cols: Math.max(20, Math.floor((el.clientWidth - 16) / cw)), rows: Math.max(8, Math.floor((el.clientHeight - 8) / ch)) };
}

/** Decode SSE `data:` lines of `event: out` (base64 bytes) as they arrive. */
function parseSse(buf: string): { events: { event: string; data: string }[]; rest: string } {
  const events: { event: string; data: string }[] = [];
  let i: number;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const block = buf.slice(0, i);
    buf = buf.slice(i + 2);
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    events.push({ event, data });
  }
  return { events, rest: buf };
}
export { parseSse };

/** One poll of the remote terminal (`GET /term?gen=&since=`), `out` in base64. */
type PollJson = { gen: number; cursor: number; out: string; reset: boolean; ended: boolean };

function isPoll(v: unknown): v is PollJson {
  return !!v && typeof v === "object" && "gen" in v && typeof v.gen === "number" && "cursor" in v && typeof v.cursor === "number" && "out" in v && typeof v.out === "string" && "reset" in v && "ended" in v;
}

/** A refusal polling again will not fix (no room, bad token): shown at once. */
class PollRefused extends Error {}

async function errorOf(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
}

/**
 * A background room's real terminal in the page (`claude attach` through `8sync ccc term`): type,
 * pick an answer with the arrow keys and Enter, scroll back. Closing it only detaches; the room runs on.
 */
export function LiveTerminal({ sessionId, token, onEnded }: { sessionId: string; token: string; onEnded?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ac = new AbortController();
    let term: Terminal | null = null;
    let ro: ResizeObserver | null = null;
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/term`;
    const headers = { "x-hq-token": token, "content-type": "application/json" };
    const post = (body: object) => fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal }).catch(() => {});
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      if (ac.signal.aborted) return;
      const size = fit(el, font);
      term = new Terminal({ cols: size.cols, rows: size.rows, fontFamily: font, fontSize: FONT_SIZE, cursorBlink: true, scrollback: 5000, theme: dark ? THEMES.dark : THEMES.light, allowProposedApi: false });
      term.open(el);
      term.focus();
      term.onData((data) => void post({ data }));
      let last = size;
      ro = new ResizeObserver(() => {
        const s = fit(el, font);
        if (!term || (s.cols === last.cols && s.rows === last.rows)) return;
        last = s;
        term.resize(s.cols, s.rows);
        void post(s);
      });
      ro.observe(el);
      // Through the remote link (Cloudflare quick tunnel) an event stream is held back, so off
      // loopback the page polls `?gen=&since=` instead; keys and sizes go over POST either way.
      const remote = !isLocalHost(window.location.host);
      try {
        if (remote) {
          let gen = 0;
          let since = -1;
          let fails = 0;
          while (!ac.signal.aborted) {
            let p: PollJson;
            try {
              const res = await fetch(`${url}?cols=${last.cols}&rows=${last.rows}&gen=${gen}&since=${since}`, { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" });
              if (!res.ok) throw res.status < 500 ? new PollRefused(await errorOf(res)) : new Error(await errorOf(res));
              const body: unknown = await res.json();
              if (!isPoll(body)) throw new Error("terminal: bad reply");
              p = body;
              fails = 0;
            } catch (e) {
              if (ac.signal.aborted || e instanceof PollRefused || ++fails >= POLL_TRIES) throw e;
              await new Promise((r) => setTimeout(r, POLL_IDLE_MS));
              continue;
            }
            setState("live");
            if (p.reset) term.reset();
            if (p.out) term.write(Uint8Array.from(atob(p.out), (c) => c.charCodeAt(0)));
            gen = p.gen;
            since = p.cursor;
            if (p.ended) {
              setState("ended");
              onEnded?.();
              return;
            }
            await new Promise((r) => setTimeout(r, p.out ? POLL_BUSY_MS : POLL_IDLE_MS));
          }
          return;
        }
        const res = await fetch(`${url}?cols=${size.cols}&rows=${size.rows}`, { headers: { "x-hq-token": token }, signal: ac.signal });
        if (!res.ok || !res.body) throw new Error(await errorOf(res));
        setState("live");
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let rest = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const p = parseSse(rest + value);
          rest = p.rest;
          for (const e of p.events) {
            if (e.event === "out") term.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
            else if (e.event === "end") {
              setState("ended");
              onEnded?.();
            }
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          setError((e as Error).message);
          setState("error");
        }
      }
    })();

    return () => {
      ac.abort();
      ro?.disconnect();
      term?.dispose();
    };
    // `retry` reconnects; theme changes recreate the terminal (the server replays the screen).
  }, [sessionId, token, dark, retry, onEnded]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <span className={state === "live" ? "size-2 rounded-full bg-st-running" : state === "error" ? "size-2 rounded-full bg-destructive" : "size-2 rounded-full bg-st-idle"} aria-hidden />
        {state === "connecting" && "Đang nối vào phòng…"}
        {state === "live" && "Đang nối: gõ, mũi tên và Enter đi thẳng vào phòng. Đóng khung này phòng vẫn chạy."}
        {state === "ended" && "Đã rời phòng (phòng vẫn chạy nền)."}
        {state === "error" && `Không nối được: ${error}`}
        {(state === "ended" || state === "error") && (
          <Button type="button" size="sm" variant="outline" className="ml-auto h-7" onClick={() => setRetry((n) => n + 1)}>
            Nối lại
          </Button>
        )}
      </div>
      <div ref={host} className="min-h-[320px] flex-1 overflow-hidden rounded-lg border bg-[#fbfbfa] p-2 dark:bg-[#0b0c0e]" aria-label="Terminal của phòng" />
    </div>
  );
}
