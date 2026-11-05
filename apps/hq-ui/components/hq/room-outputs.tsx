"use client";

import { BotIcon, CircleAlertIcon, DownloadIcon, LoaderIcon } from "lucide-react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { agoShort, agoVi } from "@/lib/now";
import { outputsMarkdown, turnForMessage, turnTitle, type Turn } from "@/lib/room-turns";
import type { ActivityEvent } from "@/lib/server/activity";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { makeApi } from "./use-hq";

const POLL_MS = 4000;
/** An unchanged log still moves its "x phút trước" labels, at this pace. */
const CLOCK_MS = 30_000;

type Log = { events: ActivityEvent[]; turns: Turn[]; rev: string };
type Wire = (Log & { at: number }) | { same: true; rev: string; at: number };

type Ctx = {
  log: Log | null;
  now: number;
  error: string | null;
  retry: () => void;
  /** Ask the Kết quả panel to show a turn; `seq` re-fires the same key. */
  focus: (key: string) => void;
  focused: { key: string; seq: number } | null;
};

const RoomLogCtx = createContext<Ctx | null>(null);

/**
 * One poll per room for both halves of Chat phòng: the Nhật ký panel (steps, Kết quả) and the chat's
 * links from a message to its result. Every 4 s while the tab is visible; `?since=` turns an unchanged
 * transcript into a tiny `{same}` answer, and then nothing re-renders but the clock every 30 s.
 * `working` (the room's state from the office): its newest turn is still going even when its last step
 * is a reply, for the panel and the chat links alike.
 */
