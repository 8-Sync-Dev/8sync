"use client";

import { ArrowLeftIcon, PauseIcon, PlusIcon, SendHorizontalIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Bot } from "@/lib/bots";
import type { GroupSendResult } from "@/lib/server/group-send";
import type { Group, GroupLogEntry, GroupsView, HeldTurn } from "@/lib/server/groups";
import type { Room } from "@/lib/server/office";
import { stripContextLine } from "@/lib/room-context";
import { cn } from "@/lib/utils";
import { clock } from "../bits";
import { MentionTextarea } from "../mention-textarea";
import type { Hq } from "../use-hq";
import { BotAvatar } from "./bot-avatar";
import { GroupAvatar } from "./group-avatar";
import type { ComboBot } from "./mention-combobox";
import { FullReply, useFullReply } from "./full-reply";
import { useBotBrief } from "./use-bot-brief";

/** The open group's log, while it is on screen. */
const LOG_POLL_MS = 4_000;
/** "Cho thêm": hops (and a fresh bot-message budget) the owner grants a held turn. */
const MORE_HOPS = 3;

type Log = { entries: GroupLogEntry[]; held: HeldTurn | null };

/**
 * One group's thread (su-code/research/hq-bots-groups.md §2): the owner's messages on the right, the
 * bots' messages to each other on the left as "A → B", what the loop guard held or dropped as notes,
 * the members' latest answers to the last turn, and a box where "@" names a bot. Only the @-named
 * members get a message; a turn that hit its limit shows a banner until the owner gives more or stops.
 */
