"use client";

import { BellRingIcon, CheckIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sessionLabel } from "@/lib/labels";
import { answerOf, countdown, fallbackText, pendingRoom, type Pending, type PendingQuestion } from "@/lib/pending";
import { cn } from "@/lib/utils";
import type { Session } from "./types";
import type { Api } from "./use-hq";

/** Plain fetches every 2 s: works through the remote tunnel, where SSE does not. */
const POLL_MS = 2000;
const MAX_TEXT = 500;

/** Open requests from GET /api/pending, polled while the tab is visible; `skew` = server clock - this clock. */
function usePending(api: Api) {
  const [items, setItems] = useState<Pending[]>([]);
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!document.hidden) {
        try {
          const r = await api<{ pending: Pending[]; now: number }>("/api/pending", { signal: ac.signal });
          setItems(r.pending);
          setSkew(r.now - Date.now());
        } catch {
          /* keep the last list; next round */
        }
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [api]);
  return { items, skew, drop: (id: string) => setItems((xs) => xs.filter((x) => x.id !== id)) };
}

/** Server-clock "now", ticking every second while something is pending. */
function useNow(active: boolean, skew: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now + skew;
}

/**
 * "Đang chờ anh": every question / permission a room is waiting on while the owner is away
 * (contract C5), on top of every tab. Answer here, or the hook applies the fallback at the deadline.
 */
export function PendingStrip({ api, sessions }: { api: Api; sessions: Session[] }) {
  const { items, skew, drop } = usePending(api);
  const now = useNow(items.length > 0, skew);
  const roomOf = useMemo(() => {
    const byId = new Map(sessions.filter((s) => s.session_id).map((s) => [s.session_id!, sessionLabel(s)]));
    return (p: Pending) => (p.session_id && byId.get(p.session_id)) || pendingRoom(p);
  }, [sessions]);
  const open = items.filter((p) => p.deadline > now);
  if (!open.length) return null;

  const send = async (p: Pending, body: Record<string, unknown>, done: string) => {
    try {
      await api(`/api/pending/${p.id}`, { method: "POST", body });
      drop(p.id);
      toast.success(`${done} · ${roomOf(p)}`);
    } catch (e) {
      toast.error(`Không gửi được: ${(e as Error).message}`);
    }
  };

  return (
    <section aria-labelledby="pending-title" className="shrink-0 border-b bg-st-needs/5">
      <div className="max-h-[40vh] overflow-y-auto px-4 py-3 sm:px-6">
        <h2 id="pending-title" className="mb-2 flex items-center gap-2 text-sm font-semibold text-st-needs">
          <BellRingIcon className="size-4" aria-hidden />
          Đang chờ anh
          <span className="tabular text-xs font-normal text-muted-foreground">{open.length}</span>
        </h2>
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,24rem),1fr))]">
          {open.map((p) => (
            <li key={p.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-st-needs/50 bg-card p-3">
              <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground">{roomOf(p)}</span>
                {p.owner_only && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-st-needs">
                    <ShieldAlertIcon className="size-3" aria-hidden /> chỉ anh quyết
                  </span>
                )}
                <span className="ml-auto shrink-0 tabular" role="timer" aria-label={`còn ${countdown(p.deadline, now)}`}>
                  còn {countdown(p.deadline, now)} · hết giờ: {fallbackText(p)}
                </span>
              </p>
              {p.kind === "permission" ? (
                <PermissionCard p={p} onAnswer={(allow) => send(p, { allow }, allow ? "Đã cho phép" : "Đã từ chối")} />
              ) : (
                <QuestionCard p={p} onAnswer={(answers) => send(p, { answers }, "Đã gửi trả lời")} />
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PermissionCard({ p, onAnswer }: { p: Pending; onAnswer: (allow: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const answer = async (allow: boolean) => {
    setBusy(true);
    await onAnswer(allow);
    setBusy(false);
  };
  return (
    <>
      <p className="text-sm">
        Xin quyền dùng <span className="font-mono font-medium">{p.tool ?? "công cụ"}</span>
      </p>
      {p.summary && <p className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">{p.summary}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void answer(true)}>
          <CheckIcon aria-hidden /> Cho phép
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
          <XIcon aria-hidden /> Từ chối
        </Button>
      </div>
    </>
  );
}

function QuestionCard({ p, onAnswer }: { p: Pending; onAnswer: (answers: Record<string, string>) => Promise<void> }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const answers = Object.fromEntries(p.questions.map((q) => [q.question, answerOf(picked[q.question] ?? [], other[q.question] ?? "")]));
  const ready = Object.values(answers).every((a) => a && Array.from(a).length <= MAX_TEXT);
  const pick = (q: PendingQuestion, label: string) => {
    setPicked((m) => {
      const cur = m[q.question] ?? [];
      if (!q.multiSelect) return { ...m, [q.question]: cur[0] === label ? [] : [label] };
      return { ...m, [q.question]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
    });
    // Single choice: a picked option replaces the free text.
    if (!q.multiSelect) setOther((m) => ({ ...m, [q.question]: "" }));
  };
  const submit = async () => {
    setBusy(true);
    await onAnswer(answers);
    setBusy(false);
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      {p.questions.map((q, qi) => {
        const sel = picked[q.question] ?? [];
        const id = `pending-${p.id}-${qi}`;
        return (
          <fieldset key={q.question} className="flex min-w-0 flex-col gap-1.5">
            <legend className="text-sm">
              {q.header && <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{q.header}</span>}
              {q.question}
              {q.multiSelect && <span className="ml-1 text-xs text-muted-foreground">(chọn nhiều)</span>}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => (
                <Button
                  key={o.label}
                  type="button"
                  size="sm"
                  variant={sel.includes(o.label) ? "default" : "outline"}
                  aria-pressed={sel.includes(o.label)}
                  title={o.description || undefined}
                  onClick={() => pick(q, o.label)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            <label htmlFor={id} className="sr-only">
              Khác
            </label>
            <Input
              id={id}
              placeholder="Khác: gõ câu trả lời"
              maxLength={MAX_TEXT}
              value={other[q.question] ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setOther((m) => ({ ...m, [q.question]: v }));
                if (!q.multiSelect && v.trim()) setPicked((m) => ({ ...m, [q.question]: [] }));
              }}
              className="h-8 text-sm"
            />
          </fieldset>
        );
      })}
      <Button type="submit" size="sm" disabled={!ready || busy} className={cn("self-start")}>
        Gửi trả lời
      </Button>
    </form>
  );
}
