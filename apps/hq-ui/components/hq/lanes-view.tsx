"use client";

import { GitPullRequestIcon, LayersIcon, RefreshCwIcon, ShipIcon, Undo2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LANES, boardSummary, claimStale, openCount, type Card, type LaneKey } from "@/lib/lanes";
import type { ProjectBoard } from "@/lib/server/board";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote, ago } from "./bits";
import { RoleIcon } from "./role-badge";
import type { Hq } from "./use-hq";

const POLL_MS = 15_000;

/** The project board (`8sync ccc auto board`): which room holds which card, lane by lane. */
export function LanesView({ hq }: { hq: Hq }) {
  const [boards, setBoards] = useState<ProjectBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);

  const [nonce, setNonce] = useState(0);
  const load = () => setNonce((n) => n + 1);
  // `hq` is a new object on every HQ render; its `api` is stable (memoised on the token).
  const api = hq.api;

  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const r = await api<{ boards: ProjectBoard[] }>("/api/board", { signal: ac.signal });
          setBoards(r.boards);
          setError(null);
        } catch (e) {
          if (!ac.signal.aborted) setError((e as Error).message);
        }
      }
      if (!ac.signal.aborted) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [api, nonce]);

  if (error && !boards) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="board" error={error} onRetry={load} />
      </div>
    );
  }
  // Busiest project first; the owner's pick wins while it still has a live room.
  const list = [...(boards ?? [])].sort((a, b) => (b.board ? openCount(b.board) : -1) - (a.board ? openCount(a.board) : -1));
  const cur = list.find((b) => b.root === pick) ?? list[0];

  if (boards && !cur) {
    return (
      <EmptyState icon={<LayersIcon />} title="Chưa có phòng nào đang chạy">
        Trong repo, chạy <code className="font-mono">8sync ccc auto up</code> để mở cả team nền, rồi giao card bằng{" "}
        <code className="font-mono">8sync ccc auto add &quot;&lt;việc&gt;&quot; --check &quot;&lt;lệnh&gt;&quot;</code>.
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 sm:px-6">
        {list.length > 1 ? (
          <Select value={cur?.root ?? ""} onValueChange={setPick}>
            <SelectTrigger size="sm" className="max-w-64 text-xs" aria-label="Dự án">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map((b) => (
                <SelectItem key={b.root} value={b.root} className="text-xs">
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : cur ? (
          <span className="text-sm font-medium">{cur.name}</span>
        ) : (
          <Skeleton className="h-4 w-32" />
        )}
        <span className="text-xs text-muted-foreground" role="status">
          {cur?.board ? boardSummary(cur.board) : cur?.error ?? ""}
        </span>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()} aria-label="Tải lại board">
          <RefreshCwIcon />
        </Button>
      </div>
      {cur?.error && !cur.board ? (
        <div className="p-4 sm:px-6">
          <ErrorNote what={`board của ${cur.name}`} error={cur.error} onRetry={load} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="grid h-full min-w-[1180px] grid-cols-7 gap-3 px-4 py-4 sm:px-6">
            {LANES.map((l) => (
              <Lane key={l.key} lane={l.key} label={l.label} hint={l.hint} cards={cur?.board?.lanes[l.key] ?? null} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Lane({ lane, label, hint, cards }: { lane: LaneKey; label: string; hint: string; cards: Card[] | null }) {
  const ship = lane === "approved" && (cards?.length ?? 0) > 0;
  return (
    <section aria-labelledby={`lane-${lane}`} className={cn("flex min-h-0 flex-col rounded-xl bg-muted/50", ship && "bg-st-needs/10")}>
      <h3 id={`lane-${lane}`} className="flex items-center gap-2 px-3 pt-3 text-[13px] font-medium">
        {ship && <ShipIcon className="size-3.5 text-st-needs" aria-hidden />}
        {label}
        <span className="text-xs font-normal text-muted-foreground tabular">{cards ? cards.length : ""}</span>
      </h3>
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">{hint}</p>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
        {cards === null
          ? [0, 1].map((i) => (
              <li key={i}>
                <Skeleton className="h-16 rounded-lg" />
              </li>
            ))
          : cards.map((c) => <CardItem key={c.id} c={c} />)}
      </ul>
    </section>
  );
}

const LABEL_STYLE: Record<string, string> = {
  bug: "border-destructive/40 text-destructive",
  qa: "border-st-needs/40 text-st-needs",
};

function CardItem({ c }: { c: Card }) {
  const stale = claimStale(c);
  return (
    <li className="rounded-lg border bg-card px-2.5 py-2">
      <p className="text-[13px] leading-snug text-pretty">
        <span className="mr-1 font-mono text-[11px] text-muted-foreground">#{c.id}</span>
        {c.text}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {c.label && <span className={cn("rounded border px-1 leading-4", LABEL_STYLE[c.label])}>{c.label}</span>}
        {c.claim && (
          <span className={cn("inline-flex items-center gap-1", stale && "text-st-needs")} title={stale ? "im quá 2 giờ: claim kế sẽ thu hồi" : undefined}>
            <RoleIcon role={c.claim.room.replace(/\d+$/, "")} />
            <span className="font-mono">{c.claim.room}</span>
            <span className="tabular">{ago(c.claim.at)}</span>
          </span>
        )}
        {c.pr && (
          <span className="inline-flex items-center gap-0.5">
            <GitPullRequestIcon className="size-3" aria-hidden />
            {c.pr.replace(/^#/, "")}
          </span>
        )}
        {c.sha && <span className="font-mono">{c.sha.slice(0, 7)}</span>}
        {c.bounces > 0 && (
          <span className="inline-flex items-center gap-0.5" title={`bị trả về ${c.bounces} lần`}>
            <Undo2Icon className="size-3" aria-hidden />
            {c.bounces}
          </span>
        )}
        {!c.check && c.lane !== "backlog" && <span className="text-destructive">chưa có lệnh check</span>}
      </div>
      {c.note && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={c.note.text}>
          {c.note.room ? `${c.note.room}: ` : ""}
          {c.note.text}
        </p>
      )}
    </li>
  );
}
