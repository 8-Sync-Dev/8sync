"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { BOT_STATUS_LABEL, filterBots, fold } from "@/lib/bots";
import { agoShort } from "@/lib/now";
import { TREE_WORD, type TreeSession } from "@/lib/session-tree";
import { BotAvatar } from "./bots/bot-avatar";
import { GroupAvatar } from "./bots/group-avatar";
import type { Roster } from "./bots/use-roster";

/** Sessions past this many: the owner narrows the words instead of scrolling. */
const MAX_SESSIONS = 30;

const hit =
  "flex min-h-12 w-full min-w-0 items-center gap-3 px-3 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset";

/**
 * Tìm (owner 2026-11-07: Bots · Nhóm · Tìm · Thêm): one box over the bots (name, role, project, what
 * they say), the groups and every session (title, folder, worktree). Accents are optional.
 */
export function SearchView({
  roster,
  sessions,
  onOpenBot,
  onOpenGroup,
  onOpenSession,
}: {
  roster: Roster;
  sessions: readonly TreeSession[];
  onOpenBot: (key: string) => void;
  onOpenGroup: (id: string) => void;
  onOpenSession: (s: TreeSession) => void;
}) {
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const words = useMemo(() => fold(q).split(/\s+/).filter(Boolean), [q]);
  const bots = useMemo(() => (words.length ? filterBots(roster.bots, q) : []), [roster.bots, q, words.length]);
  const byName = useMemo(() => new Map(roster.all.map((b) => [b.room.name, b])), [roster.all]);
  const groups = useMemo(
    () => (words.length ? roster.groups.filter((g) => words.every((w) => fold([g.name, ...g.members.map((m) => byName.get(m)?.display ?? "")].join(" ")).includes(w))) : []),
    [roster.groups, words, byName],
  );
  const found = useMemo(
    () => (words.length ? sessions.filter((s) => words.every((w) => fold([s.title, s.name, s.folder, s.worktree ?? ""].join(" ")).includes(w))).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) : []),
    [sessions, words],
  );
  const none = words.length > 0 && !bots.length && !groups.length && !found.length;

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-2xl space-y-5 px-3 py-4 sm:px-6">
        <div role="search" className="relative">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm bot, nhóm, phiên…"
            aria-label="Tìm bot, nhóm hoặc phiên"
            autoComplete="off"
            className="h-11 pr-10 pl-9 text-base sm:text-sm [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Xoá ô tìm"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          )}
        </div>

        {!words.length ? (
          <p className="text-sm text-muted-foreground">Gõ tên bot, vai trò, dự án hoặc tên phiên. Không cần gõ dấu.</p>
        ) : none ? (
          <p role="status" className="text-sm text-muted-foreground">
            Không thấy gì khớp “{q}”.
          </p>
        ) : null}

        {bots.length > 0 && (
          <section aria-labelledby="search-bots" className="space-y-2">
            <h2 id="search-bots" className="text-xs font-medium text-muted-foreground">
              Bot <span className="tabular">{bots.length}</span>
            </h2>
            <ul className="divide-y rounded-xl border">
              {bots.map((b) => (
                <li key={b.key}>
                  <button type="button" className={hit} onClick={() => onOpenBot(b.key)}>
                    <BotAvatar id={b.key} status={b.status} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{b.display}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {BOT_STATUS_LABEL[b.status]} · {b.role} · {b.section}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.length > 0 && (
          <section aria-labelledby="search-groups" className="space-y-2">
            <h2 id="search-groups" className="text-xs font-medium text-muted-foreground">
              Nhóm <span className="tabular">{groups.length}</span>
            </h2>
            <ul className="divide-y rounded-xl border">
              {groups.map((g) => (
                <li key={g.id}>
                  <button type="button" className={hit} onClick={() => onOpenGroup(g.id)}>
                    <GroupAvatar emoji={g.emoji} faces={g.members.map((m) => ({ key: byName.get(m)?.key ?? m, status: byName.get(m)?.status ?? ("idle" as const) }))} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{g.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{g.members.length} bot</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {found.length > 0 && (
          <section aria-labelledby="search-sessions" className="space-y-2">
            <h2 id="search-sessions" className="text-xs font-medium text-muted-foreground">
              Phiên <span className="tabular">{found.length}</span>
            </h2>
            <ul className="divide-y rounded-xl border">
              {found.slice(0, MAX_SESSIONS).map((s) => (
                <li key={s.key}>
                  <button type="button" className={hit} onClick={() => onOpenSession(s)} title={s.cwd ?? s.name}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[TREE_WORD[s.state], s.folder, s.worktree && `worktree ${s.worktree}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">{agoShort(s.at, roster.now)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {found.length > MAX_SESSIONS && <p className="text-xs text-muted-foreground">Còn {found.length - MAX_SESSIONS} phiên nữa: gõ thêm chữ để thu hẹp.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
