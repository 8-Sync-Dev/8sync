"use client";

// "Góp ý" in the open item (owner 2026-11-06): the owner's comments, saved as drafts (HQ's own DB, so
// they survive a reload and show on the owner's other devices), then sent all at once to the item's
// posting room in one message. Owner only: a guest never renders it (the routes are owner only too).
import { ChevronRightIcon, Loader2Icon, MessageSquareTextIcon, PencilIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useCallback, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { stampOf, timeOf, dayKey } from "@/lib/content";
import { COMMENT_MAX, type CommentList, type ContentComment } from "@/lib/content-comments";
import { inboxText } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { TOUCH } from "./room-send";
import type { Api } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 30_000;
const EMPTY: CommentList = { drafts: [], sent: [] };

export type Comments = {
  list: CommentList;
  loaded: boolean;
  error: string | null;
  /** Each answers true when the server took it; a refusal is shown as a toast. */
  add: (text: string) => Promise<boolean>;
  edit: (id: number, text: string) => Promise<boolean>;
  remove: (c: ContentComment) => Promise<boolean>;
  send: (room: { session: string; label: string }) => Promise<boolean>;
};

/**
 * The item's comments (GET /api/content/comments, polled while `on`). A write's answer carries the
 * lists, shown at once; the next poll takes over.
 */
export function useComments(api: Api, item: number, on: boolean): Comments {
  const poll = usePoll<CommentList>(api, `/api/content/comments?item=${item}`, POLL_MS, on);
  const [fresh, setFresh] = useState<{ list: CommentList; at: number } | null>(null);
  const list = fresh && fresh.at >= poll.at ? fresh.list : (poll.data ?? EMPTY);
  const take = useCallback((r: CommentList) => setFresh({ list: { drafts: r.drafts, sent: r.sent }, at: Date.now() }), []);
  const run = useCallback(
    async (fn: () => Promise<CommentList>, fail: string): Promise<boolean> => {
      try {
        take(await fn());
        return true;
      } catch (e) {
        toast.error(`${fail}: ${(e as Error).message}`);
        return false;
      }
    },
    [take],
  );
  const add = useCallback(
    (text: string) => run(() => api<CommentList>("/api/content/comments", { method: "POST", body: { item, text } }), "Chưa lưu được góp ý"),
    [api, item, run],
  );
  const edit = useCallback(
    (id: number, text: string) => run(() => api<CommentList>(`/api/content/comments?id=${id}`, { method: "PATCH", body: { text } }), "Chưa sửa được góp ý"),
    [api, run],
  );
  const remove = useCallback(
    async (c: ContentComment) => {
      const ok = await run(() => api<CommentList>(`/api/content/comments?id=${c.id}`, { method: "DELETE" }), "Chưa xoá được góp ý");
      if (ok) toast("Đã xoá góp ý", { action: { label: "Hoàn tác", onClick: () => void add(c.text) } });
      return ok;
    },
    [api, run, add],
  );
  const send = useCallback(
    async (room: { session: string; label: string }) => {
      try {
        const r = await api<CommentList & { count: number; delivered: { delivery: string; live?: boolean } }>("/api/content/comments/send", {
          method: "POST",
          body: { item, session: room.session, base: room.label },
        });
        take(r);
        toast.success(`Đã gửi ${r.count} góp ý cho ${room.label}${r.delivered.delivery === "inbox" ? `: ${inboxText(r.delivered.live, room.session)}` : ""}`);
        return true;
      } catch (e) {
        toast.error((e as Error).message);
        return false;
      }
    },
    [api, item, take],
  );
  return { list, loaded: poll.data != null, error: poll.data ? null : poll.error, add, edit, remove, send };
}

/** "HH:mm" today, else "HH:mm dd/MM". */
const when = (ms: number, now: number) => (dayKey(ms) === dayKey(now) ? timeOf(ms) : stampOf(ms));

/** Ctrl/Cmd+Enter runs `save`; Esc runs `cancel` and stays inside the box (not the sheet or the pane). */
function keys(save: () => void, cancel?: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    }
    if (e.key === "Escape" && cancel) {
      e.stopPropagation();
      e.preventDefault();
      cancel();
    }
  };
}

const counter = (text: string) => {
  const n = [...text.trim()].length;
  return n > COMMENT_MAX * 0.9 ? <span className={cn("tabular-nums", n > COMMENT_MAX && "font-medium text-destructive")}>{`${n.toLocaleString("vi-VN")}/${COMMENT_MAX.toLocaleString("vi-VN")}`}</span> : null;
};

/**
 * The "Góp ý" box: type, "Lưu góp ý" (Ctrl/Cmd+Enter), the drafts (each editable / deletable), then
 * "Gửi N góp ý cho <phòng>" and the "Đã gửi" history. `room` null: no posting room yet (the button
 * says why).
 */
