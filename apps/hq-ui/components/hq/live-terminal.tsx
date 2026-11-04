"use client";

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "./mention-textarea";
import { makeApi } from "./use-hq";
import { lineBytes } from "@/lib/term-input";
import { cn } from "@/lib/utils";
import { TOUCH } from "./room-send";
import { FILES_MAX, fileError, toBase64 } from "@/lib/attach";
import { isLocalHost } from "@/lib/hosts";
import type { ActivityEvent } from "@/lib/server/activity";
import { activityScreen } from "@/lib/term-activity";
import { afterStream, giveUp, heldBack, keyboardOpen, keyQueue, pingTime, retryDelay, STALE_MS, termRows } from "@/lib/term-stream";

/** Off loopback: no byte (not even the opening ping) this long = the proxy holds the stream back, so poll. */
const FIRST_BYTE_MS = 4000;
/** Loopback: a stream with no byte this long (HQ pings every 2 s) is dead even if still open. */
const STALL_MS = 40_000;
/** Polling: each poll is held by HQ until output arrives (at most this long), so the page asks again at once. */
const POLL_WAIT_MS = 20_000;
/** A poll answered this fast with nothing new was not held (HQ restarting, an old HQ): wait before asking again. */
const POLL_FAST_MS = 100;
const POLL_IDLE_MS = 600;
/** Read-only view (an omp session open in another terminal): how often its Nhật ký is read again. */
const READ_ONLY_MS = 2000;

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
    dead: "Phiên đã tắt hẳn trên máy — phòng không còn chạy nền. Mở lại bằng “Mở lại team” của dự án này, hoặc bỏ qua.",
    exited: "omp trên máy đã thoát hoặc bị crash — terminal này dừng ở đây. Bấm Nối lại để mở lại phiên (lịch sử vẫn giữ).",
    lost: "Phím vừa gõ chưa tới máy (terminal đã đóng) — bấm Nối lại rồi gõ lại.",
    hint: "↑↓ chọn · Enter xác nhận · Esc huỷ · số = chọn nhanh",
    label: "Terminal của phòng",
  },
  shell: {
    connecting: "Đang mở shell trên máy…",
    live: "Shell trên máy anh: lệnh chạy thật như ở terminal. Đóng khung vẫn giữ shell 30 phút.",
    ended: "Shell đã thoát.",
    dead: "Shell đã thoát.",
    exited: "Shell đã thoát.",
    lost: "Phím vừa gõ chưa tới shell (shell đã đóng) — bấm Nối lại rồi gõ lại.",
    hint: "Tab gợi ý/hoàn thành · → nhận gợi ý xám · ↑ lệnh trước · ^R tìm lịch sử · ^C dừng lệnh",
    label: "Shell trên máy",
  },
};

const FONT_SIZE = 13;
/** The HQ page colours (zinc #09090b, brand-lime cursor, GitHub-dark ANSI); the frame's background below is the same colour. */
const THEMES = {
  dark: {
    background: "#09090b",
    foreground: "#e6edf3",
    cursor: "#85d840",
    cursorAccent: "#09090b",
    selectionBackground: "#85d84040",
    black: "#27272a",
    red: "#f85149",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ff7b72",
    brightGreen: "#85d840",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  },
  // GitHub-light ANSI: a TUI's yellow or bright white stays readable on the white frame (the light theme is the default).
  light: {
    background: "#ffffff",
    foreground: "#1c1d1a",
    cursor: "#336d00",
    cursorAccent: "#ffffff",
    selectionBackground: "#336d0026",
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#7a5000",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#1a7f37",
    brightYellow: "#633c01",
    brightBlue: "#0550ae",
    brightMagenta: "#6639ba",
    brightCyan: "#1b7c83",
    brightWhite: "#8c959f",
  },
};

/** `elsewhere`: an omp room whose session is open in another terminal on the PC (HQ offers the takeover). */
type State = "connecting" | "live" | "ended" | "error" | "elsewhere";

type Cell = { w: number; h: number };

