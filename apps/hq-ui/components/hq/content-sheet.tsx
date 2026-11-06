"use client";

// The sheet a calendar day (or chip) opens: that day's items in full, with the owner's one-tap
// approve (the owner's also sends the posting task to the chosen session), inline caption / time
// edits, the channels (0064) with a caption and a post status each, the optional AI-label answer and
// "Giao việc". Its header counts the day's posts per platform against the target and splits the
// sheet by platform. Esc or a click outside closes it; the URL keeps `?day=YYYY-MM-DD&item=N` so the
// owner can share or come back.
import { AlertTriangleIcon, CalendarCheckIcon, CalendarClockIcon, CheckIcon, ChevronDownIcon, DownloadIcon, ExternalLinkIcon, Loader2Icon, Maximize2Icon, PlayIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  CAPTION_LIMIT,
  captionFor,
  CHANNEL_GROUP_LABEL,
  CHANNEL_GROUPS,
  channelGroup,
  CHANNEL_LABEL,
  CHANNEL_SHORT,
  channelLine,
  CHANNELS,
  channelsOf,
  charCount,
  contentWarning,
  FORMAT_LABEL,
  fromLocalInput,
  GUEST_DROPBACK_FIELDS,
  GUEST_DROPBACK_NOTE,
  httpLink,
  isChannel0065,
  manualLine,
  NO_CHANNELS_0065,
  NO_SCHEDULE,
  PLATFORM_DAILY_TARGET,
  nextStatuses,
  stepHint,
  parseDay,
  scheduledOf,
  STATUS_LABEL,
  targetState,
  timeOf,
  toLocalInput,
  unapprovedLive,
  whenOf,
  type Channel,
  type ChannelGroup,
  type ChannelLine,
  type ChannelPost,
  type ContentMedia,
  type ContentStatus,
  type ContentRow,
  type ContentTextField,
  type AssignPref,
  type PlatformCounts,
} from "@/lib/content";
import { atLeast, GUEST_AWAITS_APPROVAL } from "@/lib/access";
import { bytes } from "@/lib/disk";
import { agoShort } from "@/lib/now";
import { cn } from "@/lib/utils";
import { useAccess } from "./access";
import { AssignBox, Editable, FORMAT_TONE, sessionLabel, STATUS_EDGE, STATUS_TONE, StatusIcon, useAssignSessions, type Patch } from "./content-bits";
import { CopyButton } from "./copy-button";
import { DAY_NAMES } from "./content-calendar";
import { ItemResults, NO_RESULTS, ResultMark, ResultStrip, type ResultIndex } from "./content-results";
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
  platform,
  onPlatform,
  counts,
  channels0065,
  schedule,
  assign,
  api,
  token,
  results = NO_RESULTS,
  now,
  patch,
  errors,
  onClose,
  onItem,
  reload,
  onOpenFile,
}: {
  /** null = closed. */
  day: string | null;
  item: number | null;
  /** That day's items, in time order (only those going out on `platform` when one is picked). */
  items: ContentRow[];
  /** The platform the sheet is split by; null = all. */
  platform: Channel | null;
  onPlatform: (c: Channel | null) => void;
  /** The day's posts per platform (`platformDays`); null for the items with no time yet. */
  counts: PlatformCounts | null;
  /** Migration 0065 is in: TikTok / X / Instagram / Zalo can be picked. */
  channels0065: boolean;
  schedule: boolean;
  /** The saved default session for "Duyệt" (GET /api/content `assign`). */
  assign: AssignPref | null;
  api: Api;
  token: string;
  /** What the rooms reported back (owner only; empty for a guest). */
  results?: ResultIndex;
  now: number;
  patch: Patch;
  errors: Record<number, string>;
  onClose: () => void;
  onItem: (id: number | null) => void;
  reload: () => void;
  /** A reported file: shown in the Kết quả tab (owner HQ only; a guest never sees Kết quả). */
  onOpenFile?: (id: string) => void;
}) {
  // One item open at a time: the one in the URL, else the only one.
  const shown = item ?? (items.length === 1 ? items[0].id : null);
  return (
    <Sheet open={day !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">{day ? dayTitle(day) : ""}</SheetTitle>
          <SheetDescription className="text-xs">
            {daySummary(items)}
            {platform && ` trên ${CHANNEL_LABEL[platform]}`}
            {!schedule && ` · ${NO_SCHEDULE}`}
          </SheetDescription>
          <PlatformBar counts={counts} platform={platform} onPlatform={onPlatform} />
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Ngày này chưa có bài. Phiên lên lịch đặt `scheduled_at` là bài hiện ở đây.</p>
          ) : (
            <ul className="divide-y">
              {items.map((it) => (
                <li key={it.id}>
                  {shown === it.id ? (
                    <ItemDetail
                      it={it}
                      api={api}
                      token={token}
                      results={results}
                      now={now}
                      patch={patch}
                      error={errors[it.id]}
                      schedule={schedule}
                      channels0065={channels0065}
                      assign={assign}
                      onCollapse={items.length > 1 ? () => onItem(null) : undefined}
                      reload={reload}
                      onOpenFile={onOpenFile}
                    />
                  ) : (
                    <>
                      <button type="button" onClick={() => onItem(it.id)} className="flex w-full items-start gap-2 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50 motion-reduce:transition-none">
                        <ItemLine it={it} results={results} />
                        <ChevronDownIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      </button>
                      {results.arts.has(it.id) && (
                        <div className="-mt-1 pr-4 pb-3 pl-18">
                          <ResultStrip token={token} arts={results.arts.get(it.id)} />
                        </div>
                      )}
                    </>
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

/** "6 bài · 3 đủ lịch · 2 chờ duyệt": what the day needs at a glance. */
function daySummary(items: ContentRow[]): string {
  if (items.length === 0) return "Không có bài nào";
  const full = items.filter((it) => {
    const s = scheduledOf(it);
    return s != null && s.total > 0 && s.done === s.total;
  }).length;
  const waiting = items.filter((it) => it.status === "checked").length;
  return [`${items.length} bài`, full > 0 && `${full} đủ lịch`, waiting > 0 && `${waiting} chờ duyệt`].filter(Boolean).join(" · ");
}

/**
 * The collapsed row (time, title on up to two lines, then format, channels, files, reports) and, with
 * `open`, the open item's heading (no title: its editable title follows).
 */
function ItemLine({ it, results = NO_RESULTS, open = false }: { it: ContentRow; results?: ResultIndex; open?: boolean }) {
  const at = whenOf(it);
  return (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <span className="w-11 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{at != null ? timeOf(at) : "--:--"}</span>
      <span className="min-w-0 flex-1 space-y-1.5">
        {!open && <span className="line-clamp-2 block text-sm leading-snug font-medium">{it.title}</span>}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", FORMAT_TONE[it.format], STATUS_EDGE[it.status])}>
            <StatusIcon status={it.status} />
            {FORMAT_LABEL[it.format]}
          </span>
          <ChannelTags it={it} />
          {/* Which items already have a file to watch or download, without opening each one. */}
          {it.media.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" title={`${it.media.length} file ảnh/video`}>
              <DownloadIcon className="size-3" aria-hidden />
              {it.media.length}
            </span>
          )}
          <ResultMark arts={results.arts.get(it.id)} metrics={results.metrics.get(it.id)} />
        </span>
      </span>
      <span className={cn("shrink-0 pt-0.5 text-xs", STATUS_TONE[it.status])}>{STATUS_LABEL[it.status]}</span>
    </span>
  );
}

/**
 * The item's channels as small tags, each coloured by its post state (✓ scheduled or out, ! failed),
 * the state as the tooltip; "x/y" counts the scheduled ones. Nothing before 0064.
 */
function ChannelTags({ it }: { it: ContentRow }) {
  const s = scheduledOf(it);
  if (!s || s.total === 0) return null;
  const posts = new Map((it.channel_posts ?? []).map((p) => [p.channel, p]));
  const full = s.done === s.total;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" aria-label={`Đã lên lịch ${s.done}/${s.total} kênh`}>
      {(it.channels ?? []).map((c) => {
        const line = channelLine(it, posts.get(c));
        return (
          <span
            key={c}
            title={`${CHANNEL_LABEL[c]}: ${line.text}`}
            className={cn(
              "inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px] leading-4 font-medium",
              line.tone === "ok" ? "border-st-running/40 text-st-running" : line.tone === "bad" ? "border-destructive/40 text-destructive" : "text-muted-foreground",
            )}
          >
            {CHANNEL_SHORT[c]}
            {line.tone === "ok" && <CheckIcon aria-hidden className="size-2.5" />}
            {line.tone === "bad" && <AlertTriangleIcon aria-hidden className="size-2.5" />}
          </span>
        );
      })}
      <span className={cn("text-[11px] tabular-nums", full ? "text-st-running" : "text-muted-foreground")} aria-hidden>
        {s.done}/{s.total}
      </span>
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
  token,
  results,
  now,
  patch,
  error,
  schedule,
  channels0065,
  assign,
  onCollapse,
  reload,
  onOpenFile,
}: {
  it: ContentRow;
  api: Api;
  token: string;
  results: ResultIndex;
  now: number;
  patch: Patch;
  error: string | undefined;
  schedule: boolean;
  channels0065: boolean;
  assign: AssignPref | null;
  onCollapse?: () => void;
  reload: () => void;
  onOpenFile?: (id: string) => void;
}) {
  const role = useAccess();
  const canEdit = atLeast(role, "editor");
  const warn = contentWarning(it);
  const [busy, setBusy] = useState(false);
  // A guest's edit of what an approved item posts sends it back to "checked" on the server; say so.
  const guestDropped = () => {
    if (role !== "owner" && it.status === "approved") toast.info(GUEST_DROPBACK_NOTE);
  };
  const edit = (field: ContentTextField) => async (v: string) => {
    const ok = await patch(it.id, { [field]: v });
    if (ok && (GUEST_DROPBACK_FIELDS as readonly string[]).includes(field)) guestDropped();
    return ok;
  };
  const at = whenOf(it);
  // The flow's next steps, same as the list: "Duyệt" only once checked, so the 1-tap never meets a
  // trigger refusal it could have avoided; a step the trigger would refuse says why instead.
  // "Đã đăng" is the owner's (403 for a guest); "Duyệt" stays so a guest sees "Chờ chủ HQ duyệt" there.
  const steps = nextStatuses(it.status).filter((s) => role === "owner" || s !== "published");
  const hints = [...new Set(steps.map((s) => stepHint(it, s)).filter((h): h is string => h != null))];
  // An approved item whose posts already sit on a platform scheduler: they keep the text they were
  // given. Editing captions or channels here says so, next to approve.
  const live = (it.channel_posts ?? []).some((p) => p.state === "scheduled" || p.state === "scheduling");
  const [stale, setStale] = useState(false);
  const channelEdited = () => {
    guestDropped();
    if (it.status === "approved" && live) setStale(true);
  };

  // Where "Duyệt" sends the posting task (owner only: a guest's "Duyệt" only approves): the pick in
  // "Giao việc", else the item's holder, else the saved default; a session gone from the list is
  // skipped (and a gone default is forgotten).
  const owner = role === "owner";
  const sessions = useAssignSessions(api, owner);
  const known = (s: string | null | undefined): s is string => !!s && (!sessions.loaded || sessions.list.some((r) => r.id === s));
  const [picked, setPicked] = useState<string | null>(null);
  const session = picked ?? [it.assignee_session, assign?.session].find(known) ?? it.assignee_session ?? "";
  const labelOf = (id: string) => {
    const row = sessions.list.find((r) => r.id === id);
    if (row) return sessionLabel(row);
    if (id === it.assignee_session && it.assignee_base) return it.assignee_base;
    if (id === assign?.session && assign.base) return assign.base;
    return id;
  };
  const [need, setNeed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const forgotten = useRef<string | null>(null);
  const goneDefault = owner && sessions.loaded && assign != null && !sessions.list.some((r) => r.id === assign.session) ? assign.session : null;
  useEffect(() => {
    if (!goneDefault || forgotten.current === goneDefault) return;
    forgotten.current = goneDefault;
    api("/api/content/prefs", { method: "PUT", body: { assign: null } })
      .then(reload)
      .catch(() => {});
  }, [goneDefault, api, reload]);

  async function pick(id: string) {
    setPicked(id);
    setNeed(false);
    try {
      await api("/api/content/prefs", { method: "PUT", body: { assign: { session: id, base: labelOf(id) } } });
      reload();
    } catch (e) {
      toast.error(`Chưa lưu được phiên mặc định: ${(e as Error).message}`);
    }
  }

  async function setStatus(status: ContentStatus) {
    setBusy(true);
    try {
      await patch(it.id, { status });
    } finally {
      setBusy(false);
    }
  }

  /**
   * One tap (owner 2026-11-04, owner only): approve AND send the posting task; nothing changes when
   * either fails. `seen` (the `updated_at` on screen) makes an edit made meanwhile answer 409 instead
   * of riding along. A guest never approves (403): it sees "Chờ chủ HQ duyệt" instead.
   */
  async function approve() {
    const seen = it.updated_at;
    const to = known(session) ? session : "";
    if (!to) {
      setNeed(true);
      trigger.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const ok = await patch(it.id, { status: "approved", seen, send: { session: to, base: labelOf(to) } });
      if (ok) toast.success(`Đã duyệt #${it.id} và gửi việc đăng cho ${labelOf(to)}`);
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
              <ItemLine it={it} results={results} open />
            </button>
          ) : (
            <ItemLine it={it} results={results} open />
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
              · Đang xử lý: <span className="font-medium text-foreground">{it.assignee_base ?? it.assignee_session}</span>
            </>
          )}
        </p>
      </header>

      {(warn || error) && (
        <div className="space-y-2">

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

      {canEdit && steps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {steps.map((s) =>
            s === "approved" ? (
              owner ? (
                <Button key={s} type="button" size="sm" className={cn("min-w-24", TOUCH)} disabled={busy || stepHint(it, s) != null} onClick={() => void approve()}>
                  {busy ? <Loader2Icon aria-hidden className="animate-spin" /> : <CheckIcon aria-hidden />} Duyệt
                </Button>
              ) : (
                <span key={s} className="text-xs font-medium text-muted-foreground">
                  {GUEST_AWAITS_APPROVAL}
                </span>
              )
            ) : s === "rejected" ? (
              <Button key={s} type="button" size="sm" variant="outline" className={TOUCH} disabled={busy} onClick={() => void setStatus(s)}>
                <XIcon aria-hidden /> Bỏ
              </Button>
            ) : (
              <Button key={s} type="button" size="sm" variant="outline" className={TOUCH} disabled={busy || stepHint(it, s) != null} onClick={() => void setStatus(s)}>
                → {STATUS_LABEL[s]}
              </Button>
            ),
          )}
          {hints.map((h) => (
            <span key={h} className="text-xs text-muted-foreground">
              {h}.
            </span>
          ))}
          {owner && steps.includes("approved") && hints.length === 0 && (
            <span className="text-xs text-muted-foreground">Duyệt sẽ gửi việc đăng cho {known(session) ? labelOf(session) : "phiên chọn ở Giao việc"}.</span>
          )}
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

      {it.channels !== undefined && <PostingStatus it={it} now={now} patch={patch} canRetry={owner} />}

      <dl className="space-y-3">
        <Field label="Giờ đăng">
          {!schedule ? (
            <span className="text-xs text-muted-foreground">{NO_SCHEDULE}</span>
          ) : canEdit ? (
            <TimeEdit at={it.scheduled_at ?? null} fallback={at} onSave={(ms) => patch(it.id, { scheduled_at: ms })} id={it.id} />
          ) : (
            <span className="text-sm tabular-nums">{at != null ? timeOf(at) : "chưa đặt lịch"}</span>
          )}
        </Field>
        {role === "owner" && (
          <Field label="Kết quả">
            <ItemResults id={it.id} token={token} api={api} arts={results.arts.get(it.id)} metrics={results.metrics.get(it.id)} now={now} onOpenFile={onOpenFile} />
          </Field>
        )}
        {it.channels !== undefined && (
          <Field label="Kênh">
            <ChannelsBox it={it} patch={patch} onEdit={channelEdited} canEdit={canEdit} wide={channels0065} />
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
          {it.caption && (
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <CopyButton value={it.caption} label={`Chép caption #${it.id}`} />
              Chép caption để dán lên trang
            </div>
          )}
        </Field>
        {/* Always shown (owner 2026-11-04: a clip with no file had no way to watch or download it): set the render's path here. */}
        <Field label="Media">
          <Editable value={it.media_path} label={`Media #${it.id} (đường dẫn file hoặc thư mục)`} onSave={edit("media_path")} ownerOnly />
          {it.media_path &&
            (it.media.length === 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">không đọc được file ảnh/video ở đường dẫn này</p>
            ) : (
              <div className="mt-1.5 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
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
          ) : it.source_url && canEdit ? (
            <Button type="button" size="sm" variant="outline" className={cn("mt-1 h-7 text-xs", TOUCH)} onClick={() => void patch(it.id, { approve_source: it.source_url })}>
              Duyệt nguồn
            </Button>
          ) : it.source_url ? (
            <p className="mt-0.5 text-xs text-muted-foreground">nguồn chưa duyệt</p>
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

      {owner && (
        <div className="rounded-lg border p-3">
          <AssignBox
            it={it}
            api={api}
            now={now}
            canSave={schedule}
            onSaved={reload}
            sessions={sessions}
            session={session}
            label={session ? labelOf(session) : ""}
            onPick={(id) => void pick(id)}
            need={need}
            triggerRef={trigger}
          />
        </div>
      )}
    </article>
  );
}

/**
 * "Kênh": which platforms get the item, each with its caption and how its post stands. Before
 * migration 0065 (`wide` false) TikTok / X / Instagram / Zalo cannot be added (one already on stays removable).
 */
function ChannelsBox({ it, patch, onEdit, canEdit, wide }: { it: ContentRow; patch: Patch; onEdit: () => void; canEdit: boolean; wide: boolean }) {
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
      <UnapprovedNote it={it} />
      <div role="group" aria-label={`Kênh đăng #${it.id}`} className="flex flex-wrap gap-1.5">
        {CHANNELS.map((ch) => {
          const on = selected.includes(ch);
          const last = on && selected.length === 1;
          const locked = !wide && !on && isChannel0065(ch);
          return (
            <button
              key={ch}
              type="button"
              aria-pressed={on}
              disabled={!canEdit || busy || last || locked}
              title={last ? "Cần ít nhất một kênh" : locked ? NO_CHANNELS_0065 : undefined}
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
      {!wide && canEdit && <p className="text-[11px] text-muted-foreground">{NO_CHANNELS_0065}.</p>}
      {selected.map((ch) => (
        <ChannelCaption key={ch} it={it} ch={ch} post={posts.get(ch)} patch={patch} onEdit={onEdit} canEdit={canEdit} />
      ))}
    </div>
  );
}

/**
 * The day against `PLATFORM_DAILY_TARGET` per platform: one cell each with "n/10" and a bar (light =
 * planned, solid = scheduled or out); a cell toggles splitting the sheet by that platform. `counts`
 * null (items with no time): the toggles only.
 */
function PlatformBar({ counts, platform, onPlatform }: { counts: PlatformCounts | null; platform: Channel | null; onPlatform: (c: Channel | null) => void }) {
  const met = counts ? CHANNELS.filter((ch) => targetState(counts[ch].planned).met).length : 0;
  const pct = (n: number) => `${Math.min(100, (n / PLATFORM_DAILY_TARGET) * 100)}%`;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {counts ? `Mục tiêu ${PLATFORM_DAILY_TARGET} bài mỗi nền tảng · ${met}/${CHANNELS.length} đủ · vạch đậm: đã lên lịch` : "Lọc theo nền tảng"}
        </p>
        {platform && (
          <button type="button" onClick={() => onPlatform(null)} className={cn("shrink-0 rounded px-1.5 text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60", TOUCH)}>
            Xem tất cả
          </button>
        )}
      </div>
      <div role="group" aria-label="Xem theo nền tảng" className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {CHANNELS.map((ch) => {
          const c = counts?.[ch];
          const t = c ? targetState(c.planned) : null;
          const on = platform === ch;
          return (
            <button
              key={ch}
              type="button"
              aria-pressed={on}
              aria-label={c && t ? `${CHANNEL_LABEL[ch]}: ${c.planned}/${PLATFORM_DAILY_TARGET} bài, ${t.text}, ${c.scheduled} đã lên lịch` : CHANNEL_LABEL[ch]}
              title={c && t ? `${CHANNEL_LABEL[ch]}: ${c.planned}/${PLATFORM_DAILY_TARGET} bài trong ngày (${t.text}), ${c.scheduled} đã lên lịch hoặc đã đăng` : CHANNEL_LABEL[ch]}
              onClick={() => onPlatform(on ? null : ch)}
              className={cn(
                "flex flex-col justify-center gap-1 rounded-md border px-2 py-1.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
                TOUCH,
                on ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50",
              )}
            >
              <span className="flex items-baseline justify-between gap-1 text-[11px] tabular-nums">
                <span className="font-medium">{CHANNEL_SHORT[ch]}</span>
                {c && t && (
                  <span className={t.met ? "text-st-running" : "text-muted-foreground"}>
                    {c.planned}/{PLATFORM_DAILY_TARGET}
                  </span>
                )}
              </span>
              {c && t && (
                <span aria-hidden className="relative block h-1 overflow-hidden rounded-full bg-muted">
                  <span className={cn("absolute inset-y-0 left-0 rounded-full", t.met ? "bg-st-running/35" : "bg-st-needs/35")} style={{ width: pct(c.planned) }} />
                  <span className={cn("absolute inset-y-0 left-0 rounded-full", t.met ? "bg-st-running" : "bg-st-needs")} style={{ width: pct(c.scheduled) }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Đã lên lịch x/y kênh": of the item's channels, those scheduled or already posted (`scheduledOf`).
 * Nothing before 0064. `compact`: the words hide on a phone, the numbers stay.
 */
export function ScheduledChip({ it, compact = false }: { it: ContentRow; compact?: boolean }) {
  const s = scheduledOf(it);
  if (!s || s.total === 0) return null;
  const full = s.done === s.total;
  const Icon = full ? CalendarCheckIcon : CalendarClockIcon;
  const words = compact ? "max-sm:sr-only" : undefined;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] whitespace-nowrap tabular-nums", full ? "border-st-running/40 text-st-running" : "text-muted-foreground")}
      title={`Đã lên lịch ${s.done}/${s.total} kênh (đã lên lịch hoặc đã đăng trên nền tảng)`}
    >
      <Icon aria-hidden className="size-3" />
      <span className={words}>Đã lên lịch </span>
      {s.done}/{s.total}
      <span className={words}> kênh</span>
    </span>
  );
}

/** Scheduled or posted channels on an item that is not approved, named; nothing when there are none. */
function UnapprovedNote({ it }: { it: ContentRow }) {
  const live = unapprovedLive(it);
  if (live.length === 0) return null;
  return (
    <p role="note" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
      <AlertTriangleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {live.map((c) => CHANNEL_LABEL[c]).join(", ")} đã lên lịch/đăng khi bài chưa duyệt. Bỏ duyệt ở HQ không huỷ được: huỷ trên nền tảng, hoặc duyệt để sổ khớp.
    </p>
  );
}

/** The list row's channels: one short tag each, coloured as the sheet colours its line, the line as the tooltip. */
export function ChannelStates({ it }: { it: ContentRow }) {
  const posts = new Map((it.channel_posts ?? []).map((p) => [p.channel, p]));
  const unapproved = unapprovedLive(it).length > 0;
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] whitespace-nowrap">
      {(it.channels ?? []).map((c) => {
        const line = channelLine(it, posts.get(c));
        return (
          <span key={c} className={cn("font-medium", LINE_TONE[line.tone])} title={`${CHANNEL_LABEL[c]}: ${line.text}`}>
            {CHANNEL_SHORT[c]}
            {line.tone === "ok" ? " ✓" : line.tone === "bad" ? " !" : ""}
          </span>
        );
      })}
      {unapproved && <span className="font-medium text-destructive">· lịch khi chưa duyệt</span>}
    </p>
  );
}

const LINE_TONE: Record<ChannelLine["tone"], string> = {
  muted: "text-muted-foreground",
  busy: "text-foreground",
  ok: "text-st-running",
  bad: "text-destructive",
};

const GROUP_TONE: Record<ChannelGroup, string> = { scheduled: "text-st-running", failed: "text-destructive", waiting: "text-muted-foreground" };
const GROUP_ICON: Record<ChannelGroup, typeof CalendarCheckIcon> = { scheduled: CalendarCheckIcon, failed: AlertTriangleIcon, waiting: CalendarClockIcon };

/**
 * "Trạng thái đăng" (owner 2026-11-06): every channel of the item in its group (`channelGroup`),
 * worded by `channelLine`. A channel that could not be scheduled also says how HQ hands it to a
 * room that posts it by hand (`manualLine`, lib/server/content-manual.ts) and keeps "Thử lại" for the owner.
 */
function PostingStatus({ it, now, patch, canRetry }: { it: ContentRow; now: number; patch: Patch; canRetry: boolean }) {
  const posts = new Map((it.channel_posts ?? []).map((p) => [p.channel, p]));
  const rows = channelsOf(it).map((ch) => ({ ch, post: posts.get(ch), group: channelGroup(posts.get(ch)) }));
  const hid = `ps-${it.id}`;
  return (
    <section aria-labelledby={hid} className="space-y-2.5 rounded-lg border p-3">
      <h4 id={hid} className="text-xs font-semibold">
        Trạng thái đăng
      </h4>
      {CHANNEL_GROUPS.map((g) => {
        const of = rows.filter((r) => r.group === g);
        if (of.length === 0) return null;
        const Icon = GROUP_ICON[g];
        return (
          <div key={g} className="space-y-1">
            <p className={cn("flex items-center gap-1 text-[11px] font-medium", GROUP_TONE[g])}>
              <Icon aria-hidden className="size-3.5 shrink-0" />
              {CHANNEL_GROUP_LABEL[g]} · {of.length}
            </p>
            <ul className="divide-y rounded-md border">
              {of.map((r) => (
                <PostingRow key={r.ch} it={it} ch={r.ch} post={r.post} now={now} patch={patch} canRetry={canRetry} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function PostingRow({ it, ch, post, now, patch, canRetry }: { it: ContentRow; ch: Channel; post: ChannelPost | undefined; now: number; patch: Patch; canRetry: boolean }) {
  const [retrying, setRetrying] = useState(false);
  const line = channelLine(it, post);
  // A scheduled row's link is the platform's scheduled-post page; a posted one's is the post.
  const link = line.link ?? httpLink(post?.permalink);
  // Failed rows, and a row HQ claimed for a room posting it by hand (`scheduling` + "Đã giao phòng …").
  const manual = channelGroup(post) === "failed" || post?.state === "scheduling" ? it.manual?.[ch] : undefined;
  async function retry() {
    setRetrying(true);
    try {
      await patch(it.id, { retry_channel: ch });
    } finally {
      setRetrying(false);
    }
  }
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-2.5 py-2 text-xs">
      <span className="w-20 shrink-0 font-medium">{CHANNEL_LABEL[ch]}</span>
      <div className="min-w-0 flex-1 basis-48 space-y-0.5">
        <p className={cn("flex min-w-0 items-center gap-1", LINE_TONE[line.tone])}>
          {line.tone === "busy" && <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />}
          <span className="min-w-0 break-words">{line.text}</span>
        </p>
        {manual && <p className={cn("break-words", manual.kind === "noroom" || manual.kind === "stale" ? "text-foreground" : "text-muted-foreground")}>{manualLine(manual, now)}</p>}
      </div>
      {(link || (line.retry && canRetry)) && (
        <div className="flex shrink-0 items-center gap-2">
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer noopener"
              className={cn("inline-flex items-center gap-0.5 rounded text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60", TOUCH)}
            >
              {post?.state === "published" ? "Mở bài" : "Mở lịch"} <ExternalLinkIcon aria-hidden className="size-3" />
            </a>
          )}
          {line.retry && canRetry && (
            <Button type="button" size="sm" variant="outline" className={cn("h-6 px-2 text-[11px]", TOUCH)} disabled={retrying} onClick={() => void retry()}>
              <RotateCcwIcon aria-hidden /> Thử lại
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * One channel's caption: its own text (`captions_json`) or, until edited, what `captionFor` reads from
 * the shared caption. Saving the shared text back keeps it shared; clearing an own caption returns to it.
 */
function ChannelCaption({ it, ch, post, patch, onEdit, canEdit }: { it: ContentRow; ch: Channel; post: ChannelPost | undefined; patch: Patch; onEdit: () => void; canEdit: boolean }) {
  const own = it.captions_json?.[ch]?.trim() || null;
  const shared = captionFor({ caption: it.caption, captions_json: null }, ch);
  const value = own ?? shared ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const saving = useRef(false);
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
      </div>
      <Textarea
        id={id}
        value={text}
        readOnly={!canEdit}
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
        {own && draft === null && canEdit && (
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
  // name + size, so a re-rendered file remounts with its new URL. A tap on the picture (or the expand
  // button) opens it near full screen: reviewing a post at thumbnail size misses what is in it.
  const [want, setWant] = useState(m.kind === "image");
  const [src] = useState(m.url);
  const [failed, setFailed] = useState(false);
  const [big, setBig] = useState(false);
  return (
    <figure className="overflow-hidden rounded-lg border">
      <div className="relative grid aspect-video place-items-center bg-muted">
        {!want ? (
          <Button type="button" size="sm" variant="outline" className={TOUCH} onClick={() => setWant(true)} aria-label={`Xem video ${m.name}`}>
            <PlayIcon aria-hidden /> Xem · {bytes(m.size)}
          </Button>
        ) : failed ? (
          <span className="px-2 text-center text-[11px] text-muted-foreground">không tải được, mở lại mục này</span>
        ) : m.kind === "video" ? (
          !big && <video src={src} controls autoPlay playsInline preload="metadata" onError={() => setFailed(true)} className="absolute inset-0 size-full object-contain" aria-label={m.name} />
        ) : (
          <button type="button" onClick={() => setBig(true)} className="absolute inset-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Phóng to ${m.name}`}>
            {/* A signed API URL: next/image would proxy it through the optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={m.name} onError={() => setFailed(true)} className="size-full object-contain" />
          </button>
        )}
      </div>
      <figcaption className="flex items-center gap-1 px-1.5 py-1 text-[11px]">
        <span className="min-w-0 flex-1 truncate" title={m.name}>
          {m.name}
        </span>
        <button
          type="button"
          onClick={() => setBig(true)}
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-9"
          aria-label={`Phóng to ${m.name}`}
          title="Phóng to"
        >
          <Maximize2Icon className="size-3.5" aria-hidden />
        </button>
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
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent
          aria-describedby={undefined}
          className="h-dvh w-screen max-w-none gap-0 rounded-none border-0 bg-black/95 p-0 text-white ring-0 sm:h-[94dvh] sm:w-[min(96vw,1400px)] sm:max-w-none sm:rounded-xl [&_[data-slot=dialog-close]]:size-10 [&_[data-slot=dialog-close]]:bg-black/40 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-black/60 [&_[data-slot=dialog-close]]:hover:text-white"
        >
          <DialogTitle className="absolute top-4 left-4 z-10 max-w-[calc(100%-8rem)] truncate text-xs font-medium text-white/85">{m.name}</DialogTitle>
          <div className="absolute inset-0 touch-pinch-zoom overscroll-contain p-3 pt-14 sm:p-6 sm:pt-14">
            {m.kind === "video" ? (
              <video src={src} controls autoPlay playsInline preload="metadata" className="size-full object-contain" aria-label={m.name} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={m.name} draggable={false} className="size-full object-contain" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </figure>
  );
}
