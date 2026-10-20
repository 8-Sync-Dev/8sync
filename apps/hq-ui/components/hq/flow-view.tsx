"use client";

import { CheckIcon, RefreshCwIcon, RepeatIcon, Undo2Icon, WorkflowIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cardParts } from "@/lib/card-tags";
import { edges, flowRows, laneNow, type FlowRow, type Visit } from "@/lib/flow";
import { LANES, openCount, type Card, type LaneKey } from "@/lib/lanes";
import { agoShort, agoVi, roomRole } from "@/lib/now";
import { rootKey } from "@/lib/preview";
import type { LoopRow, ProjectLoops } from "@/lib/server/loops";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { CardSheet, LANE_VI, PrioChip, TONE_INK, laneTone } from "./card-sheet";
import { RoleIcon } from "./role-badge";
import type { BoardsState } from "./use-board";

export type LoopsState = { data: { projects: ProjectLoops[] } | null; error: string | null };

/** Columns: the 7 lanes with Done (closed cards end there) before Blocked, the same order as Board. */
type Col = LaneKey | "done";
const COLS: Col[] = [...LANES.filter((l) => l.key !== "blocked").map((l) => l.key), "done", "blocked"];
const N = COLS.length;
const colIndex = (k: Col) => COLS.indexOf(k);
/** Centre of a column in the track's 0..800 viewBox (100 per column). */
const X = (k: Col) => colIndex(k) * 100 + 50;
const GRID = "grid grid-cols-[minmax(12rem,16rem)_repeat(8,minmax(5.25rem,1fr))]";
const STICKY = "sticky left-0 z-[3] self-stretch justify-center bg-background group-hover/row:bg-[color-mix(in_oklch,var(--muted)_40%,var(--background))]";
const ROW_H = 44;
const MID = ROW_H / 2;

