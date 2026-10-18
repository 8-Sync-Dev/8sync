"use client";

import { ArrowRightIcon, GitBranchIcon, LayoutDashboardIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { askLine } from "@/lib/ask";
import { cardParts } from "@/lib/card-tags";
import { LANES, type Board } from "@/lib/lanes";
import { agoShort, roster, rosterSummary } from "@/lib/now";
import { groupByRepo, worktreeOf } from "@/lib/sidebar";
import { recentMoves, topCards } from "@/lib/overview";
import { fileName, rootKey, type ProjectPreviews } from "@/lib/preview";
import type { ProjectBoard } from "@/lib/server/board";
import { buildTeamThread, partyKey, type ThreadItem } from "@/lib/team-thread";
import { cn } from "@/lib/utils";
import { AskPanel, type AskRoom } from "./ask-panel";
import { EmptyState, ErrorNote, shortName } from "./bits";
import { LANE_VI, TONE_INK, laneTone } from "./card-sheet";
import { PreviewImage } from "./preview-view";
import { StateTag, type RosterRow } from "./now-roster";
import { RoleIcon } from "./role-badge";
import type { Message } from "./types";
import type { BoardsState } from "./use-board";
import type { OfficeState, Room } from "./use-office";
import type { PreviewState } from "./preview-view";

export type OverviewTab = "office" | "group" | "board" | "preview" | "flow";

const CHAT_KINDS = new Set<ThreadItem["kind"]>(["owner", "reply", "handoff", "task_created", "task_completed"]);

/**
 * Tổng quan: every live project on one wide screen. Each project is one block with five panels
 * (rooms, board, previews, latest moves, chat), separated by hairlines, never cards in cards.
 * What waits for the owner is pinned above all projects.
 */
export function OverviewView({
  office,
  boards,
  previews,
  messages,
  token,
  onTab,
  onOpenRoom,
  onOpenCard,
  focus = null,
  onAll,
}: {
  office: OfficeState;
  boards: BoardsState;
  previews: PreviewState;
  messages: Message[];
  token: string;
  onTab: (t: OverviewTab) => void;
  onOpenRoom: (r: Room) => void;
  onOpenCard: (root: string, id: number) => void;
  /** A repo root picked in the sidebar: only its block (and its asks) show. */
  focus?: string | null;
  onAll?: () => void;
}) {
  const rooms = useMemo(() => office.office?.rooms ?? [], [office.office]);
  const now = office.office?.at ?? 0;
  const rows: RosterRow[] = useMemo(
    () => roster(rooms, boards.boards ?? [], now).map((r) => ({ ...r, model: r.room.model, waiting: askLine(r.room.ask) ?? r.room.waiting })),
    [rooms, boards.boards, now],
  );
  // Same rule as the office: rooms stopped on the owner, plus permission hooks counting down.
  const asking: AskRoom[] = useMemo(
    () =>
      rows.flatMap((n) => {
        const r = rooms.find((x) => x.key === n.key);
        if (!r || (n.state !== "needs" && !r.permit)) return [];
        return [{ key: r.key, label: r.label, session_id: r.session_id, project: r.project?.name ?? null, waiting: r.waiting, ask: r.ask, permit: r.permit, tmux: r.delivery === "terminal" }];
      }),
    [rows, rooms],
  );
  // A room in a worktree belongs to its repo's block: same board, same previews.
  const all = useMemo(() => groupByRepo(rooms.filter((r) => r.status !== "ended")), [rooms]);
  const groups = useMemo(() => (focus ? all.filter((g) => rootKey(g.project.root) === rootKey(focus)) : all), [all, focus]);
  // Words only: session start/end and "needs you" pings are status, the roster already shows them.
  const thread = useMemo(() => buildTeamThread(messages).filter((t) => t.text.trim() && CHAT_KINDS.has(t.kind)), [messages]);

  if (office.error && !office.office) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="tổng quan" error={office.error} onRetry={office.retry} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6 px-4 py-5 sm:px-6">
        {!office.office ? (
          <OverviewSkeleton />
        ) : groups.length === 0 ? (
          <EmptyState icon={<LayoutDashboardIcon />} title="Chưa có phòng nào đang chạy">
            Mở team ở tab Văn phòng: mỗi dự án có phòng chạy sẽ thành một khối ở đây, gồm phòng, board, ảnh preview, card vừa chuyển và chat.
          </EmptyState>
        ) : (
          <>
            {focus && all.length > 1 && (
              <p className="text-sm text-muted-foreground">
                Đang xem một dự án.{" "}
                <button type="button" className="font-medium text-foreground underline underline-offset-4 hover:no-underline" onClick={onAll}>
                  Xem cả {all.length} dự án
                </button>
              </p>
            )}
            <AskPanel
              wide
              rooms={focus ? asking.filter((a) => groups.some((g) => g.rooms.some((r) => r.key === a.key))) : asking}
              now={now}
              token={token}
              onOpen={(key) => {
                const r = rooms.find((x) => x.key === key);
                if (r) onOpenRoom(r);
              }}
            />
            <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,56rem),1fr))]">
              {groups.map((g) => {
                const k = rootKey(g.project.root);
                const pb = (boards.boards ?? []).find((b) => rootKey(b.root) === k || (b.filed != null && rootKey(b.filed) === k));
                const pv = previews.data?.projects.find((p) => rootKey(p.root) === k);
                const keys = new Set(g.rooms.map((r) => r.key));
                const names = new Set(g.rooms.flatMap((r) => [r.name, r.session_id, r.label].filter(Boolean).map((x) => partyKey(x))));
                return (
                  <ProjectBlock
                    key={g.project.root}
                    name={g.project.name}
                    root={g.project.root}
                    branches={[...new Set(g.rooms.filter((r) => !worktreeOf(r)).map((r) => r.project?.branch).filter(Boolean))] as string[]}
                    rows={rows.filter((r) => keys.has(r.key))}
                    rooms={g.rooms}
                    board={pb ?? null}
                    boardsLoaded={boards.boards != null}
                    previews={pv ?? null}
                    previewsLoaded={previews.data != null}
                    chat={thread.filter((t) => [t.session, t.from, t.to].some((x) => x != null && names.has(partyKey(x)))).slice(-5)}
                    now={now}
                    token={token}
                    onTab={onTab}
                    onOpenRoom={onOpenRoom}
                    onOpenCard={(id) => onOpenCard(pb?.root ?? g.project.root, id)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** One project: a header line, then five panels on a fluid grid (5 across at ~2000 px, stacking below). */
function ProjectBlock({
  name,
  root,
  branches,
  rows,
  rooms,
  board,
  boardsLoaded,
  previews,
  previewsLoaded,
  chat,
  now,
  token,
  onTab,
  onOpenRoom,
  onOpenCard,
}: {
  name: string;
  root: string;
  branches: string[];
  rows: RosterRow[];
  rooms: Room[];
  board: ProjectBoard | null;
  boardsLoaded: boolean;
  previews: ProjectPreviews | null;
  previewsLoaded: boolean;
  chat: ThreadItem[];
  now: number;
  token: string;
  onTab: (t: OverviewTab) => void;
  onOpenRoom: (r: Room) => void;
  onOpenCard: (id: number) => void;
}) {
  const id = `ov-${root.replace(/[^\w-]/g, "_")}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card">
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <h2 id={id} className="text-base font-semibold tracking-tight" title={root}>
          {name}
        </h2>
        {branches.map((b) => (
          <span key={b} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <GitBranchIcon className="size-3" aria-hidden />
            {b}
          </span>
        ))}
        <span className="text-xs text-muted-foreground tabular">{rows.length ? rosterSummary(rows) : `${rooms.length} phòng`}</span>
      </header>
      {/* Hairlines between panels: each panel draws its right and bottom edge, the outer ones are clipped. */}
      <div className="overflow-hidden rounded-b-xl">
      <div className="-mr-px -mb-px grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,17.5rem),1fr))]">
        <Panel title="Phòng" action="Văn phòng" onAction={() => onTab("office")}>
          {rows.length === 0 ? (
            <Quiet>Không phòng nào đang chạy.</Quiet>
          ) : (
            <ul className="-mx-1.5 space-y-px">
              {rows.slice(0, 8).map((n) => {
                const r = rooms.find((x) => x.key === n.key);
                return (
                  <li key={n.key}>
                    <button
                      type="button"
                      onClick={() => r && onOpenRoom(r)}
                      className="grid w-full min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-1 text-[13px] font-medium">
                          <RoleIcon role={n.role} className="text-muted-foreground" />
                          <span className="truncate">{n.label}</span>
                        </span>
                        {r && worktreeOf(r) && (
                          <span className="flex min-w-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground" title={`worktree ${worktreeOf(r)}`}>
                            <GitBranchIcon aria-hidden className="size-2.5 shrink-0" />
                            <span className="truncate">{r.project?.branch ?? worktreeOf(r)}</span>
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <StateTag n={n} />
                        <span className="block truncate text-[11px] text-muted-foreground" title={n.waiting ?? n.last?.text ?? undefined}>
                          {n.card ? `#${n.card.id} · ` : ""}
                          {n.state === "needs" ? (n.waiting ?? "chờ anh") : (n.last?.text ?? "chưa có hoạt động")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Board" action="Board" onAction={() => onTab("board")}>
          {!boardsLoaded ? (
            <Skeleton className="h-24 w-full" />
          ) : !board?.board ? (
            <Quiet>{board?.error ?? "Chưa đọc được board của dự án này."}</Quiet>
          ) : (
            <MiniBoard b={board.board} onOpenCard={onOpenCard} />
          )}
        </Panel>

        <Panel title="Preview" action="Preview" onAction={() => onTab("preview")}>
          {!previewsLoaded ? (
            <Skeleton className="aspect-[16/10] w-full" />
          ) : !previews?.items.length ? (
            <Quiet>
              Chưa có ảnh. Phòng qa/ui lưu ảnh vào <code className="font-mono">qa/evidence/card-&lt;số&gt;-…png</code>.
            </Quiet>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {previews.items.slice(0, 4).map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onTab("preview")} className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`${fileName(i.rel)}, mở tab Preview`}>
                    <PreviewImage id={i.id} token={token} alt="" className="aspect-[16/10] w-full rounded-md border" />
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular">
                      {i.card != null ? `#${i.card} · ` : ""}
                      {agoShort(i.mtime, now)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Vừa chuyển" action="Flow" onAction={() => onTab("flow")}>
          {!boardsLoaded ? <Skeleton className="h-24 w-full" /> : !board?.board ? <Quiet>Chưa có board.</Quiet> : <MiniFlow b={board.board} now={now} />}
        </Panel>

        <Panel title="Chat" action="Chat tổng" onAction={() => onTab("group")}>
          {chat.length === 0 ? (
            <Quiet>Chưa có tin nào của các phòng này.</Quiet>
          ) : (
            <ul className="space-y-1.5">
              {chat.map((t) => (
                <li key={t.key} className="min-w-0 text-[12px] leading-snug">
                  <span className="font-medium">{t.from === "owner" ? "anh" : shortName(t.fromName ?? t.from)}</span>
                  {t.to && <span className="text-muted-foreground"> → {t.to === "owner" ? "anh" : shortName(t.toName ?? t.to)}</span>}
                  <span className="text-muted-foreground tabular"> · {agoShort(t.ts, now)}</span>
                  <span className="line-clamp-2 text-muted-foreground">{t.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      </div>
    </section>
  );
}

function Panel({ title, action, onAction, children }: { title: string; action: string; onAction: () => void; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-r border-b px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-0.5 rounded-sm text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {action}
          <ArrowRightIcon aria-hidden className="size-3" />
        </button>
      </div>
      {children}
    </div>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="text-xs text-pretty text-muted-foreground">{children}</p>;

/** Lane counts as one strip, then the first cards of each busy lane. */
function MiniBoard({ b, onOpenCard }: { b: Board; onOpenCard: (id: number) => void }) {
  const busy = topCards(b, 2);
  const done = b.closed.filter((c) => c.state === "done").length;
  return (
    <div className="space-y-2.5">
      <ol className="grid grid-cols-7 gap-1" aria-label="Số card mỗi cột">
        {LANES.map((l) => {
          const n = b.lanes[l.key].length;
          return (
            <li key={l.key} style={laneTone(l.key)} className="min-w-0 text-center" title={`${l.label}: ${n} card`}>
              <span className={cn("block h-1 rounded-full", n ? "bg-(--tone)" : "bg-muted")} />
              <span className={cn("block text-[13px] font-semibold tabular", n ? "text-foreground" : "text-muted-foreground/60")}>{n}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{l.label}</span>
            </li>
          );
        })}
      </ol>
      {busy.length === 0 ? (
        <Quiet>Hết card mở{done ? ` · ${done} đã xong gần đây` : ""}.</Quiet>
      ) : (
        <ul className="space-y-1.5">
          {busy.flatMap((g) =>
            g.cards.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpenCard(c.id)}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-md text-left text-[12px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <span style={laneTone(g.lane)} className={cn("w-16 shrink-0 truncate text-[11px] font-medium", TONE_INK)}>
                    {LANE_VI[g.lane]}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{c.id}</span>
                  <span className="min-w-0 truncate">{cardParts(c.text).title}</span>
                  {c.prio != null && c.prio < 2 && (
                    <span className={cn("ml-auto shrink-0 rounded px-1 font-mono text-[10px] font-semibold", c.prio === 0 ? "bg-destructive/12 text-destructive" : "bg-st-needs/18 text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs")}>
                      P{c.prio}
                    </span>
                  )}
                </button>
              </li>
            )),
          )}
        </ul>
      )}
    </div>
  );
}

/** The latest lane change of each card: from → to, who, when. */
function MiniFlow({ b, now }: { b: Board; now: number }) {
  const moves = recentMoves(b, 5);
  if (!moves.length) return <Quiet>Chưa card nào chuyển cột.</Quiet>;
  return (
    <ul className="space-y-1.5">
      {moves.map((m) => (
        <li key={`${m.id}-${m.at}`} className="min-w-0 text-[12px] leading-snug">
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{m.id}</span>
            <span className="truncate">{cardParts(m.text).title}</span>
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <LaneDot k={m.from} />
            <ArrowRightIcon aria-hidden className="size-3" />
            <LaneDot k={m.to} />
            {m.room && <span className="truncate">· {m.room}</span>}
            <span className="shrink-0 tabular">· {agoShort(m.at, now)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function LaneDot({ k }: { k: (typeof LANES)[number]["key"] | "done" | "dropped" }) {
  if (k === "done" || k === "dropped") return <span className={cn("font-medium", k === "done" ? "text-st-running" : "")}>{k === "done" ? "Xong" : "Bỏ"}</span>;
  return (
    <span style={laneTone(k)} className={cn("inline-flex items-center gap-0.5 font-medium", TONE_INK)}>
      <span aria-hidden className="size-1.5 rounded-full bg-(--tone)" />
      {LANE_VI[k]}
    </span>
  );
}