export function CommentsBox({ id, c, room, now }: { id: number; c: Comments; room: { session: string; label: string } | null; now: number }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const drafts = c.list.drafts;
  const n = drafts.length;
  const hid = `gy-${id}`;
  const tooLong = [...text.trim()].length > COMMENT_MAX;

  async function save() {
    if (!text.trim() || tooLong || saving) return;
    setSaving(true);
    try {
      if (await c.add(text)) setText("");
    } finally {
      setSaving(false);
    }
  }
  async function send() {
    if (!room || n === 0 || sending) return;
    setSending(true);
    try {
      await c.send(room);
    } finally {
      setSending(false);
    }
  }

  return (
    <section id={hid} aria-labelledby={`${hid}-h`} className="space-y-2.5 rounded-lg border p-3">
      <h4 id={`${hid}-h`} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold">
        <MessageSquareTextIcon aria-hidden className="size-3.5 text-muted-foreground" />
        Góp ý
        <span className="font-normal text-muted-foreground">{n > 0 ? `· ${n} chưa gửi` : "· lưu lại, gửi một lần khi xong"}</span>
      </h4>
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={`${hid}-new`} className="sr-only">
          Góp ý mới cho mục #{id}
        </label>
        <Textarea
          id={`${hid}-new`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keys(() => void save())}
          rows={2}
          placeholder="Góp ý cho phòng đăng, vd: ảnh bìa tối quá, đổi câu mở đầu (Ctrl+Enter để lưu)"
          aria-invalid={tooLong || undefined}
          className="min-h-16 text-sm"
        />
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="mr-auto min-w-0">Chỉ lưu, chưa gửi cho phòng.</span>
          {counter(text)}
          <Button type="submit" size="sm" variant="outline" className={cn("text-xs", TOUCH)} disabled={!text.trim() || tooLong || saving}>
            {saving && <Loader2Icon aria-hidden className="animate-spin" />} Lưu góp ý
          </Button>
        </div>
      </form>

      {c.error && (
        <p role="alert" className="text-xs text-destructive">
          Chưa tải được góp ý: {c.error}
        </p>
      )}

      {n > 0 && (
        <ol aria-label={`${n} góp ý chưa gửi`} className="divide-y rounded-md border">
          {drafts.map((d, i) => (
            <DraftRow key={d.id} n={i + 1} d={d} c={c} now={now} />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Button type="button" size="sm" className={cn("max-w-full text-xs", TOUCH)} disabled={!room || n === 0 || sending} onClick={() => void send()}>
          {sending ? <Loader2Icon aria-hidden className="animate-spin" /> : <SendIcon aria-hidden />}
          <span className="min-w-0 truncate">{room && n > 0 ? `Gửi ${n} góp ý cho ${room.label}` : "Gửi góp ý"}</span>
        </Button>
        {!room ? (
          <span className="text-[11px] text-muted-foreground">Chưa có phòng nhận: chọn phiên ở Giao việc.</span>
        ) : n === 0 ? (
          <span className="text-[11px] text-muted-foreground">Chưa có góp ý nào để gửi.</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Một tin, kèm dòng [Nội dung #{id}].</span>
        )}
      </div>

      <SentHistory sent={c.list.sent} now={now} />
    </section>
  );
}

function DraftRow({ n, d, c, now }: { n: number; d: ContentComment; c: Comments; now: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tooLong = draft !== null && [...draft.trim()].length > COMMENT_MAX;
  async function save() {
    if (draft === null || busy) return;
    if (draft.trim() === d.text) return setDraft(null);
    if (!draft.trim() || tooLong) return;
    setBusy(true);
    try {
      if (await c.edit(d.id, draft)) setDraft(null);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await c.remove(d);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex items-start gap-2 px-2.5 py-2 text-sm">
      <span aria-hidden className="w-4 shrink-0 pt-px text-right text-xs text-muted-foreground tabular-nums">
        {n}.
      </span>
      {draft !== null ? (
        <div className="min-w-0 flex-1 space-y-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keys(
              () => void save(),
              () => setDraft(null),
            )}
            aria-label={`Sửa góp ý ${n}`}
            aria-invalid={tooLong || undefined}
            className="min-h-16 text-sm"
            autoFocus
          />
          <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-muted-foreground">
            {counter(draft)}
            <Button type="button" size="sm" variant="ghost" className={cn("h-7 text-xs", TOUCH)} onClick={() => setDraft(null)}>
              Huỷ
            </Button>
            <Button type="button" size="sm" variant="outline" className={cn("h-7 text-xs", TOUCH)} disabled={busy || !draft.trim() || tooLong} onClick={() => void save()}>
              {busy && <Loader2Icon aria-hidden className="animate-spin" />} Lưu
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="break-words whitespace-pre-wrap">{d.text}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">lưu {when(d.created_at, now)}</p>
          </div>
          <div className="flex shrink-0 items-center">
            <Button type="button" size="icon-sm" variant="ghost" className={cn("text-muted-foreground", TOUCH)} aria-label={`Sửa góp ý ${n}`} title="Sửa" disabled={busy} onClick={() => setDraft(d.text)}>
              <PencilIcon aria-hidden />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" className={cn("text-muted-foreground hover:text-destructive", TOUCH)} aria-label={`Xoá góp ý ${n}`} title="Xoá" disabled={busy} onClick={() => void remove()}>
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

/** "Đã gửi": the newest sends, one group per send (same time and room), folded by default. */
function SentHistory({ sent, now }: { sent: ContentComment[]; now: number }) {
  if (sent.length === 0) return null;
  const groups: { key: string; at: number; room: string; rows: ContentComment[] }[] = [];
  for (const s of sent) {
    const key = `${s.sent_at}:${s.sent_to}`;
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(s);
    else groups.push({ key, at: s.sent_at ?? 0, room: s.sent_label ?? s.sent_to ?? "phòng đăng", rows: [s] });
  }
  return (
    <details className="group/sent text-xs">
      <summary className={cn("flex cursor-pointer list-none items-center gap-1 rounded text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden", TOUCH)}>
        <ChevronRightIcon aria-hidden className="size-3.5 transition-transform duration-150 group-open/sent:rotate-90 motion-reduce:transition-none" />
        Đã gửi ({sent.length})
      </summary>
      <div className="mt-1.5 space-y-2">
        {groups.map((g) => (
          <div key={g.key} className="space-y-1">
            <p className="text-[11px] text-muted-foreground">
              {when(g.at, now)} · cho <span className="font-medium text-foreground">{g.room}</span>
            </p>
            <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
              {[...g.rows].reverse().map((s) => (
                <li key={s.id} className="break-words whitespace-pre-wrap">
                  {s.text}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </details>
  );
}
