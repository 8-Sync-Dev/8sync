"use client";

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isLocalHost } from "@/lib/hosts";

/** Off loopback: no byte (not even the opening ping) this long = the proxy holds the stream back, so poll. */
const FIRST_BYTE_MS = 4000;
/** Polling: gap while the terminal prints, and while it is quiet. */
const POLL_BUSY_MS = 150;
const POLL_IDLE_MS = 600;
/** Polling: polls in a row that may fail (tunnel hiccup) before the terminal says so. */
const POLL_TRIES = 5;

/** Keys a phone keyboard lacks; arrows follow the terminal's cursor-key mode. */
const KEYS: { label: string; aria: string; seq: string | ((app: boolean) => string) }[] = [
  { label: "Esc", aria: "Escape", seq: "\x1b" },
  { label: "Tab", aria: "Tab", seq: "\t" },
  { label: "↑", aria: "Mũi tên lên", seq: (a) => (a ? "\x1bOA" : "\x1b[A") },
  { label: "↓", aria: "Mũi tên xuống", seq: (a) => (a ? "\x1bOB" : "\x1b[B") },
  { label: "←", aria: "Mũi tên trái", seq: (a) => (a ? "\x1bOD" : "\x1b[D") },
  { label: "→", aria: "Mũi tên phải", seq: (a) => (a ? "\x1bOC" : "\x1b[C") },
  { label: "Enter", aria: "Enter", seq: "\r" },
  { label: "^C", aria: "Ctrl+C", seq: "\x03" },
  { label: "^D", aria: "Ctrl+D", seq: "\x04" },
  { label: "^R", aria: "Ctrl+R", seq: "\x12" },
  { label: "^L", aria: "Ctrl+L", seq: "\x0c" },
];

const TEXT = {
  room: {
    connecting: "Đang nối vào phòng…",
    live: "Đang nối: gõ, mũi tên và Enter đi thẳng vào phòng. Đóng khung này phòng vẫn chạy.",
    ended: "Đã rời phòng (phòng vẫn chạy nền).",
    hint: "↑↓ chọn · Enter xác nhận · Esc huỷ · số = chọn nhanh",
    label: "Terminal của phòng",
  },
  shell: {
    connecting: "Đang mở shell trên máy…",
    live: "Shell trên máy anh: lệnh chạy thật như ở terminal. Đóng khung vẫn giữ shell 30 phút.",
    ended: "Shell đã thoát.",
    hint: "Tab gợi ý/hoàn thành · → nhận gợi ý xám · ↑ lệnh trước · ^R tìm lịch sử · ^C dừng lệnh",
    label: "Shell trên máy",
  },
};

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

/** `url` plus one more query part. */
const withQuery = (url: string, q: string) => `${url}${url.includes("?") ? "&" : "?"}${q}`;

/**
 * A real terminal in the page: a background room (`claude attach`, `kind="room"`) or the owner's shell
 * (`kind="shell"`), both through `8sync ccc term`. Type, pick with the arrow keys and Enter, scroll
 * back; a key bar covers keys a phone lacks. Closing it only detaches.
 */