/** Every card's path through the lanes, rebuilt from its notes, plus where each lane stands now. */
export function FlowView({ state, loops }: { state: BoardsState; loops: LoopsState }) {
  const { boards, error, at: now, reload } = state;
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState<{ root: string; id: number; card: Card } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const list = useMemo(() => [...(boards ?? [])].sort((a, b) => (b.board ? openCount(b.board) : -1) - (a.board ? openCount(a.board) : -1)), [boards]);
  const cur = list.find((b) => b.root === pick) ?? list[0];
  const rows = useMemo(() => (cur?.board ? flowRows(cur.board) : []), [cur]);
  const lanes = useMemo(() => (cur?.board ? laneNow(cur.board) : null), [cur]);
  const curLoops = useMemo(() => {
    if (!cur) return [];
    const k = [rootKey(cur.root), cur.filed ? rootKey(cur.filed) : null];
    return loops.data?.projects.find((p) => k.includes(rootKey(p.root)))?.loops ?? [];
  }, [cur, loops.data]);

  if (error && !boards) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="board" error={error} onRetry={reload} />
      </div>
    );
  }
  if (boards && !cur) {
    return (
      <EmptyState icon={<WorkflowIcon />} title="Chưa có phòng nào đang chạy">
        Mở team ở tab Văn phòng rồi giao việc: mỗi card đi qua các cột sẽ hiện thành một đường ở đây.
      </EmptyState>
    );
  }

  const live = open ? boards?.find((b) => b.root === open.root)?.board : null;
  const shown = open ? ((live ? LANES.flatMap((l) => live.lanes[l.key]).find((c) => c.id === open.id) : undefined) ?? open.card) : null;
  const openRows = rows.filter((r) => r.state === "open");
  const closedRows = rows.filter((r) => r.state !== "open");

  return (
    <TooltipProvider delayDuration={150}>
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
          {cur?.board && (
            <span className="text-xs text-muted-foreground tabular">
              {openRows.length} card đang chạy · {closedRows.length} vừa đóng
            </span>
          )}
          <Legend />
          <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" onClick={() => void reload()} aria-label="Tải lại flow">
            <RefreshCwIcon />
          </Button>
        </div>

        {cur?.error && !cur.board ? (
          <div className="p-4 sm:px-6">
            <ErrorNote what={`board của ${cur.name}`} error={cur.error} onRetry={reload} />
          </div>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-auto">
            <div className="min-w-[57rem] px-4 pb-6 sm:px-6">
              {/* "Đang ở đâu": the column heads are the live summary, so a row's dots line up under them. */}
              <div className={cn(GRID, "sticky top-0 z-10 border-b bg-background pt-3 pb-2")} role="group" aria-label="Đang ở đâu">
                <div className="sticky left-0 z-[3] self-end bg-background pr-3 pb-0.5 text-xs font-medium text-muted-foreground">Đang ở đâu</div>
                {COLS.map((k) =>
                  k === "done" ? (
                    <DoneHead key={k} n={cur?.board ? cur.board.closed.length : null} done={cur?.board?.closed.filter((c) => c.state === "done").length ?? 0} />
                  ) : (
                    <LaneHead key={k} lane={k} n={lanes?.[k].n ?? null} rooms={lanes?.[k].rooms ?? []} />
                  ),
                )}
              </div>

              {!cur?.board ? (
                <ul className="space-y-2 pt-3">
                  {[0, 1, 2, 3].map((i) => (
                    <li key={i}>
                      <Skeleton className="h-9 w-full rounded-md" />
                    </li>
                  ))}
                </ul>
              ) : rows.length === 0 ? (
                <EmptyState icon={<WorkflowIcon />} title="Chưa có card nào chạy qua board">
                  Bấm &quot;Giao việc&quot; ở góc trên để đưa card vào board. Mỗi lần một phòng chuyển card (ready → building → qa …), đường của card dài thêm ở đây.
                </EmptyState>
              ) : (
                <>
                  <RowGroup title="Đang chạy" rows={openRows} now={now} onOpen={(r) => r.card && (setOpen({ root: cur.root, id: r.id, card: r.card }), setSheetOpen(true))} />
                  {closedRows.length > 0 && <RowGroup title="Vừa đóng" rows={closedRows} now={now} />}
                </>
              )}

              <LoopsPanel loops={curLoops} loading={loops.data === null && loops.error === null} error={loops.error} now={now} />
            </div>
          </div>
        )}
        <CardSheet c={shown} open={sheetOpen} now={now} next={false} onClose={() => setSheetOpen(false)} onPrio={open && shown ? (prio) => state.setPrio(open.root, shown.id, prio) : undefined} />
      </div>
    </TooltipProvider>
  );
}

function Legend() {
  const item = "inline-flex items-center gap-1";
  return (
    <span className="hidden items-center gap-3 text-[11px] text-muted-foreground lg:inline-flex" aria-hidden>
      <span className={item}>
        <svg width="18" height="8" className="text-foreground/60">
          <line x1="1" y1="4" x2="17" y2="4" stroke="currentColor" strokeWidth="2" />
        </svg>
        đi tiếp
      </span>
      <span className={item}>
        <svg width="18" height="10">
          <path d="M1 9 C1 1, 17 1, 17 9" fill="none" stroke="var(--st-needs)" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
        bị trả về
      </span>
      <span className={item}>
        <svg width="18" height="10">
          <path d="M1 1 C1 9, 17 9, 17 1" fill="none" stroke="var(--destructive)" strokeWidth="1.5" strokeDasharray="1 2" />
        </svg>
        vào/ra Blocked
      </span>
    </span>
  );
}