export function RoomLogProvider({ sessionId, token, working, children }: { sessionId: string | null; token: string; working: boolean; children: ReactNode }) {
  // Tagged with the room they came from: another room shows nothing of the last one's log.
  const [got, setLog] = useState<{ id: string; log: Log } | null>(null);
  const [now, setNow] = useState(0);
  const [failed, setError] = useState<{ id: string; error: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [focused, setFocused] = useState<Ctx["focused"]>(null);
  const raw = got && got.id === sessionId ? got.log : null;
  const log = useMemo(() => (raw && working ? withNewestLive(raw) : raw), [raw, working]);
  const error = failed && failed.id === sessionId ? failed.error : null;
  useEffect(() => {
    if (!sessionId) return;
    const ac = new AbortController();
    const api = makeApi(token);
    let rev = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!document.hidden) {
        try {
          const r = await api<Wire>(`/api/sessions/${encodeURIComponent(sessionId)}/activity${rev ? `?since=${encodeURIComponent(rev)}` : ""}`, { signal: ac.signal });
          if ("same" in r) setNow((n) => (r.at - n >= CLOCK_MS ? r.at : n));
          else {
            rev = r.rev;
            setLog({ id: sessionId, log: { events: r.events, turns: r.turns, rev: r.rev } });
            setNow(r.at);
          }
          setError(null);
        } catch (e) {
          if (!ac.signal.aborted) setError({ id: sessionId, error: (e as Error).message });
        }
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    const onShow = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", onShow);
    void load();
    return () => {
      ac.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [token, sessionId, tick]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  const focus = useCallback((key: string) => setFocused((f) => ({ key, seq: (f?.seq ?? 0) + 1 })), []);
  const value = useMemo<Ctx>(() => ({ log, now, error, retry, focus, focused }), [log, now, error, retry, focus, focused]);
  return <RoomLogCtx.Provider value={value}>{children}</RoomLogCtx.Provider>;
}

/** The log with its newest turn marked as still going (a new object for that turn only, so memoized sections keep). */
function withNewestLive(log: Log): Log {
  const last = log.turns.at(-1);
  if (!last || last.live) return log;
  return { ...log, turns: [...log.turns.slice(0, -1), { ...last, live: true }] };
}

export function useRoomLog(): Ctx | null {
  return useContext(RoomLogCtx);
}

/**
 * Under a chat message: the agent icon that opens the result it led to (an owner message: the turn it
 * started; a room's reply: the turn it was written in). Nothing when no turn in the log matches.
 */
export function TurnLink({ m, align }: { m: { kind: string; text: string | null; ts: number }; align: "start" | "end" }) {
  const ctx = useRoomLog();
  const turns = ctx?.log?.turns;
  const turn = useMemo(() => (turns ? turnForMessage(turns, m) : null), [turns, m]);
  if (!ctx || !turn) return null;
  // A live turn's output is only what it said so far.
  const waiting = turn.live || !turn.output;
  return (
    <div className={cn("mt-1 flex", align === "end" ? "justify-end" : "justify-start")}>
      <button
        type="button"
        onClick={() => ctx.focus(turn.key)}
        title={waiting ? "Phòng đang làm việc này: mở Kết quả" : "Xem kết quả của tin này"}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-10"
      >
        {turn.live ? <LoaderIcon aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <BotIcon aria-hidden className="size-3.5" />}
        {waiting ? "Đang làm" : "Kết quả"}
      </button>
    </div>
  );
}

const stamp = (ms: number) => new Date(ms).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

/**
 * "Kết quả": the final output of each turn as one markdown document, newest first, with a table of
 * contents beside it (above it when the panel is narrow). A link from the chat scrolls its turn into
 * view. Sections off screen skip layout and paint (`content-visibility`), so 20 long outputs stay cheap.
 */
export function RoomOutputs({ turns, now, room }: { turns: Turn[]; now: number; room: string }) {
  const ctx = useRoomLog();
  const doc = useRef<HTMLDivElement>(null);
  const list = useMemo(() => [...turns].reverse(), [turns]);
  const busy = (t: Turn) => t.live;
  const [active, setActive] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const show = useCallback((key: string) => {
    const el = doc.current?.querySelector<HTMLElement>(`[data-turn="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setActive(key);
    setFlash(key);
  }, []);

  const seq = ctx?.focused?.seq;
  useEffect(() => {
    if (ctx?.focused) show(ctx.focused.key);
    // Only a new request moves the view, not a new poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // The section at the top of the document marks its TOC entry.
  useEffect(() => {
    const root = doc.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const key = top?.target.getAttribute("data-turn");
        if (key) setActive(key);
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    );
    for (const el of root.querySelectorAll("[data-turn]")) io.observe(el);
    return () => io.disconnect();
  }, [list]);

  const download = () => {
    const md = outputsMarkdown(turns, room, stamp);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    a.download = `ket-qua-${room.replace(/[^\w.-]+/g, "-")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!list.length) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-pretty text-muted-foreground">
        Chưa có kết quả: phòng chưa trả lời lời nhắn nào, hoặc transcript của nó không nằm trên máy này.
      </p>
    );
  }
  const done = list.filter((t) => t.output).length;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular">
          {done}/{list.length} việc có kết quả · mới nhất ở trên
        </span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={download} disabled={!done}>
          <DownloadIcon aria-hidden />
          Tải .md
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 @3xl:flex-row">
        <nav aria-label="Mục lục kết quả" className="max-h-36 shrink-0 overflow-y-auto rounded-lg border @3xl:max-h-none @3xl:w-56">
          <ol className="divide-y divide-border/60 text-[13px]">
            {list.map((t, i) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => show(t.key)}
                  aria-current={active === t.key ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 px-2.5 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset pointer-coarse:min-h-10",
                    active === t.key && "bg-muted",
                  )}
                >
                  <span className="mt-px w-5 shrink-0 text-right text-[11px] text-muted-foreground tabular">{list.length - i}</span>
                  <span className={cn("min-w-0 flex-1 line-clamp-2", !t.output && "text-muted-foreground")}>{turnTitle(t)}</span>
                  <TurnMark t={t} busy={busy(t)} />
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div ref={doc} tabIndex={0} aria-label="Kết quả từng việc, mới nhất ở trên" className="min-h-0 flex-1 overflow-y-auto rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-md:max-h-[65svh]">
          {list.map((t, i) => (
            <TurnSection key={t.key} t={t} busy={busy(t)} n={list.length - i} now={now} flash={flash === t.key} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TurnMark({ t, busy }: { t: Turn; busy: boolean }) {
  if (busy) return <LoaderIcon aria-label="đang làm" className="mt-0.5 size-3.5 shrink-0 animate-spin text-st-running motion-reduce:animate-none" />;
  if (t.errors) return <CircleAlertIcon aria-label={`${t.errors} bước lỗi`} className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
  return null;
}

/** One turn: its title (what was asked), when and how much work, then the output in full (`busy`: so far). */
const TurnSection = memo(function TurnSection({ t, busy, n, now, flash }: { t: Turn; busy: boolean; n: number; now: number; flash: boolean }) {
  const meta = [t.at != null ? agoShort(t.at, now) : null, t.steps ? `${t.steps} bước` : null, t.agents ? `${t.agents} subagent` : null, t.errors ? `${t.errors} lỗi` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      data-turn={t.key}
      aria-labelledby={`turn-${n}`}
      className={cn(
        "scroll-mt-2 border-b px-4 py-3 transition-colors duration-700 last:border-b-0 [contain-intrinsic-size:auto_320px] [content-visibility:auto]",
        flash && "bg-brand/10",
      )}
    >
      <header className="mb-2 flex items-start gap-2">
        <BotIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h4 id={`turn-${n}`} className="text-sm font-semibold text-balance">
            <span className="mr-1.5 text-muted-foreground tabular">{n}.</span>
            {turnTitle(t, 160)}
          </h4>
          <p className="text-xs text-muted-foreground tabular" title={t.at != null ? agoVi(t.at, now) : undefined}>
            {meta}
          </p>
        </div>
        {t.output && <CopyButton value={t.output} label="Chép kết quả (markdown)" />}
      </header>
      {t.output ? (
        <div className="max-w-[72ch] text-sm leading-relaxed break-words [&_pre]:my-2 [&_pre]:text-xs [&_table]:my-2 [&_table]:text-xs">
          {busy && (
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-st-running">
              <LoaderIcon aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
              Đang làm: dưới đây là câu trả lời mới nhất, chưa phải kết quả cuối.
            </p>
          )}
          <MessageResponse>{t.output}</MessageResponse>
          {t.output.length >= 7999 && t.output.endsWith("…") && <p className="mt-1 text-xs text-muted-foreground">Kết quả dài hơn phần HQ giữ (8 000 ký tự). Đọc trọn trong terminal của phòng.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{busy ? "Phòng đang làm việc này, chưa trả lời." : "Việc này kết thúc mà không có câu trả lời."}</p>
      )}
    </article>
  );
});