export function GroupThread({
  hq,
  group,
  all,
  mention,
  mobile,
  onBack,
  onGroups,
}: {
  hq: Hq;
  group: Group;
  /** Every live bot: names and faces of members and senders. */
  all: Bot<Room>[];
  /** What "@" can name: every live bot, the group's members first. */
  mention: ComboBot[];
  mobile: boolean;
  onBack: () => void;
  /** Reads the groups again after a change (a member added, the group deleted). */
  onGroups: () => void;
}) {
  const byId = useMemo(() => new Map(all.map((b) => [b.room.name, b])), [all]);
  const nameOf = useCallback((id: string) => (id === "owner" ? "Anh" : (byId.get(id)?.name ?? id.slice(0, 12))), [byId]);
  const members = group.members.map((id) => ({ id, bot: byId.get(id) ?? null }));
  const awake = members.filter((m) => m.bot).length;
  const bots = useMemo(() => [...mention.filter((b) => group.members.includes(b.id)), ...mention.filter((b) => !group.members.includes(b.id))], [mention, group.members]);

  const log = useGroupLog(hq.api, group.id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string[]>([]);
  const [stopped, setStopped] = useState<string | null>(null);
  const held = log.held && log.held.turn !== stopped ? log.held : null;
  const bottom = useRef<HTMLDivElement>(null);
  const count = log.entries.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const lastOwner = [...log.entries].reverse().find((e) => e.kind === "owner") ?? null;

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const r = await hq.api<GroupSendResult>(`/api/groups/${group.id}/send`, { method: "POST", body: { text: body } });
      setText("");
      setInvite(r.notMembers);
      if (r.unknown.length) toast.message(`Không có bot ${r.unknown.map((u) => `@${u}`).join(", ")} đang mở`);
      for (const h of r.held) toast.message(h.reason === "max-parallel" ? `${nameOf(h.room)} chưa nhận: nhóm gửi tối đa ${group.maxParallel} bot một lúc` : `${nameOf(h.room)} đang chờ anh trả lời trong terminal`);
      if (r.chief && "error" in r.chief) toast.error(r.chief.error);
      for (const d of r.delivered) if (d.delivery === "failed") toast.error(`Chưa tới ${nameOf(d.room)}: ${d.error}`);
      log.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function more(turn: string) {
    try {
      await hq.api(`/api/groups/${group.id}/continue`, { method: "POST", body: { turn, extra: MORE_HOPS } });
      log.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addMembers(ids: string[]) {
    try {
      await hq.api<GroupsView>("/api/groups", { method: "PUT", body: { group: { id: group.id, members: [...group.members, ...ids] } } });
      onGroups();
      setInvite([]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove() {
    if (!window.confirm(`Xoá nhóm “${group.name}”? Các bot vẫn chạy; chỉ mất nhóm và nhật ký của nhóm.`)) return;
    try {
      await hq.api<GroupsView>(`/api/groups?id=${encodeURIComponent(group.id)}`, { method: "DELETE" });
      onGroups();
      onBack();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className={cn("flex shrink-0 items-center gap-2 border-b bg-background/95 px-2 py-2 sm:px-3", mobile && "pt-[max(0.5rem,env(safe-area-inset-top))]")}>
        {mobile && (
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Về danh sách" className="size-11 shrink-0">
            <ArrowLeftIcon aria-hidden className="size-5" />
          </Button>
        )}
        <GroupAvatar emoji={group.emoji} faces={members.map((m) => ({ key: m.bot?.key ?? m.id, status: m.bot?.status ?? "idle" }))} size={mobile ? 36 : 40} className={mobile ? undefined : "ml-1"} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold tracking-tight">{group.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {members.length} bot · {awake} đang mở · {group.mode === "chief" ? "không @ thì Chief chia việc" : "chỉ bot được @ nhận tin"} · tối đa {group.maxHops} hop
          </p>
        </div>
        <Button type="button" size="icon" variant="ghost" onClick={remove} aria-label="Xoá nhóm" title="Xoá nhóm" className="shrink-0 max-md:size-11">
          <Trash2Icon aria-hidden />
        </Button>
      </header>

      <ul aria-label="Thành viên" className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none]">
        {members.map((m) => (
          <li key={m.id} className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-muted/70 pr-2.5 pl-1 text-xs", !m.bot && "opacity-60")}>
            <BotAvatar id={m.bot?.key ?? m.id} status={m.bot?.status ?? "idle"} size={20} />
            <span className="font-medium">{m.bot?.name ?? m.id.slice(0, 12)}</span>
            {!m.bot && <span className="text-muted-foreground">ngủ</span>}
          </li>
        ))}
      </ul>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4 sm:px-6">
          {!log.loaded ? null : count === 0 ? (
            <p className="py-8 text-center text-sm text-pretty text-muted-foreground">
              Chưa có tin nào. Gõ <span className="font-mono">@</span> rồi chọn bot để giao việc; bot nhắn cho nhau trong lượt đó hiện ở đây.
            </p>
          ) : (
            log.entries.map((e) => <Entry key={e.n} e={e} nameOf={nameOf} bot={byId.get(e.from) ?? null} />)
          )}
          {lastOwner && lastOwner.to.length > 0 && (
            <div className="space-y-2">
              {lastOwner.to.map((id) => {
                const b = byId.get(id);
                return b ? <MemberAnswer key={id} hq={hq} bot={b} since={lastOwner.ts} /> : null;
              })}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      {held && (
        <div role="status" className="shrink-0 border-t bg-st-needs/10 px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 text-sm">
            <p className="min-w-0 flex-1 text-pretty max-sm:basis-full">
              Đã đủ {held.botMsgs} lượt bot nói với nhau (hop {held.hop}/{held.hopCap}). Tin tiếp theo giữa các bot đang bị giữ lại.
            </p>
            <Button type="button" size="sm" onClick={() => more(held.turn)} className="max-md:h-11">
              <PlusIcon aria-hidden /> Cho thêm {MORE_HOPS} lượt
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setStopped(held.turn)} className="max-md:h-11">
              <PauseIcon aria-hidden /> Dừng
            </Button>
          </div>
        </div>
      )}

      {invite.length > 0 && (
        <div className="shrink-0 border-t px-4 py-2 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 text-sm">
            <p className="min-w-0 flex-1">{invite.map(nameOf).join(", ")} chưa ở trong nhóm nên chưa nhận tin. Thêm vào nhóm?</p>
            <Button type="button" size="sm" variant="outline" onClick={() => addMembers(invite)} className="max-md:h-11">
              <UserPlusIcon aria-hidden /> Thêm vào nhóm
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setInvite([])} className="max-md:h-11">
              Thôi
            </Button>
          </div>
        </div>
      )}

      <form
        className="shrink-0 border-t bg-background px-4 py-3 sm:px-6 max-sm:px-3 max-sm:py-2 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border bg-card p-1 focus-within:ring-2 focus-within:ring-ring/40">
          <div className="min-w-0 flex-1">
            <label htmlFor="group-composer" className="sr-only">
              Nhắn nhóm {group.name}
            </label>
            <MentionTextarea
              id="group-composer"
              value={text}
              onValueChange={setText}
              base={null}
              commands={false}
              bots={bots}
              api={hq.api}
              onKeyDown={onKey}
              rows={1}
              maxLength={2400}
              placeholder={`Nhắn ${group.name} · @ để gọi bot`}
              className="max-h-[30dvh] min-h-11 resize-none overflow-y-auto border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
          <Button type="submit" size="sm" className="mb-1 max-md:size-11" disabled={busy || !text.trim()} aria-label="Gửi">
            <SendHorizontalIcon aria-hidden />
            <span className="max-md:sr-only">Gửi</span>
          </Button>
        </div>
      </form>
    </div>
  );
}

function Entry({ e, nameOf, bot }: { e: GroupLogEntry; nameOf: (id: string) => string; bot: Bot<Room> | null }) {
  if (e.kind === "owner") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11px] text-muted-foreground">
          {e.to.length ? `Anh → ${e.to.map(nameOf).join(", ")}` : "Anh · chỉ ghi vào nhóm"} · <span className="tabular">{clock(e.ts)}</span>
        </span>
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words text-primary-foreground">{e.text}</div>
      </div>
    );
  }
  if (e.kind === "room") {
    return (
      <div className="flex items-start gap-2">
        {bot ? <BotAvatar id={bot.key} status={bot.status} size={28} /> : <span className="size-7 shrink-0 rounded-full bg-muted" aria-hidden />}
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{nameOf(e.from)}</span> → {e.to.map(nameOf).join(", ")} · hop {e.hop} · <span className="tabular">{clock(e.ts)}</span>
          </span>
          <div className="max-w-full rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words">{stripContextLine(e.text)}</div>
        </div>
      </div>
    );
  }
  const what = e.kind === "held" ? `Đã giữ lại tin ${nameOf(e.from)} → ${e.to.map(nameOf).join(", ")}: đủ lượt` : e.kind === "dropped" ? `Bỏ tin lặp ${nameOf(e.from)} → ${e.to.map(nameOf).join(", ")}` : e.text;
  return (
    <p className={cn("text-center text-xs", e.kind === "held" ? "text-foreground" : "text-muted-foreground")} title={e.kind === "note" ? undefined : stripContextLine(e.text)}>
      {what} · <span className="tabular">{clock(e.ts)}</span>
    </p>
  );
}

/** A member's latest answer once it replied after the owner's last turn: its whole last reply (GET /api/turns, folded when long), the brief's summary until that loads. */
function MemberAnswer({ hq, bot, since }: { hq: Hq; bot: Bot<Room>; since: number }) {
  const brief = useBotBrief(hq.api, bot.room);
  const summary = brief?.lastReply && (brief.updatedAt ?? 0) > since ? brief.lastReply : null;
  const full = useFullReply(hq.api, bot.room, since, !!summary);
  const reply = full ?? summary;
  if (!reply && bot.status !== "working") return null;
  return (
    <div className="flex items-start gap-2">
      <BotAvatar id={bot.key} status={bot.status} size={28} />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{bot.name}</span> · {reply ? "trả lời gần nhất" : "đang làm…"}
        </span>
        {reply && (
          <div className="max-w-full rounded-2xl rounded-tl-md border bg-background px-3.5 py-2.5 text-sm">
            {full ? <FullReply text={full} /> : <p className="whitespace-pre-wrap break-words">{reply}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** GET /api/groups/<id>/log every few seconds while open, after the last line seen. */
function useGroupLog(api: Hq["api"], id: string) {
  const [state, setState] = useState<Log & { id: string; loaded: boolean }>({ id, entries: [], held: null, loaded: false });
  const [nonce, setNonce] = useState(0);
  const last = state.id === id ? (state.entries.at(-1)?.n ?? 0) : 0;
  const after = useRef(last);
  useEffect(() => {
    after.current = last;
  }, [last]);
  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const r = await api<Log>(`/api/groups/${encodeURIComponent(id)}/log?after=${after.current}`, { signal: ac.signal });
          setState((s) => (s.id === id ? { id, entries: [...s.entries, ...r.entries.filter((e) => e.n > (s.entries.at(-1)?.n ?? 0))], held: r.held, loaded: true } : { id, entries: r.entries, held: r.held, loaded: true }));
        } catch {
          /* the next poll tries again */
        }
      }
      if (!ac.signal.aborted) timer = setTimeout(poll, LOG_POLL_MS);
    };
    void poll();
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [api, id, nonce]);
  const cur = state.id === id ? state : { entries: [], held: null, loaded: false };
  return { ...cur, refresh: () => setNonce((n) => n + 1) };
}
