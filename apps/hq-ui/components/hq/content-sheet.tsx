"use client";

// The sheet a calendar day (or chip) opens: that day's items in full, with the owner's one-tap
// approve, inline caption / time edits, the channels (0064) with a caption and a post status each,
// the AI-label check and "Giao việc". Esc or a click outside closes it; the URL keeps
// `?day=YYYY-MM-DD&item=N` so the owner can share or come back.
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, DownloadIcon, ExternalLinkIcon, Loader2Icon, PlayIcon, RotateCcwIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  aiReason,
  CAPTION_LIMIT,
  captionFor,
  CHANNEL_LABEL,
  channelLine,
  CHANNELS,
  charCount,
  contentWarning,
  FORMAT_LABEL,
  fromLocalInput,
  NO_AI_CONFIRM,
  NO_SCHEDULE,
  nextStatuses,
  stepHint,
  parseDay,
  STATUS_LABEL,
  timeOf,
  toLocalInput,
  whenOf,
  type Channel,
  type ChannelLine,
  type ChannelPost,
  type ContentMedia,
  type ContentStatus,
  type ContentRow,
  type ContentTextField,
} from "@/lib/content";
import { bytes } from "@/lib/disk";
import { agoShort } from "@/lib/now";
import { cn } from "@/lib/utils";
import { AssignBox, Editable, FORMAT_TONE, STATUS_EDGE, STATUS_TONE, StatusIcon, type Patch } from "./content-bits";
import { DAY_NAMES } from "./content-calendar";
import { TOUCH } from "./room-send";
import type { Api } from "./use-hq";

/** The sheet's `day`: a "YYYY-MM-DD", or this for the items with no time yet. */
export const NO_DAY = "none";

export function dayTitle(day: string): string {
  if (day === NO_DAY) return "Chưa có lịch đăng";
  const d = parseDay(day);
  return d ? `${DAY_NAMES[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` : day;
}