function LaneHead({ lane, n, rooms }: { lane: LaneKey; n: number | null; rooms: string[] }) {
  const busy = (n ?? 0) > 0;
  return (
    <div style={laneTone(lane)} className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center">
      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", busy ? TONE_INK : "text-muted-foreground")}>
        <span aria-hidden className={cn("size-1.5 rounded-full", busy ? "bg-(--tone)" : "bg-border")} />
        {LANE_VI[lane]}
        <span className={cn("tabular", busy ? "text-foreground" : "font-normal")}>{n ?? ""}</span>
      </span>
      <span className="flex h-4 max-w-full items-center gap-1 overflow-hidden text-[11px] text-muted-foreground">
        {rooms.length === 0 ? (
          <span className="sr-only">không phòng nào</span>
        ) : (
          rooms.slice(0, 2).map((r) => (
            <span key={r} className="inline-flex min-w-0 items-center gap-0.5 text-foreground" title={`${r} đang giữ card ở ${LANE_VI[lane]}`}>
              <RoleIcon role={roomRole(r)?.role ?? null} className="text-muted-foreground" />
              <span className="truncate">{r}</span>
            </span>
          ))
        )}
        {rooms.length > 2 && <span className="tabular">+{rooms.length - 2}</span>}
      </span>
    </div>
  );
}

/** The Done column head: closed cards the board still lists (the CLI keeps the last 10). */
function DoneHead({ n, done }: { n: number | null; done: number }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center">
      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", n ? "text-st-running" : "text-muted-foreground")}>
        <CheckIcon aria-hidden className="size-3" strokeWidth={3} />
        Done
        <span className={cn("tabular", n ? "text-foreground" : "font-normal")}>{n ?? ""}</span>
      </span>
      <span className="h-4 text-[11px] text-muted-foreground tabular">{n ? `${done} xong${n - done ? ` · ${n - done} bỏ` : ""}` : ""}</span>
    </div>
  );
}

