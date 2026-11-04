"use client";

// The sheet a calendar day (or chip) opens: that day's items in full, with the owner's one-tap
// approve, inline caption / time edits, the AI-label check and "Giao việc". Esc or a click outside
// closes it; the URL keeps `?day=YYYY-MM-DD&item=N` so the owner can share or come back.
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  aiReason,
  contentWarning,
  FORMAT_LABEL,
  fromLocalInput,
  NO_AI_CONFIRM,
  NO_SCHEDULE,
  nextStatuses,
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
import { agoShort } from "@/lib/now";
import { cn } from "@/lib/utils";
import { AssignBox, Editable, FORMAT_TONE, STATUS_EDGE, STATUS_TONE, StatusIcon, type Patch } from "./content-bits";
import { DAY_NAMES } from "./content-calendar";
import { TOUCH } from "./room-send";
import type { Api } from "./use-hq";
import { useAuthedImage } from "./use-poll";

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
                    <ItemDetail it={it} api={api} token={token} now={now} patch={patch} error={errors[it.id]} schedule={schedule} onCollapse={items.length > 1 ? () => onItem(null) : undefined} reload={reload} />
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
  token,
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
  // trigger refusal it could have avoided. Approve and publish both need the AI tick when flagged.
  const steps = nextStatuses(it.status);
  const gated = (s: ContentStatus) => (s === "approved" || s === "published") && ai != null;
  const needsTick = steps.some(gated);
  const blocked = needsTick && !confirmed;

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
              <Button key={s} type="button" size="sm" className={cn("min-w-24", TOUCH)} disabled={busy || blocked} onClick={() => void setStatus(s)}>
                <CheckIcon aria-hidden /> Duyệt
              </Button>
            ) : s === "rejected" ? (
              <Button key={s} type="button" size="sm" variant="outline" className={TOUCH} disabled={busy} onClick={() => void setStatus(s)}>
                <XIcon aria-hidden /> Bỏ
              </Button>
            ) : (
              <Button key={s} type="button" size="sm" variant="outline" className={TOUCH} disabled={busy || (gated(s) && !confirmed)} onClick={() => void setStatus(s)}>
                → {STATUS_LABEL[s]}
              </Button>
            ),
          )}
          {blocked && <span className="text-xs text-muted-foreground">Tick xác nhận ở trên để duyệt.</span>}
        </div>
      )}

      <dl className="space-y-3">
        <Field label="Giờ đăng">
          {schedule ? <TimeEdit at={it.scheduled_at ?? null} fallback={at} onSave={(ms) => patch(it.id, { scheduled_at: ms })} id={it.id} /> : <span className="text-xs text-muted-foreground">{NO_SCHEDULE}</span>}
        </Field>
        <Field label="Caption">
          <Editable value={it.caption} label={`Caption #${it.id}`} onSave={edit("caption")} multiline />
        </Field>
        {it.media_path && (
          <Field label="Media">
            {it.media.length === 0 ? (
              <span className="font-mono text-xs break-all text-muted-foreground">{it.media_path} (không đọc được file ảnh/video)</span>
            ) : (
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]">
                {it.media.map((m) => (
                  <MediaTile key={m.index} item={it.id} m={m} token={token} />
                ))}
              </div>
            )}
          </Field>
        )}
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

function TimeEdit({ id, at, fallback, onSave }: { id: number; at: number | null; fallback: number | null; onSave: (ms: number | null) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (at != null ? toLocalInput(at) : "");
  async function commit() {
    if (draft === null) return;
    const ms = draft ? fromLocalInput(draft) : null;
    if (draft && ms == null) return;
    if (ms === at) return setDraft(null);
    if (await onSave(ms)) setDraft(null);
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
      {at == null && fallback != null && <span className="text-xs text-muted-foreground">chưa đặt lịch; đang xếp theo giờ đã đăng {timeOf(fallback)}</span>}
    </div>
  );
}

function MediaTile({ item, m, token }: { item: number; m: ContentMedia; token: string }) {
  const { src, failed } = useAuthedImage(token, `/api/content/media?id=${item}&i=${m.index}`, true);
  return (
    <figure className={cn("overflow-hidden rounded-lg border", m.ai && "border-destructive/60")}>
      <div className="relative grid aspect-video place-items-center bg-muted">
        {src ? (
          m.kind === "video" ? (
            <video src={src} controls playsInline preload="metadata" className="absolute inset-0 size-full object-contain" aria-label={m.name} />
          ) : (
            // An object URL from an authed fetch: next/image cannot load it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={m.name} className="absolute inset-0 size-full object-contain" />
          )
        ) : failed ? (
          <span className="px-2 text-center text-[11px] text-muted-foreground">không tải được</span>
        ) : (
          <Skeleton className="absolute inset-0 rounded-none" />
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
      </figcaption>
    </figure>
  );
}
