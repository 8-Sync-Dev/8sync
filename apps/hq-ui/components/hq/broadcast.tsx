"use client";

import { ListChecksIcon, UsersIcon } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ALL_PROJECTS,
  broadcastProjects,
  broadcastSummary,
  choiceValid,
  isSendKey,
  outerProjects,
  pickedProjects,
  resolveChoice,
  resultLine,
  sendOutcome,
  type BroadcastResult,
} from "@/lib/broadcast";
import type { Hq } from "./use-hq";
import type { Room } from "./use-office";

/**
 * The one place to give every room the same task: `8sync ccc auto add "<việc>" [--now]` in the
 * chosen project (POST /api/targets). Sits under Văn phòng and Chat tổng.
 */
export function BroadcastComposer({ hq, rooms, preferRoot }: { hq: Hq; rooms: Room[]; preferRoot?: string | null }) {
  const projects = useMemo(() => broadcastProjects(rooms), [rooms]);
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [now, setNow] = useState(true);
  const [check, setCheck] = useState("");
  const [showCheck, setShowCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ now: boolean; lines: { ok: boolean; text: string }[] } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // Until the owner picks, follow the project in scope (or the busiest one) as rooms come and go.
  // A pick whose project lost every room is forgotten, so it does not snap back later unseen.
  if (picked != null && !choiceValid(picked, projects)) setPicked(null);
  const choice = resolveChoice(picked, projects, preferRoot);
  const total = pickedProjects(choice, projects).reduce((n, p) => n + p.rooms.length, 0);
  const allTotal = outerProjects(projects).reduce((n, p) => n + p.rooms.length, 0);
  const disabled = total === 0;

  async function send() {
    const body = text.trim();
    if (!body || disabled || busy) return;
    setBusy(true);
    try {
      const r = await hq.api<{ results: BroadcastResult[] }>("/api/targets", {
        method: "POST",
        body: { text: body, now, check: showCheck ? check.trim() || null : null, root: choice },
      });
      const lines = r.results.map((x) => ({ ok: x.ok, text: resultLine(x, now) }));
      setLast({ now, lines });
      const out = sendOutcome(r.results);
      if (out.clear) {
        toast.success(now ? `Đã gửi việc cho ${out.sent} phòng` : "Việc đã vào hàng đích");
        setText("");
        setCheck("");
        area.current?.focus();
      } else if (out.failed.length === r.results.length) toast.error("Chưa gửi được việc nào");
      // Some projects took it: keep the text so the owner can pick a failed project and send again.
      else toast.warning(`Chưa gửi được tới: ${out.failed.join(", ")} (xem dòng đỏ bên dưới)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSendKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="shrink-0 border-t bg-background">
      <form
        aria-labelledby="broadcast-title"
        className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <h2 id="broadcast-title" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
          <UsersIcon className="size-3.5 text-muted-foreground" aria-hidden />
          Gửi cho mọi phòng
        </h2>
        <div className="rounded-xl border bg-card focus-within:ring-2 focus-within:ring-ring/40">
          <label htmlFor="broadcast" className="sr-only">
            Việc cho mọi phòng
          </label>
          <Textarea
            id="broadcast"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            disabled={disabled}
            rows={2}
            maxLength={2000}
            aria-describedby="broadcast-summary"
            placeholder="Một việc cho cả team, vd: webhook 500 on retry (Ctrl+Enter để gửi)"
            className="max-h-48 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {showCheck && (
            <div className="px-2 pb-2">
              <label htmlFor="broadcast-check" className="sr-only">
                Lệnh kiểm
              </label>
              <Input
                id="broadcast-check"
                value={check}
                onChange={(e) => setCheck(e.target.value)}
                maxLength={300}
                placeholder="Lệnh kiểm, các phòng chạy trong dự án (exit 0 = đạt), vd: pnpm test"
                className="h-7 font-mono text-xs"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
            <Select value={choice} onValueChange={setPicked} disabled={projects.length === 0}>
              <SelectTrigger size="sm" className="h-7 max-w-[60%] gap-1.5 border-0 bg-muted/60 text-xs" aria-label="Gửi tới dự án">
                <SelectValue placeholder="Chưa có phòng" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.root} value={p.root} className="text-xs">
                    {p.name} · {p.rooms.length} phòng
                  </SelectItem>
                ))}
                {projects.length > 1 && (
                  <SelectItem value={ALL_PROJECTS} className="text-xs">
                    Mọi dự án · {allTotal} phòng
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs hover:bg-muted">
              <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} className="size-3.5 accent-primary" />
              Gửi ngay
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              aria-expanded={showCheck}
              aria-controls={showCheck ? "broadcast-check" : undefined}
              onClick={() => setShowCheck((v) => !v)}
            >
              <ListChecksIcon /> Lệnh kiểm
            </Button>
            <Button type="submit" size="sm" className="ml-auto" disabled={disabled || busy || !text.trim()}>
              <UsersIcon /> {busy ? "Đang gửi…" : "Gửi mọi phòng"}
            </Button>
          </div>
        </div>
        <p id="broadcast-summary" className="mt-1.5 text-xs text-muted-foreground">
          {broadcastSummary(choice, projects, now)}
        </p>
        {/* Mounted before the first send so screen readers announce the results when they arrive. */}
        <ul role="status" className="mt-1 space-y-0.5 text-xs empty:hidden">
          {last?.lines.map((l, i) => (
            <li key={i} className={l.ok ? "text-foreground" : "text-destructive"}>
              {l.text}
            </li>
          ))}
        </ul>
      </form>
    </div>
  );
}
