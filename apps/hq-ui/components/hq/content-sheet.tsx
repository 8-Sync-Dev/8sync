"use client";

// The sheet a calendar day (or chip) opens: that day's items in full, with the owner's one-tap
// approve, inline caption / time edits and "Giao việc". Esc or a click outside
// closes it; the URL keeps `?day=YYYY-MM-DD&item=N` so the owner can share or come back.
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, DownloadIcon, Maximize2Icon, PlayIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  contentWarning,
  FORMAT_LABEL,
  fromLocalInput,
  NO_SCHEDULE,
  nextStatuses,
  stepHint,
  parseDay,
  STATUS_LABEL,
  timeOf,
  toLocalInput,
  whenOf,
  type ContentMedia,
  type ContentStatus,
  type ContentRow,
  type ContentTextField,
} from "@/lib/content";
import { atLeast } from "@/lib/access";
import { bytes } from "@/lib/disk";
import { agoShort } from "@/lib/now";
import { cn } from "@/lib/utils";
import { useAccess } from "./access";
import { AssignBox, Editable, FORMAT_TONE, STATUS_EDGE, STATUS_TONE, StatusIcon, type Patch } from "./content-bits";
import { CopyButton } from "./copy-button";
import { DAY_NAMES } from "./content-calendar";
import { ItemResults, NO_RESULTS, ResultMark, type ResultIndex } from "./content-results";
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
  token,
  results = NO_RESULTS,
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
  token: string;
  /** What the rooms reported back (owner only; empty for a guest). */
  results?: ResultIndex;
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
                    <ItemDetail it={it} api={api} token={token} results={results} now={now} patch={patch} error={errors[it.id]} schedule={schedule} onCollapse={items.length > 1 ? () => onItem(null) : undefined} reload={reload} />
                  ) : (
                    <button type="button" onClick={() => onItem(it.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:bg-accent/50">
                      <ItemLine it={it} results={results} />
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
function ItemLine({ it, results = NO_RESULTS }: { it: ContentRow; results?: ResultIndex }) {
  const at = whenOf(it);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{at != null ? timeOf(at) : "--:--"}</span>
      <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", FORMAT_TONE[it.format], STATUS_EDGE[it.status])}>
        <StatusIcon status={it.status} />
        {FORMAT_LABEL[it.format]}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.title}</span>
      {/* Which items already have a file to watch or download, without opening each one. */}
      {it.media.length > 0 && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" title={`${it.media.length} file ảnh/video`}>
          <DownloadIcon className="size-3" aria-hidden />
          {it.media.length}
        </span>
      )}
      <ResultMark arts={results.arts.get(it.id)} metrics={results.metrics.get(it.id)} />
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
  token,
  results,
  now,
  patch,
  error,
  schedule,
  onCollapse,
  reload,
}: {
  it: ContentRow;
  api: Api;
  token: string;
  results: ResultIndex;
  now: number;
  patch: Patch;
  error: string | undefined;
  schedule: boolean;
  onCollapse?: () => void;
  reload: () => void;
}) {
  const role = useAccess();
  const canEdit = atLeast(role, "editor");
  const warn = contentWarning(it);
  const [busy, setBusy] = useState(false);
  const edit = (field: ContentTextField) => (v: string) => patch(it.id, { [field]: v });
  const at = whenOf(it);
  // The flow's next steps, same as the list: "Duyệt" only once checked, so the 1-tap never meets a
  // trigger refusal it could have avoided; a step the trigger would refuse says why instead.
  const steps = nextStatuses(it.status);
  const hints = [...new Set(steps.map((s) => stepHint(it, s)).filter((h): h is string => h != null))];

  async function setStatus(status: ContentStatus) {
    setBusy(true);
    try {
      await patch(it.id, { status });
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
              <ItemLine it={it} results={results} />
            </button>
          ) : (
            <ItemLine it={it} results={results} />
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
              <Button key={s} type="button" size="sm" className={cn("min-w-24", TOUCH)} disabled={busy || stepHint(it, s) != null} onClick={() => void setStatus(s)}>
                <CheckIcon aria-hidden /> Duyệt
              </Button>
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
        </div>
      )}

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
            <ItemResults id={it.id} token={token} arts={results.arts.get(it.id)} metrics={results.metrics.get(it.id)} now={now} />
          </Field>
        )}
        <Field label="Caption">
          <Editable value={it.caption} label={`Caption #${it.id}`} onSave={edit("caption")} multiline />
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

      {role === "owner" && (
        <div className="rounded-lg border p-3">
          <AssignBox it={it} api={api} now={now} canSave={schedule} onSaved={reload} />
        </div>
      )}
    </article>
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