export function ContentSheet({
  day,
  item,
  items,
  schedule,
  api,
  now,
  patch,
  errors,
  onClose,
  onItem,
  reload,
}: {
  /** null = closed. */
  day: string | null;
  item: number | null;
  /** That day's items, in time order. */
  items: ContentRow[];
  schedule: boolean;
  api: Api;
  now: number;
  patch: Patch;
  errors: Record<number, string>;
  onClose: () => void;
  onItem: (id: number | null) => void;
  reload: () => void;
}) {
  // One item open at a time: the one in the URL, else the only one.
  const shown = item ?? (items.length === 1 ? items[0].id : null);
  return (
    <Sheet open={day !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-xl motion-reduce:animate-none">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">{day ? dayTitle(day) : ""}</SheetTitle>
          <SheetDescription className="text-xs">
            {items.length ? `${items.length} bài` : "Không có bài nào"}
            {!schedule && ` · ${NO_SCHEDULE}`}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Ngày này chưa có bài. Phiên lên lịch đặt `scheduled_at` là bài hiện ở đây.</p>
          ) : (
            <ul className="divide-y">
              {items.map((it) => (
                <li key={it.id}>
                  {shown === it.id ? (
                    <ItemDetail it={it} api={api} now={now} patch={patch} error={errors[it.id]} schedule={schedule} onCollapse={items.length > 1 ? () => onItem(null) : undefined} reload={reload} />
                  ) : (
                    <button type="button" onClick={() => onItem(it.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:bg-accent/50">
                      <ItemLine it={it} />
                      <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Time, format, title, status: the collapsed row and the open item's heading. */
function ItemLine({ it }: { it: ContentRow }) {
  const at = whenOf(it);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{at != null ? timeOf(at) : "--:--"}</span>
      <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", FORMAT_TONE[it.format], STATUS_EDGE[it.status])}>
        <StatusIcon status={it.status} />
        {FORMAT_LABEL[it.format]}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.title}</span>
      <span className={cn("shrink-0 text-xs", STATUS_TONE[it.status])}>{STATUS_LABEL[it.status]}</span>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function ItemDetail({
  it,
  api,
  now,
  patch,
  error,
  schedule,
  onCollapse,
  reload,
}: {
  it: ContentRow;
  api: Api;
  now: number;
  patch: Patch;
  error: string | undefined;
  schedule: boolean;
  onCollapse?: () => void;
  reload: () => void;
}) {
  const warn = contentWarning(it);
  const ai = aiReason(it);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const edit = (field: ContentTextField) => (v: string) => patch(it.id, { [field]: v });
  const at = whenOf(it);
  // The flow's next steps, same as the list: "Duyệt" only once checked, so the 1-tap never meets a
  // trigger refusal it could have avoided; a step the trigger would refuse says why instead.
  // Approve and publish both need the AI tick when flagged: the media folder can change after approval.
  const steps = nextStatuses(it.status);
  const gated = (s: ContentStatus) => (s === "approved" || s === "published") && ai != null;
  const needsTick = steps.some(gated);
  const blocked = needsTick && !confirmed;
  const hints = [...new Set(steps.map((s) => stepHint(it, s)).filter((h): h is string => h != null))];
  // An approved item whose posts already sit on a platform scheduler: they keep the text they were
  // given. Editing captions or channels here says so, next to approve.
  const live = (it.channel_posts ?? []).some((p) => p.state === "scheduled" || p.state === "scheduling");
  const [stale, setStale] = useState(false);
  const channelEdited = () => {
    if (it.status === "approved" && live) setStale(true);
  };

  async function setStatus(status: ContentStatus) {
    setBusy(true);
    try {
      await patch(it.id, gated(status) ? { status, no_ai_confirmed: confirmed } : { status });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-labelledby={`ci-${it.id}`} className="space-y-4 px-4 py-4">
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          {onCollapse ? (
            <button type="button" onClick={onCollapse} className="flex min-w-0 flex-1 items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Thu gọn #${it.id}`}>
              <ItemLine it={it} />
            </button>
          ) : (
            <ItemLine it={it} />
          )}
        </div>
        <h3 id={`ci-${it.id}`} className="text-base font-semibold text-balance">
          <Editable value={it.title} label={`Tiêu đề #${it.id}`} onSave={edit("title")} required />
        </h3>
        <p className="text-xs text-muted-foreground">
          #{it.id} · {it.fb_page}
          {it.assignee_session && (
            <>
              {" "}
              · đang xử lý: <span className="font-medium text-foreground">{it.assignee_base ?? it.assignee_session}</span>
            </>
          )}
        </p>
      </header>

      {(warn || ai || error) && (
        <div className="space-y-2">
          {ai && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
              <p className="flex items-start gap-1.5 font-medium">
                <ShieldAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                Rủi ro nhãn AI: {ai}. Luật mới: không bài nào được để Meta gắn nhãn &quot;AI info&quot;.
              </p>
              {needsTick && (
                <label className="mt-2 flex cursor-pointer items-start gap-2 text-foreground">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 size-4 shrink-0 accent-primary max-sm:size-5" />
                  <span className="text-sm">{NO_AI_CONFIRM}</span>
                </label>
              )}
            </div>
          )}
          {warn && (
            <p className="flex items-start gap-1.5 text-sm font-medium text-destructive">
              <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" /> {warn}
            </p>
          )}
          {error && (
            <p role="alert" className="font-mono text-xs break-words text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {steps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {steps.map((s) =>
            s === "approved" ? (
              <Button key={s} type="button" size="sm" className={cn("min-w-24", TOUCH)} disabled={busy || blocked || stepHint(it, s) != null} onClick={() => void setStatus(s)}>
                <CheckIcon aria-hidden /> Duyệt
              </Button>
            ) : s === "rejected" ? (
              <Button key={s} type="button" size="sm" variant="outline" className={TOUCH} disabled={busy} onClick={() => void setStatus(s)}>
                <XIcon aria-hidden /> Bỏ
              </Button>
            ) : (
              <Button key={s} type="button" size="sm" variant="outline" className={TOUCH} disabled={busy || (gated(s) && !confirmed) || stepHint(it, s) != null} onClick={() => void setStatus(s)}>
                → {STATUS_LABEL[s]}
              </Button>
            ),
          )}
          {hints.map((h) => (
            <span key={h} className="text-xs text-muted-foreground">
              {h}.
            </span>
          ))}
          {blocked && hints.length === 0 && <span className="text-xs text-muted-foreground">Tick xác nhận ở trên để duyệt.</span>}
          {stale && it.status === "approved" && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-foreground">
              <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
              Bài đã lên lịch không tự cập nhật caption: bỏ duyệt rồi duyệt lại.
              <Button type="button" size="sm" variant="outline" className={cn("h-7 text-xs", TOUCH)} disabled={busy} onClick={() => void setStatus("checked")}>
                Bỏ duyệt
              </Button>
            </span>
          )}
        </div>
      )}

      <dl className="space-y-3">
        <Field label="Giờ đăng">
          {schedule ? <TimeEdit at={it.scheduled_at ?? null} fallback={at} onSave={(ms) => patch(it.id, { scheduled_at: ms })} id={it.id} /> : <span className="text-xs text-muted-foreground">{NO_SCHEDULE}</span>}
        </Field>
        {it.channels !== undefined && (
          <Field label="Kênh">
            <ChannelsBox it={it} patch={patch} onEdit={channelEdited} />
          </Field>
        )}
        <Field label={it.channels !== undefined ? "Caption chung" : "Caption"}>
          <Editable
            value={it.caption}
            label={`Caption #${it.id}`}
            onSave={async (v) => {
              const ok = await patch(it.id, { caption: v });
              if (ok) channelEdited();
              return ok;
            }}
            multiline
          />
        </Field>
        {/* Always shown (owner 2026-11-04: a clip with no file had no way to watch or download it): set the render's path here. */}
        <Field label="Media">
          <Editable value={it.media_path} label={`Media #${it.id} (đường dẫn file hoặc thư mục)`} onSave={edit("media_path")} />
          {it.media_path &&
            (it.media.length === 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">không đọc được file ảnh/video ở đường dẫn này</p>
            ) : (
              <div className="mt-1.5 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
                {it.media.map((m) => (
                  <MediaTile key={`${m.index}:${m.name}:${m.size}`} m={m} />
                ))}
              </div>
            ))}
        </Field>
        <Field label="Nguồn">
          <Editable value={it.source_url} label={`Nguồn #${it.id}`} onSave={edit("source_url")} link />
          {it.source_approved_at != null ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-st-running">
              <CheckIcon aria-hidden className="size-3" /> đã duyệt nguồn · {it.source_approved_by} · {agoShort(it.source_approved_at, now)}
            </p>
          ) : it.source_url ? (
            <Button type="button" size="sm" variant="outline" className={cn("mt-1 h-7 text-xs", TOUCH)} onClick={() => void patch(it.id, { approve_source: it.source_url })}>
              Duyệt nguồn
            </Button>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">chưa có nguồn</p>
          )}
        </Field>
        <Field label="Tin news">
          <Editable value={it.news_url} label={`Tin news #${it.id}`} onSave={edit("news_url")} link />
        </Field>
        <Field label="Bài FB">
          <Editable value={it.fb_post_url} label={`Bài FB #${it.id}`} onSave={edit("fb_post_url")} link />
        </Field>
        {it.check_note && (
          <Field label="Ghi chú check">
            <span className="text-sm whitespace-pre-wrap">{it.check_note}</span>
          </Field>
        )}
      </dl>

      <div className="rounded-lg border p-3">
        <AssignBox it={it} api={api} now={now} canSave={schedule} onSaved={reload} />
      </div>
    </article>
  );
}

/** "Kênh": which platforms get the item, each with its caption and how its post stands. */
function ChannelsBox({ it, patch, onEdit }: { it: ContentRow; patch: Patch; onEdit: () => void }) {
  const selected = it.channels ?? [];
  const posts = new Map((it.channel_posts ?? []).map((p) => [p.channel, p]));
  const [busy, setBusy] = useState(false);
  async function toggle(ch: Channel) {
    const next = selected.includes(ch) ? selected.filter((c) => c !== ch) : CHANNELS.filter((c) => c === ch || selected.includes(c));
    setBusy(true);
    try {
      if (await patch(it.id, { channels: next })) onEdit();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div role="group" aria-label={`Kênh đăng #${it.id}`} className="flex flex-wrap gap-1.5">
        {CHANNELS.map((ch) => {
          const on = selected.includes(ch);
          const last = on && selected.length === 1;
          return (
            <button
              key={ch}
              type="button"
              aria-pressed={on}
              disabled={busy || last}
              title={last ? "Cần ít nhất một kênh" : undefined}
              onClick={() => void toggle(ch)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed max-sm:min-h-11 motion-reduce:transition-none",
                on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent/50",
              )}
            >
              {on && <CheckIcon aria-hidden className="size-3" />}
              {CHANNEL_LABEL[ch]}
            </button>
          );
        })}
      </div>
      {selected.map((ch) => (
        <ChannelCaption key={ch} it={it} ch={ch} post={posts.get(ch)} patch={patch} onEdit={onEdit} />
      ))}
    </div>
  );
}

const LINE_TONE: Record<ChannelLine["tone"], string> = {
  muted: "text-muted-foreground",
  busy: "text-foreground",
  ok: "text-st-running",
  bad: "text-destructive",
};

/**
 * One channel's caption: its own text (`captions_json`) or, until edited, what `captionFor` reads from
 * the shared caption. Saving the shared text back keeps it shared; clearing an own caption returns to it.
 */
function ChannelCaption({ it, ch, post, patch, onEdit }: { it: ContentRow; ch: Channel; post: ChannelPost | undefined; patch: Patch; onEdit: () => void }) {
  const own = it.captions_json?.[ch]?.trim() || null;
  const shared = captionFor({ caption: it.caption, captions_json: null }, ch);
  const value = own ?? shared ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const saving = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const text = draft ?? value;
  const count = charCount(text.trim());
  const limit = CAPTION_LIMIT[ch];
  const line = channelLine(it, post);
  const id = `cap-${it.id}-${ch}`;

  async function save(body: string) {
    saving.current = true;
    try {
      if (await patch(it.id, { captions_json: { [ch]: body } })) {
        setDraft(null);
        onEdit();
      }
    } finally {
      saving.current = false;
    }
  }
  async function commit() {
    if (draft === null || saving.current) return;
    const v = draft.trim();
    // Same as the shared text: keep reading it (no own copy to drift); an emptied box drops the own copy.
    const body = v === (shared ?? "") ? "" : v;
    if (v === value || (body === "" && !own)) return setDraft(null);
    await save(body);
  }
  async function retry() {
    setRetrying(true);
    try {
      await patch(it.id, { retry_channel: ch });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-1.5 border-t pt-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 id={`${id}-h`} className="text-xs font-semibold">
          {CHANNEL_LABEL[ch]}
        </h4>
        <p className={cn("flex min-w-0 items-center gap-1 text-xs", LINE_TONE[line.tone])}>
          {line.tone === "busy" && <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />}
          <span className="min-w-0 break-words">{line.text}</span>
        </p>
        {line.link && (
          <a href={line.link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-xs text-primary underline-offset-2 hover:underline">
            Mở bài <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        )}
        {line.retry && (
          <Button type="button" size="sm" variant="outline" className={cn("h-6 px-2 text-[11px]", TOUCH)} disabled={retrying} onClick={() => void retry()}>
            <RotateCcwIcon aria-hidden /> Thử lại
          </Button>
        )}
      </div>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") {
            // Inside the sheet, Esc cancels the edit only (not the sheet).
            e.stopPropagation();
            setDraft(null);
          }
        }}
        aria-label={`Caption ${CHANNEL_LABEL[ch]} #${it.id}`}
        aria-describedby={`${id}-meta`}
        placeholder={`Chưa có caption cho ${CHANNEL_LABEL[ch]}: viết ở đây, hoặc thêm phần === ${ch.toUpperCase()} === vào caption chung`}
        className="max-h-72 min-h-20 text-sm"
      />
      <div id={`${id}-meta`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1">
          {draft !== null && draft.trim() !== value
            ? "Chưa lưu: Ctrl+Enter hoặc bấm ra ngoài để lưu, Esc để huỷ"
            : own
              ? `Caption riêng cho ${CHANNEL_LABEL[ch]}`
              : shared
                ? "Lấy từ caption chung; sửa ở đây để viết riêng cho kênh này"
                : "Chưa có caption"}
        </span>
        {own && draft === null && (
          <button type="button" className="rounded px-1 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:min-h-11" onClick={() => void save("")}>
            Dùng caption chung
          </button>
        )}
        <span className={cn("tabular-nums", count > limit && "font-medium text-destructive")}>
          {count.toLocaleString("vi-VN")}/{limit.toLocaleString("vi-VN")} ký tự{count > limit ? ", quá giới hạn" : ""}
        </span>
      </div>
    </section>
  );
}

function TimeEdit({ id, at, fallback, onSave }: { id: number; at: number | null; fallback: number | null; onSave: (ms: number | null) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const saving = useRef(false);
  const value = draft ?? (at != null ? toLocalInput(at) : "");
  async function commit() {
    if (draft === null || saving.current) return;
    // Chromium reports "" while any part is blank (mid-retype): that is not "clear the date".
    const ms = draft ? fromLocalInput(draft) : null;
    if (ms == null || ms === at) return setDraft(null);
    saving.current = true;
    try {
      if (await onSave(ms)) setDraft(null);
    } finally {
      saving.current = false;
    }
  }
  async function clear() {
    if (saving.current) return;
    saving.current = true;
    try {
      if (await onSave(null)) setDraft(null);
    } finally {
      saving.current = false;
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
        }}
        aria-label={`Giờ đăng #${id}`}
        className={cn("h-8 w-auto text-sm", TOUCH)}
      />
      {at != null && (
        <Button type="button" size="sm" variant="ghost" className={cn("h-7 px-2 text-xs text-muted-foreground", TOUCH)} onClick={() => void clear()}>
          Bỏ lịch
        </Button>
      )}
      {at == null && fallback != null && <span className="text-xs text-muted-foreground">chưa đặt lịch; đang xếp theo giờ đã đăng {timeOf(fallback)}</span>}
    </div>
  );
}

function MediaTile({ m }: { m: ContentMedia }) {
  // `m.url` is signed (no token header needed): the browser streams it. A video loads only on tap, then
  // seeks with Range requests, so a 2 GB render never sits in memory. The URL is pinned on first view
  // so the hourly re-signed URL of a later poll does not restart a playing video; the tile is keyed by
  // name + size, so a re-rendered file remounts with its new URL.
  const [want, setWant] = useState(m.kind === "image");
  const [src] = useState(m.url);
  const [failed, setFailed] = useState(false);
  return (
    <figure className={cn("overflow-hidden rounded-lg border", m.ai && "border-destructive/60")}>
      <div className="relative grid aspect-video place-items-center bg-muted">
        {!want ? (
          <Button type="button" size="sm" variant="outline" className={TOUCH} onClick={() => setWant(true)} aria-label={`Xem video ${m.name}`}>
            <PlayIcon aria-hidden /> Xem · {bytes(m.size)}
          </Button>
        ) : failed ? (
          <span className="px-2 text-center text-[11px] text-muted-foreground">không tải được, mở lại mục này</span>
        ) : m.kind === "video" ? (
          <video src={src} controls autoPlay playsInline preload="metadata" onError={() => setFailed(true)} className="absolute inset-0 size-full object-contain" aria-label={m.name} />
        ) : (
          // A signed API URL: next/image would proxy it through the optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={m.name} onError={() => setFailed(true)} className="absolute inset-0 size-full object-contain" />
        )}
      </div>
      <figcaption className="flex items-center gap-1 px-1.5 py-1 text-[11px]">
        <span className="min-w-0 flex-1 truncate" title={m.name}>
          {m.name}
        </span>
        {m.ai && (
          <span className="shrink-0 font-medium text-destructive" title={m.ai}>
            AI
          </span>
        )}
        {/* A real link: the browser's own download manager streams it to disk, any size, with progress. */}
        <a
          href={`${m.url}&dl=1`}
          download={m.name}
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-9"
          aria-label={`Tải ${m.name} (${bytes(m.size)})`}
          title={`Tải ${m.name} (${bytes(m.size)})`}
        >
          <DownloadIcon className="size-3.5" aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}
