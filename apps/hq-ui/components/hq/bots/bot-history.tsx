"use client";

import { ChevronRightIcon, GitBranchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { branchIndex, groupBranches } from "@/lib/branches";
import { agoShort } from "@/lib/now";
import type { RosterBot } from "@/lib/roster";
import { TREE_WORD, type TreeChild, type TreeSession, type TreeState } from "@/lib/session-tree";
import { groupKey } from "@/lib/sidebar";
import { cn } from "@/lib/utils";
import { useBranches } from "../nav-actions";
import type { Hq } from "../use-hq";

/** Older sessions past this many wait behind "Xem thêm". */
const FIRST = 12;

const DOT: Record<TreeState, string> = {
  needs: "bg-st-needs",
  working: "bg-st-running",
  done: "bg-muted-foreground/60",
  error: "bg-destructive",
  idle: "bg-muted-foreground/30",
};

/**
 * Lịch sử phiên, a tab of the bot's page (owner 2026-11-07: worktrees, subagents and old sessions left
 * the sidebar for here): the bot's own session with its subagents, the other sessions in its repo
 * (newest first, each with its worktree and subagents), and the repo's worktrees with no session.
 * A session opens like it did from the sidebar (its chat, or a Không gian pane).
 */
export function BotHistory({
  bot,
  sessions,
  now,
  api,
  onOpen,
  onOpenRepo,
}: {
  bot: Pick<RosterBot, "key" | "display" | "root" | "section">;
  sessions: readonly TreeSession[];
  now: number;
  api: Hq["api"];
  onOpen: (s: TreeSession) => void;
  /** An idle worktree: its Tổng quan. */
  onOpenRepo: (root: string, name: string) => void;
}) {
  const [all, setAll] = useState(false);
  const own = useMemo(() => sessions.filter((s) => s.room === bot.key), [sessions, bot.key]);
  const others = useMemo(
    () =>
      bot.root == null
        ? []
        : sessions.filter((s) => s.room !== bot.key && s.root != null && groupKey(s.root) === groupKey(bot.root!)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
    [sessions, bot.key, bot.root],
  );
  const repos = useBranches(api, bot.root ?? "");
  const idle = useMemo(() => (repos && bot.root ? (groupBranches({ root: bot.root, sessions: [...own, ...others] }, branchIndex(repos))?.idle ?? []) : []), [repos, bot.root, own, others]);
  const shown = all ? others : others.slice(0, FIRST);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-4 sm:px-6">
      <section aria-labelledby="hist-own" className="space-y-2">
        <h3 id="hist-own" className="text-sm font-semibold">
          Phiên của {bot.display}
        </h3>
        {own.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa thấy phiên của bot này trong danh sách phiên.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {own.map((s) => (
              <SessionItem key={s.key} s={s} now={now} onOpen={onOpen} current />
            ))}
          </ul>
        )}
      </section>

      {bot.root != null && (
        <section aria-labelledby="hist-repo" className="space-y-2">
          <h3 id="hist-repo" className="text-sm font-semibold">
            Phiên khác trong {bot.section}
            {others.length > 0 && <span className="ml-1.5 font-normal text-muted-foreground tabular">{others.length}</span>}
          </h3>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có phiên nào khác trong repo này.</p>
          ) : (
            <>
              <ul className="divide-y rounded-xl border">
                {shown.map((s) => (
                  <SessionItem key={s.key} s={s} now={now} onOpen={onOpen} />
                ))}
              </ul>
              {others.length > FIRST && (
                <button
                  type="button"
                  aria-expanded={all}
                  onClick={() => setAll((x) => !x)}
                  className="h-9 rounded-md px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-11"
                >
                  {all ? "Thu gọn" : `Xem thêm ${others.length - FIRST} phiên cũ hơn`}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {idle.length > 0 && (
        <section aria-labelledby="hist-idle" className="space-y-2">
          <h3 id="hist-idle" className="text-sm font-semibold">
            Worktree chưa có phiên <span className="ml-1 font-normal text-muted-foreground tabular">{idle.length}</span>
          </h3>
          <ul className="divide-y rounded-xl border">
            {idle.map((sp) => (
              <li key={sp.key}>
                <button
                  type="button"
                  onClick={() => onOpenRepo(sp.path, sp.name)}
                  title={sp.path}
                  className="flex min-h-11 w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
                >
                  <GitBranchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-medium">{sp.label}</span>
                  {sp.main ? <span className="text-xs text-muted-foreground">nhánh chính</span> : <span className="min-w-0 truncate text-xs text-muted-foreground">{sp.name}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SessionItem({ s, now, onOpen, current = false }: { s: TreeSession; now: number; onOpen: (s: TreeSession) => void; current?: boolean }) {
  const [open, setOpen] = useState(current);
  const ago = agoShort(s.at, now);
  return (
    <li>
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          onClick={() => onOpen(s)}
          title={s.cwd ?? s.name}
          className={cn("flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset", current && "bg-muted/40")}
        >
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[s.state])} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{s.title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="shrink-0">{TREE_WORD[s.state]}</span>
              {s.worktree && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex min-w-0 items-center gap-1 truncate">
                    <GitBranchIcon aria-hidden className="size-3 shrink-0" /> worktree {s.worktree}
                  </span>
                </>
              )}
              {s.doing && s.state === "working" && (
                <>
                  <span aria-hidden>·</span>
                  <span className="min-w-0 truncate">{s.doing}</span>
                </>
              )}
            </span>
          </span>
          {ago && <span className="shrink-0 text-xs text-muted-foreground tabular">{ago}</span>}
        </button>
        {s.children.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Thu gọn" : "Xem"} ${s.children.length} phiên con của ${s.title}`}
            onClick={() => setOpen((o) => !o)}
            className="mr-1 inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span className="tabular">{s.children.length}</span> phiên con
            <ChevronRightIcon aria-hidden className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
          </button>
        )}
      </div>
      {open && s.children.length > 0 && (
        <ul aria-label={`Phiên con của ${s.title}`} className="border-t bg-muted/20 py-1">
          {s.children.map((c) => (
            <ChildItem key={c.key} c={c} now={now} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ChildItem({ c, now }: { c: TreeChild; now: number }) {
  const ago = agoShort(c.at, now);
  return (
    <li className="flex min-h-9 min-w-0 items-center gap-2.5 py-1 pr-3 pl-8 text-[13px]" title={c.detail ?? undefined}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[c.state])} />
      <span className="min-w-0 flex-1 truncate">{c.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{TREE_WORD[c.state]}</span>
      {ago && <span className="shrink-0 text-xs text-muted-foreground tabular">{ago}</span>}
    </li>
  );
}