function RowGroup({ title, rows, now, onOpen }: { title: string; rows: FlowRow[]; now: number; onOpen?: (r: FlowRow) => void }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title} className="pt-3">
      <h3 className="pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title} <span className="tabular">· {rows.length}</span>
      </h3>
      <ul className="divide-y divide-border/60">
        {rows.map((r) => (
          <FlowRowItem key={`${r.state}-${r.id}`} r={r} now={now} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function FlowRowItem({ r, now, onOpen }: { r: FlowRow; now: number; onOpen?: (r: FlowRow) => void }) {
  const { title } = cardParts(r.text);
  const who = r.room ? roomRole(r.room) : null;
  const clickable = !!onOpen && !!r.card;
  const label = (
    <>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">#{r.id}</span>
        <span className={cn("truncate text-[13px] font-medium", r.state !== "open" && "text-muted-foreground")}>{title}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        {r.state === "open" ? (
          r.room ? (
            <span className="inline-flex min-w-0 items-center gap-0.5 text-foreground">
              <RoleIcon role={who?.role ?? null} className="text-muted-foreground" />
              <span className="truncate">{r.room}</span>
            </span>
          ) : (
            <span>{r.lane === "approved" ? "chờ anh Ship" : r.lane === "blocked" ? "chờ lead gỡ" : "chờ phòng nhận"}</span>
          )
        ) : (
          <span className={cn("font-medium", r.state === "done" ? "text-st-running" : "")}>{r.state === "done" ? "xong" : "bỏ"}</span>
        )}
        <span className="shrink-0 tabular">{agoShort(r.at, now)}</span>
        {r.bounces > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 tabular text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs" title={`bị trả về ${r.bounces} lần`}>
            <Undo2Icon aria-hidden className="size-3" />
            {r.bounces}
          </span>
        )}
        <PrioChip prio={r.prio} />
      </span>
    </>
  );
  return (
    <li className={cn(GRID, "group/row items-center hover:bg-muted/40")}>
      {/* Sticky: on a phone the lanes scroll sideways under the card names. The opaque mix matches the row's hover tint. */}
      {clickable ? (
        <button
          type="button"
          onClick={() => onOpen!(r)}
          aria-haspopup="dialog"
          className={cn("flex min-w-0 flex-col gap-0.5 rounded-md py-1.5 pr-3 pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60", STICKY)}
        >
          {label}
        </button>
      ) : (
        <div className={cn("flex min-w-0 flex-col gap-0.5 py-1.5 pr-3 pl-1", STICKY)}>{label}</div>
      )}
      <Track r={r} now={now} />
    </li>
  );
}

/** The path: segments between column centres, a return arc for a bounce, a lower arc into/out of Blocked, one node per lane visited, a closed card ends at Done. */
function Track({ r, now }: { r: FlowRow; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const byLane = new Map<LaneKey, Visit[]>();
  for (const v of r.visits) (byLane.get(v.lane) ?? byLane.set(v.lane, []).get(v.lane)!).push(v);
  const nodes = LANES.filter((l) => byLane.has(l.key)).map((l) => l.key);
  const closed = r.state !== "open";
  const current = closed ? null : r.lane;
  const last = r.visits[r.visits.length - 1]?.lane ?? null;
  // Each distinct segment once; a closed card adds its last lane → Done.
  const seen = new Set<string>();
  const drawn: { from: Col; to: Col; kind: "fwd" | "back" | "side" }[] = [];
  for (const e of [...edges(r.visits), ...(closed && last ? [{ from: last, to: "done" as const, kind: last === "blocked" ? ("side" as const) : ("fwd" as const) }] : [])]) {
    const k = `${e.kind}:${e.from}:${e.to}`;
    if (!seen.has(k)) {
      seen.add(k);
      drawn.push(e);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button[data-node]") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const j = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : Math.min(btns.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)));
    btns[j]?.focus();
    e.preventDefault();
  };

  return (
    <div ref={ref} role="group" aria-label={`Đường đi card #${r.id}`} onKeyDown={onKey} className="relative col-span-8" style={{ height: ROW_H }}>
      <svg aria-hidden viewBox={`0 0 ${N * 100} ${ROW_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        {drawn.map((e) => {
          const a = X(e.from);
          const b = X(e.to);
          if (e.kind === "fwd") {
            return <line key={`${e.from}-${e.to}`} x1={a} y1={MID} x2={b} y2={MID} stroke={toneVar(e.to)} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
          }
          const up = e.kind === "back";
          const y = up ? 4 : ROW_H - 4;
          return (
            <path
              key={`${e.kind}-${e.from}-${e.to}`}
              d={`M ${a} ${MID} C ${a} ${y}, ${b} ${y}, ${b} ${MID}`}
              fill="none"
              stroke={up ? "var(--st-needs)" : "var(--destructive)"}
              strokeWidth={1.5}
              strokeDasharray={up ? "4 3" : "1.5 3"}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {nodes.map((k) => (
        <Node key={k} lane={k} visits={byLane.get(k)!} now={now} current={k === current} room={k === current ? r.room : null} tabbable={!closed && k === (current ?? nodes[nodes.length - 1])} />
      ))}
      {closed && <EndNode r={r} now={now} />}
    </div>
  );
}

const toneVar = (k: Col) => {
  if (k === "done") return "var(--st-running)";
  const s = laneTone(k) as Record<string, string> | undefined;
  return s?.["--tone"] ?? "currentColor";
};

const NODE = "absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const leftOf = (k: Col) => `${((colIndex(k) + 0.5) / N) * 100}%`;

function Node({ lane, visits, now, current, room, tabbable }: { lane: LaneKey; visits: Visit[]; now: number; current: boolean; room: string | null; tabbable: boolean }) {
  const who = room ? roomRole(room) : null;
  const times = visits.length;
  const label = `${LANE_VI[lane]}${current ? `, đang ở đây${room ? `, ${room} giữ` : ""}` : ""}${times > 1 ? `, ${times} lần` : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" data-node tabIndex={tabbable ? 0 : -1} aria-label={label} style={{ ...laneTone(lane), left: leftOf(lane) }} className={NODE}>
          {current && room ? (
            <span className="grid size-7 place-items-center rounded-full bg-(--tone) text-background ring-4 ring-[color-mix(in_oklch,var(--tone)_22%,transparent)]">
              <RoleIcon role={who?.role ?? null} className="size-3.5" />
            </span>
          ) : current ? (
            // Here, but no room holds it: a hollow marker, the lane waits (for a room, the owner's Ship, a fix).
            <span className="grid size-6 place-items-center rounded-full border-[3px] border-(--tone) bg-background ring-4 ring-[color-mix(in_oklch,var(--tone)_18%,transparent)]" />
          ) : (
            <span className="grid size-5 place-items-center">
              <span className="size-2.5 rounded-full bg-(--tone) ring-2 ring-background" />
            </span>
          )}
          {times > 1 && <span className="absolute -top-1.5 -right-2.5 rounded-full bg-background px-0.5 text-[10px] leading-3 font-semibold tabular text-muted-foreground">×{times}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="block max-w-sm space-y-1.5 py-2">
        <p className="font-semibold">
          {LANE_VI[lane]}
          {current && room && <span className="font-normal opacity-80"> · {room} đang giữ</span>}
        </p>
        <ul className="space-y-1">
          {visits.map((v, i) => (
            <li key={i} className="leading-snug">
              <span className="opacity-70 tabular">{v.at > 0 ? agoVi(v.at, now) : "không rõ lúc"}</span>
              {v.room && <span className="font-medium"> · {v.room}</span>}
              {v.text ? <span>: {v.text}</span> : i === 0 && v.kind === null ? <span>: vào board</span> : null}
              {v.notes.slice(-2).map((n, j) => (
                <span key={j} className="block opacity-80">
                  {n.room ? `${n.room}: ` : ""}
                  {n.text}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** Where a closed card ended: a check (done, with its evidence) or a cross (dropped) in the Done column. */
function EndNode({ r, now }: { r: FlowRow; now: number }) {
  const done = r.state === "done";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" data-node tabIndex={0} aria-label={done ? `Xong${r.by ? `, ${r.by} đóng` : ""}` : "Bỏ"} style={{ left: leftOf("done") }} className={NODE}>
          <span className={cn("grid size-6 place-items-center rounded-full border-2 bg-background", done ? "border-st-running text-st-running" : "border-muted-foreground/60 text-muted-foreground")}>
            {done ? <CheckIcon aria-hidden className="size-3.5" strokeWidth={3} /> : <XIcon aria-hidden className="size-3.5" strokeWidth={3} />}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="block max-w-sm space-y-1 py-2">
        <p className="font-semibold">
          {done ? "Xong" : "Bỏ"}
          <span className="font-normal opacity-80">
            {r.by ? ` · ${r.by}` : ""}
            {r.closedAt ? ` · ${agoVi(r.closedAt, now)}` : ""}
          </span>
        </p>
        {r.evidence && <p className="font-mono leading-snug break-all opacity-90">{r.evidence}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function LoopsPanel({ loops, loading, error, now }: { loops: LoopRow[]; loading: boolean; error: string | null; now: number }) {
  return (
    <section aria-labelledby="flow-loops" className="mt-6 max-w-5xl space-y-2">
      <h3 id="flow-loops" className="flex items-center gap-1.5 text-sm font-semibold">
        <RepeatIcon aria-hidden className="size-3.5 text-muted-foreground" />
        Vòng lặp
        <span className="text-xs font-normal text-muted-foreground">/ship-loop, đọc từ su-code/ship/*/LOOP.md</span>
      </h3>
      {error && !loops.length ? (
        <ErrorNote what="vòng lặp" error={error} />
      ) : loading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : loops.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Chưa có vòng lặp nào trong dự án này. Khi owner chạy <code className="font-mono">/ship-loop</code>, mỗi lượt kiểm ghi một dòng bằng chứng ở đây.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {loops.map((l) => (
            <li key={l.slug} className="grid grid-cols-[minmax(8rem,14rem)_auto_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-2">
              <span className="truncate font-medium" title={l.slug}>
                {l.slug}
              </span>
              <span className="text-xs whitespace-nowrap tabular">
                {l.iter != null ? `lượt ${l.iter}${l.maxIter != null ? `/${l.maxIter}` : ""}` : "chưa chạy lượt"}
                <span className={cn("ml-2", l.running ? "font-medium text-st-running" : "text-muted-foreground")}>{l.running ? "đang chạy" : l.stopped ? `dừng: ${l.stopped}` : "không rõ"}</span>
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={l.last ?? undefined}>
                {l.last ?? "chưa có bằng chứng"} <span className="font-sans">· {agoShort(l.at, now)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