/** A monospace cell estimated in the page's mono font, before xterm has rendered one. */
function probeCell(font: string): Cell {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${FONT_SIZE}px ${font};line-height:normal`;
  probe.textContent = "W".repeat(50);
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { w: r.width / 50 || 8, h: r.height || 16 };
}

/** The cell xterm actually draws (its row height is not the font's `line-height:normal`), or `null` before the first render. */
function xtermCell(el: HTMLElement, cols: number, rows: number): Cell | null {
  const r = el.querySelector(".xterm-screen")?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { w: r.width / cols, h: r.height / rows } : null;
}

/**
 * Columns and rows of `cell` that fit inside `el`'s padding: none of the last rows hides under the
 * box's bottom edge. A box being removed (sheet closing) has no computed padding: never NaN, which
 * xterm's `resize` throws on.
 */
function fit(el: HTMLElement, cell: Cell): { cols: number; rows: number } {
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const whole = (n: number) => (Number.isFinite(n) ? Math.floor(n) : 0);
  const w = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
  const h = el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
  return { cols: Math.max(20, whole(w / cell.w)), rows: termRows(whole(h / cell.h), null, false) };
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
type PollJson = { gen: number; cursor: number; out: string; reset: boolean; answered?: boolean; ended: boolean; elsewhere?: boolean; dead?: boolean; exited?: boolean };

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
 * A real terminal in the page: a background room (`claude attach`, or an omp room's host;
 * `kind="room"`) or the owner's shell (`kind="shell"`), both through `8sync ccc term`. Type, pick
 * with the arrow keys and Enter, scroll back; a key bar covers keys a phone lacks. Closing it only
 * detaches. The input line shows at every width: typing into xterm works too, but the line (Enter/Gửi,
 * history, key bar) is the same everywhere, so a pane does not change shape when the window is resized.
 */
export function LiveTerminal({ url, kind = "room", token, cwd = null, onEnded }: { url: string; kind?: "room" | "shell"; token: string; /** Folder of "@path" picks; null = no "@" picker. */ cwd?: string | null; onEnded?: () => void }) {
  const api = useMemo(() => makeApi(token), [token]);
  const host = useRef<HTMLDivElement>(null);
  const keysRef = useRef<((data: string) => void) | null>(null);
  const appKeys = useRef<() => boolean>(() => false);
  const sizeRef = useRef({ cols: 120, rows: 34 });
  const view = useRef<Terminal | null>(null);
  const [state, setState] = useState<State>("connecting");
  const [dead, setDead] = useState(false);
  /** The bridge ended because omp itself ended on the PC (exit or crash), or typed keys did not reach it. */
  const [stopped, setStopped] = useState<"exited" | "lost" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [moving, setMoving] = useState(false);
  const [line, setLine] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  /** The image upload in flight or the reason it failed; null when idle. */
  const [note, setNote] = useState<{ busy: boolean; text: string } | null>(null);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const text = TEXT[kind];

  /**
   * Images (picked or pasted) go into the room's repo like a chat attachment; their paths land in
   * the input line, so the owner adds a question and sends, and the room opens them with Read.
   */
  async function attach(list: File[]) {
    if (uploading.current) return setNote({ busy: true, text: "Đang tải ảnh trước: xong rồi chọn hoặc dán lại ảnh này" });
    const files = list.filter((f) => f.type.startsWith("image/")).slice(0, FILES_MAX);
    if (!files.length) return setNote({ busy: false, text: "Chỉ gửi được ảnh" });
    const why = files.map(fileError).find(Boolean);
    if (why) return setNote({ busy: false, text: why });
    uploading.current = true;
    setNote({ busy: true, text: `Đang tải ${files.length} ảnh…` });
    const headers = { "x-hq-token": token, "content-type": "application/json" };
    try {
      const ids: string[] = [];
      for (const f of files) {
        const res = await fetch("/api/uploads", { method: "POST", headers, body: JSON.stringify({ name: f.name || "anh-dan.png", data: await toBase64(f) }) });
        if (!res.ok) throw new Error(await errorOf(res));
        ids.push(((await res.json()) as { id: string }).id);
      }
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ files: ids }) });
      if (!res.ok) throw new Error(await errorOf(res));
      const { paths } = (await res.json()) as { paths: string[] };
      setLine((l) => [l.trimEnd(), ...paths.map((p) => (/\s/.test(p) ? `"${p}"` : p))].filter(Boolean).join(" ") + " ");
      setNote(null);
    } catch (e) {
      setNote({ busy: false, text: `Không gửi được ảnh: ${(e as Error).message}` });
    } finally {
      uploading.current = false;
    }
  }

  /** "Chuyển sang HQ": the server ends the other terminal's omp for this session and opens it here; then reconnect. */
  const movingRef = useRef(false);
  async function takeover() {
    if (movingRef.current) return;
    movingRef.current = true;
    setMoving(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "x-hq-token": token, "content-type": "application/json" }, body: JSON.stringify({ takeover: true, ...sizeRef.current }) });
      if (!res.ok) throw new Error(await errorOf(res));
      setState("connecting");
      setRetry((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    } finally {
      movingRef.current = false;
      setMoving(false);
    }
  }
  // Typing into the read-only view switches it here (owner 2026-11-03: the button every time was a
  // chore); the key itself is not sent, omp is not up yet.
  const takeoverRef = useRef(takeover);
  useEffect(() => {
    takeoverRef.current = takeover;
  });

  // The session is open in another terminal: show what omp is doing, read only — its Nhật ký
  // (`/activity`: secrets masked, shell commands by intent), redrawn when it changes.
  useEffect(() => {
    if (state !== "elsewhere") return;
    const ac = new AbortController();
    const activity = url.replace(/\/term$/, "/activity?limit=80");
    let shown = "";
    const tick = async () => {
      try {
        const res = await fetch(activity, { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { events?: ActivityEvent[] };
        const screen = activityScreen(body.events ?? []);
        if (screen !== shown && view.current) {
          shown = screen;
          view.current.write(screen);
        }
      } catch {
        /* the next tick tries again */
      }
    };
    void tick();
    const every = setInterval(() => void tick(), READ_ONLY_MS);
    return () => {
      ac.abort();
      clearInterval(every);
    };
    // `dark`: a theme change recreates the terminal, so the view is drawn again.
  }, [state, url, token, dark]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ac = new AbortController();
    let term: Terminal | null = null;
    let ro: ResizeObserver | null = null;
    const headers = { "x-hq-token": token, "content-type": "application/json" };
    // Keys go in typed order, one POST at a time (lib/term-stream.ts keyQueue); keys HQ refused (the
    // bridge closed under them) say so instead of vanishing.
    const keys = keyQueue(
      (data) =>
        fetch(url, { method: "POST", headers, body: JSON.stringify({ data }), signal: ac.signal }).then(
          (r) => r.ok,
          () => ac.signal.aborted,
        ),
      () => {
        if (!ac.signal.aborted) setStopped((s) => s ?? "lost");
      },
    );
    const post = (body: object) => fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal }).catch(() => {});
    keysRef.current = keys;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      if (ac.signal.aborted) return;
      let cell = probeCell(font);
      let size = fit(el, cell);
      const t = new Terminal({ cols: size.cols, rows: size.rows, fontFamily: font, fontSize: FONT_SIZE, cursorBlink: true, scrollback: 5000, theme: dark ? THEMES.dark : THEMES.light, allowProposedApi: false });
      term = t;
      view.current = t;
      appKeys.current = () => t.modes.applicationCursorKeysMode;
      t.open(el);
      // xterm's rows are taller than the probe's line (17.6 vs 17 px at 13 px): sized by the probe, the
      // last rows (omp's prompt and status line) sat under the box's bottom edge. Re-fit to its own cell
      // before the room is opened with this size.
      cell = xtermCell(el, size.cols, size.rows) ?? cell;
      const real = fit(el, cell);
      if (real.cols !== size.cols || real.rows !== size.rows) {
        size = real;
        t.resize(size.cols, size.rows);
      }
      sizeRef.current = size;
      t.focus();
      // While a replay is written, xterm's answers to the queries in it (ConPTY's `ESC[6n`…) are
      // dropped: they were answered when the bytes were live, and a second answer types junk.
      let muted = 0;
      // A read-only view (the session is open in another terminal) sends no keys: a typed key (not
      // a terminal answer, which starts with ESC) moves the session here instead.
      let readOnly = false;
      t.onData((data) => {
        if (muted) return;
        if (!readOnly) return keys(data);
        if (data && !data.startsWith("\x1b")) void takeoverRef.current();
      });
      let last = size;
      // MIN_ROWS can be taller than a phone's box: the box scrolls, and stays at its bottom (the
      // prompt and status line) unless the owner scrolled up to read.
      const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 4;
      const toBottom = () => {
        el.scrollTop = el.scrollHeight;
      };
      ro = new ResizeObserver(() => {
        // A hidden box (other tab, sheet closing) is 0×0: shrinking the room to 20 columns would
        // rewrap it for every other viewer.
        if (!el.isConnected || !el.clientWidth || !el.clientHeight) return;
        const f = fit(el, xtermCell(el, t.cols, t.rows) ?? cell);
        // A phone keyboard makes the box short: keep the rows (the box scrolls) so a question's options stay whole.
        const s = { cols: f.cols, rows: termRows(f.rows, last.rows, keyboardOpen(window.visualViewport?.height, window.innerHeight)) };
        if (s.cols === last.cols && s.rows === last.rows) return toBottom();
        last = s;
        sizeRef.current = s;
        t.resize(s.cols, s.rows);
        toBottom();
        void post(s);
      });
      ro.observe(el);
      const write = (b64: string, replay = false) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const stick = replay || atBottom();
        if (replay) muted++;
        t.write(bytes, () => {
          if (replay) muted--;
          if (stick) toBottom();
        });
      };
      const end = (elsewhere = false, gone = false, exited = false) => {
        readOnly = elsewhere;
        setState(elsewhere ? "elsewhere" : "ended");
        if (gone) setDead(true);
        if (exited) setStopped("exited");
        if (!elsewhere) onEnded?.();
      };
      // Off loopback the stream may be held back by the proxy (a Cloudflare quick tunnel does; the VPS
      // gate does not): the server pings at once, so no byte within FIRST_BYTE_MS means poll instead.
      // A tunnel can also pass it in batches (lib/term-stream.ts heldBack): after the first bytes, quiet
      // for STALE_MS (HQ pings every 2 s) or a ping that came late also means poll.
      const remote = !isLocalHost(window.location.host);
      const stream = async (): Promise<"silent" | "done"> => {
        const conn = new AbortController();
        const stop = () => conn.abort();
        ac.signal.addEventListener("abort", stop, { once: true });
        let silent = false;
        let ended = false;
        // Remote: no byte within FIRST_BYTE_MS (held back) means poll; after that, quiet for STALE_MS or a
        // late ping (a tunnel passing the stream in batches) means poll. Loopback: a stream quiet for
        // STALL_MS is a dead connection that still looks open: drop it and poll rather than show a frozen screen.
        const held = () => {
          silent = true;
          conn.abort();
        };
        const late = heldBack();
        let dog: ReturnType<typeof setTimeout> | undefined;
        const arm = (ms: number) => {
          clearTimeout(dog);
          dog = setTimeout(held, ms);
        };
        arm(remote ? FIRST_BYTE_MS : STALL_MS);
        try {
          const res = await fetch(withQuery(url, `cols=${size.cols}&rows=${size.rows}`), { headers: { "x-hq-token": token }, signal: conn.signal, cache: "no-store" });
          if (!res.ok || !res.body) throw res.status < 500 && !res.ok ? new PollRefused(await errorOf(res)) : new Error(await errorOf(res));
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let rest = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            arm(remote ? STALE_MS : STALL_MS);
            const p = parseSse(rest + value);
            rest = p.rest;
            for (const e of p.events) {
              // "live" once the screen has something to show, not on the opening ping: a bridge still
              // starting its room stays "connecting" rather than a blank pane marked connected.
              if (e.event === "out" || e.event === "replay") setState("live");
              if (e.event === "out") write(e.data);
              else if (e.event === "replay") write(e.data, true);
              else if (e.event === "ping" && remote) {
                const t = pingTime(e.data);
                if (t != null && late(t, Date.now())) held();
              } else if (e.event === "end") {
                ended = true;
                end(e.data.includes('"elsewhere":true'), e.data.includes('"dead":true'), e.data.includes('"exited":true'));
              }
            }
          }
        } catch (e) {
          // A tunnel flushes what it held when HQ closes the stream, so late pings can come with `end`: the end wins.
          if (silent && !ended && !ac.signal.aborted) return "silent";
          // A drop after the first bytes (ssh tunnel, proxy): poll on instead of giving up (lib/term-stream.ts).
          const next = afterStream({ remote, aborted: ac.signal.aborted, refused: e instanceof PollRefused, ended, threw: true });
          if (next === "poll") return "silent";
          if (next === "done") return "done";
          throw e;
        } finally {
          clearTimeout(dog);
          ac.signal.removeEventListener("abort", stop);
        }
        // Closed without an `end` event: the proxy cut it. Remote pages carry on by polling.
        return afterStream({ remote, aborted: ac.signal.aborted, refused: false, ended, threw: false }) === "poll" ? "silent" : "done";
      };
      const poll = async () => {
        let gen = 0;
        let since = -1;
        let fails = 0;
        let failingSince = 0;
        while (!ac.signal.aborted) {
          let p: PollJson;
          const asked = Date.now();
          try {
            const res = await fetch(withQuery(url, `cols=${last.cols}&rows=${last.rows}&gen=${gen}&since=${since}&wait=${POLL_WAIT_MS}`), { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" });
            if (!res.ok) throw res.status < 500 ? new PollRefused(await errorOf(res)) : new Error(await errorOf(res));
            const body: unknown = await res.json();
            if (!isPoll(body)) throw new Error("terminal: bad reply");
            p = body;
            fails = 0;
          } catch (e) {
            if (ac.signal.aborted || e instanceof PollRefused) throw e;
            // The tunnel is down for a moment (phone asleep, Wi-Fi to 4G): say so and keep trying for a minute.
            if (fails++ === 0) failingSince = Date.now();
            if (giveUp(failingSince, Date.now())) throw e;
            setState("connecting");
            await new Promise((r) => setTimeout(r, retryDelay(fails)));
            continue;
          }
          setState("live");
          if (p.reset) t.reset();
          if (p.out) write(p.out, p.reset && p.answered);
          gen = p.gen;
          since = p.cursor;
          if (p.ended) return end(p.elsewhere === true, p.dead === true, p.exited === true);
          // HQ held the poll until there was output: ask again at once, unless it answered empty at once.
          if (!p.out && Date.now() - asked < POLL_FAST_MS) await new Promise((r) => setTimeout(r, POLL_IDLE_MS));
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
      if (view.current === term) view.current = null;
    };
    // `retry` reconnects; theme changes recreate the terminal (the server replays the screen).
  }, [url, token, dark, retry, onEnded]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <span className={state === "live" && !stopped ? "size-2 rounded-full bg-st-running" : state === "error" || stopped || (state === "ended" && dead) ? "size-2 rounded-full bg-destructive" : state === "elsewhere" ? "size-2 rounded-full bg-st-needs" : "size-2 rounded-full bg-st-idle"} aria-hidden />
        {state === "connecting" && text.connecting}
        {state === "live" && (stopped === "lost" ? text.lost : text.live)}
        {state === "ended" && (dead ? text.dead : stopped === "exited" ? text.exited : stopped === "lost" ? text.lost : text.ended)}
        {state === "error" && `Không nối được: ${error}`}
        {state === "elsewhere" && "Đang xem (chỉ đọc) — phiên mở ở terminal khác trên máy"}
        {(state === "ended" || state === "error" || state === "elsewhere" || stopped === "lost") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => {
              setState("connecting");
              setDead(false);
              setStopped(null);
              setRetry((n) => n + 1);
            }}
          >
            {state === "elsewhere" ? "Kiểm tra lại" : "Nối lại"}
          </Button>
        )}
      </div>
      {state === "elsewhere" && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-st-needs bg-st-needs/6 px-3 py-2.5 text-sm">
          <p className="min-w-0 flex-1 basis-64">
            Gõ phím bất kỳ vào khung (hoặc bấm “Chuyển sang HQ”) để gõ ở đây: terminal kia đóng, phiên mở tiếp trong HQ (việc đang dở chạy tiếp). Chưa chuyển thì chat qua inbox vẫn tới phòng như thường.
          </p>
          <Button type="button" size="sm" className="h-8 max-sm:min-h-11" disabled={moving} aria-busy={moving} onClick={() => void takeover()}>
            {moving ? "Đang chuyển…" : "Chuyển sang HQ"}
          </Button>
        </div>
      )}
      <div
        ref={host}
        className="min-h-[200px] flex-1 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border bg-white p-2 transition-[border-color,box-shadow] duration-150 focus-within:border-primary/60 focus-within:shadow-glow motion-reduce:transition-none dark:bg-[#09090b]"
        aria-label={text.label}
      />
      {/* A phone keyboard (IME, Vietnamese, autocorrect) types reliably into a real textarea, not into xterm's hidden one. */}
      <form
        className="rounded-lg border bg-card transition-[border-color,box-shadow] duration-150 focus-within:border-primary/60 focus-within:shadow-glow motion-reduce:transition-none"
        onSubmit={(e) => {
          e.preventDefault();
          // read only: move the session here first; the line stays for Enter once it is up
          if (state === "elsewhere") return void takeover();
          keysRef.current?.(lineBytes(line, view.current?.modes.bracketedPasteMode === true));
          setLine("");
        }}
      >
        {/* The same input as the room composer: "/" lists omp/Claude commands, "@" lists files of `cwd`. */}
        <MentionTextarea
          value={line}
          onValueChange={setLine}
          base={cwd}
          api={api}
          commands={kind === "room"}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line; never while an IME (Vietnamese) is composing.
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (kind === "room" && files.length) {
              e.preventDefault();
              void attach(files);
            }
          }}
          disabled={state !== "live"}
          rows={1}
          placeholder={kind === "shell" ? "Gõ lệnh rồi Enter/Gửi (ô trống = Enter)" : "Gõ câu trả lời rồi Enter/Gửi (ô trống = Enter)"}
          aria-label="Gõ vào terminal"
          enterKeyHint="send"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn("max-h-36 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent", kind === "shell" && "font-mono")}
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          {/* Phones: one line that scrolls sideways instead of several rows of keys. */}
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]" role="toolbar" aria-label="Phím terminal">
            {KEYS.map((k) => (
              <Button
                key={k.label}
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-7 min-w-8 shrink-0 bg-muted/60 px-2 font-mono text-xs text-muted-foreground hover:text-foreground", TOUCH)}
                aria-label={k.aria}
                disabled={state !== "live"}
                onClick={() => keysRef.current?.(typeof k.seq === "string" ? k.seq : k.seq(appKeys.current()))}
              >
                {k.label}
              </Button>
            ))}
          </div>
          {kind === "room" && (
            <>
              <input
                ref={picker}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length) void attach(files);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-7 shrink-0 text-xs", TOUCH)}
                aria-label="Gửi ảnh vào phòng"
                title="Gửi ảnh: ảnh vào repo của phòng, đường dẫn hiện trong ô gõ"
                disabled={state !== "live" || note?.busy === true}
                aria-busy={note?.busy === true}
                onClick={() => picker.current?.click()}
              >
                <ImageIcon aria-hidden /> <span className="max-sm:sr-only">Ảnh</span>
              </Button>
            </>
          )}
          <Button type="submit" size="sm" className={cn("shrink-0", TOUCH, "max-sm:px-4")} disabled={state !== "live"}>
            <SendIcon aria-hidden /> <span className="max-sm:sr-only">Gửi</span>
          </Button>
        </div>
      </form>
      {note && (
        <p role="status" className={note.busy ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {note.text}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">{text.hint}</p>
    </div>
  );
}