export function LiveTerminal({ url, kind = "room", token, onEnded }: { url: string; kind?: "room" | "shell"; token: string; onEnded?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const keysRef = useRef<((data: string) => void) | null>(null);
  const appKeys = useRef<() => boolean>(() => false);
  const [state, setState] = useState<State>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const text = TEXT[kind];

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ac = new AbortController();
    let term: Terminal | null = null;
    let ro: ResizeObserver | null = null;
    const headers = { "x-hq-token": token, "content-type": "application/json" };
    const post = (body: object) => fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal }).catch(() => {});
    keysRef.current = (data) => void post({ data });
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      if (ac.signal.aborted) return;
      const size = fit(el, font);
      const t = new Terminal({ cols: size.cols, rows: size.rows, fontFamily: font, fontSize: FONT_SIZE, cursorBlink: true, scrollback: 5000, theme: dark ? THEMES.dark : THEMES.light, allowProposedApi: false });
      term = t;
      appKeys.current = () => t.modes.applicationCursorKeysMode;
      t.open(el);
      t.focus();
      t.onData((data) => void post({ data }));
      let last = size;
      ro = new ResizeObserver(() => {
        const s = fit(el, font);
        if (s.cols === last.cols && s.rows === last.rows) return;
        last = s;
        t.resize(s.cols, s.rows);
        void post(s);
      });
      ro.observe(el);
      const write = (b64: string) => t.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const end = () => {
        setState("ended");
        onEnded?.();
      };
      // Off loopback the stream may be held back by the proxy (a Cloudflare quick tunnel does; the VPS
      // gate does not): the server pings at once, so no byte within FIRST_BYTE_MS means poll instead.
      const remote = !isLocalHost(window.location.host);
      const stream = async (): Promise<"silent" | "done"> => {
        const conn = new AbortController();
        const stop = () => conn.abort();
        ac.signal.addEventListener("abort", stop, { once: true });
        let silent = false;
        const dog = remote
          ? setTimeout(() => {
              silent = true;
              conn.abort();
            }, FIRST_BYTE_MS)
          : undefined;
        try {
          const res = await fetch(withQuery(url, `cols=${size.cols}&rows=${size.rows}`), { headers: { "x-hq-token": token }, signal: conn.signal, cache: "no-store" });
          if (!res.ok || !res.body) throw new Error(await errorOf(res));
          if (!remote) setState("live");
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let rest = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            clearTimeout(dog);
            setState("live");
            const p = parseSse(rest + value);
            rest = p.rest;
            for (const e of p.events) {
              if (e.event === "out") write(e.data);
              else if (e.event === "end") end();
            }
          }
        } catch (e) {
          if (silent && !ac.signal.aborted) return "silent";
          throw e;
        } finally {
          clearTimeout(dog);
          ac.signal.removeEventListener("abort", stop);
        }
        return "done";
      };
      const poll = async () => {
        let gen = 0;
        let since = -1;
        let fails = 0;
        while (!ac.signal.aborted) {
          let p: PollJson;
          try {
            const res = await fetch(withQuery(url, `cols=${last.cols}&rows=${last.rows}&gen=${gen}&since=${since}`), { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" });
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
          if (p.reset) t.reset();
          if (p.out) write(p.out);
          gen = p.gen;
          since = p.cursor;
          if (p.ended) return end();
          await new Promise((r) => setTimeout(r, p.out ? POLL_BUSY_MS : POLL_IDLE_MS));
        }
      };
      try {
        if ((await stream()) === "silent") await poll();
      } catch (e) {
        if (!ac.signal.aborted) {
          setError((e as Error).message);
          setState("error");
        }
      }
    })();

    return () => {
      ac.abort();
      keysRef.current = null;
      ro?.disconnect();
      term?.dispose();
    };
    // `retry` reconnects; theme changes recreate the terminal (the server replays the screen).
  }, [url, token, dark, retry, onEnded]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <span className={state === "live" ? "size-2 rounded-full bg-st-running" : state === "error" ? "size-2 rounded-full bg-destructive" : "size-2 rounded-full bg-st-idle"} aria-hidden />
        {state === "connecting" && text.connecting}
        {state === "live" && text.live}
        {state === "ended" && text.ended}
        {state === "error" && `Không nối được: ${error}`}
        {(state === "ended" || state === "error") && (
          <Button type="button" size="sm" variant="outline" className="ml-auto h-7" onClick={() => setRetry((n) => n + 1)}>
            Nối lại
          </Button>
        )}
      </div>
      <div ref={host} className="min-h-[200px] flex-1 overflow-hidden rounded-lg border bg-[#fbfbfa] p-2 dark:bg-[#0b0c0e]" aria-label={text.label} />
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Phím terminal">
        {KEYS.map((k) => (
          <Button
            key={k.label}
            type="button"
            size="sm"
            variant="outline"
            className="h-7 min-w-9 px-2 font-mono text-xs"
            aria-label={k.aria}
            disabled={state !== "live"}
            onClick={() => keysRef.current?.(typeof k.seq === "string" ? k.seq : k.seq(appKeys.current()))}
          >
            {k.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{text.hint}</p>
    </div>
  );
}
