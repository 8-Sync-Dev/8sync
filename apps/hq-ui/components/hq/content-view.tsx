"use client";

import { AlertTriangleIcon, CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, FileTextIcon, ListIcon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  aiReason,
  byDay,
  CONTENT_FORMATS,
  CONTENT_STATUSES,
  contentWarning,
  dayKey,
  FORMAT_LABEL,
  nextStatuses,
  stepHint,
  parseDay,
  NO_SCHEDULE,
  STATUS_LABEL,
  stepCursor,
  whenOf,
  type CalendarMode,
  type ContentFormat,
  type ContentItem,
  type ContentList,
  type ContentRow,
  type ContentTextField,
} from "@/lib/content";
import { atLeast } from "@/lib/access";
import { agoShort } from "@/lib/now";
import { cn } from "@/lib/utils";
import { useAccess } from "./access";
import { ErrorNote } from "./bits";
import { ALL, assigneeShort, Editable, FORMAT_DOT, FORMAT_TONE, STATUS_EDGE, STATUS_TONE, StatusIcon, useContentPatch, type Patch } from "./content-bits";
import { ContentCalendar, periodLabel } from "./content-calendar";
import { ContentSheet, NO_DAY } from "./content-sheet";
import { TOUCH } from "./room-send";
import { makeApi, type Api } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 15_000;
const VIEW_KEY = "hq.content.view";
const MODE_KEY = "hq.content.mode";
const MODES: [CalendarMode, string][] = [
  ["day", "Ngày"],
  ["week", "Tuần"],
  ["month", "Tháng"],
  ["year", "Năm"],
];
type View = "calendar" | "list";
type Sel = { day: string | null; item: number | null };

const stored = <T extends string>(key: string, ok: readonly T[], dflt: T): T => {
  if (typeof window === "undefined") return dflt;
  const v = window.localStorage.getItem(key);
  return ok.includes(v as T) ? (v as T) : dflt;
};

/** `?day=YYYY-MM-DD|none&item=N`: the open sheet, shareable and restored on load. */
function readSel(): Sel {
  if (typeof window === "undefined") return { day: null, item: null };
  const q = new URLSearchParams(window.location.search);
  const day = q.get("day");
  const item = Number(q.get("item"));
  return { day: day === NO_DAY || parseDay(day) ? day : null, item: Number.isSafeInteger(item) && item > 0 ? item : null };
}
function writeSel({ day, item }: Sel) {
  const u = new URL(window.location.href);
  if (day) u.searchParams.set("day", day);
  else u.searchParams.delete("day");
  if (item != null) u.searchParams.set("item", String(item));
  else u.searchParams.delete("item");
  if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u);
}

/** "Nội dung" tab: content-post-agency's `content_items` (FB ↔ news) as a calendar or a list, read and written in place; the DB's triggers gate approve/publish. */
export function ContentView({ token, active }: { token: string; active: boolean }) {
  const api = useMemo(() => makeApi(token), [token]);
  const owner = useAccess() === "owner";
  const [status, setStatus] = useState(ALL);
  const [format, setFormat] = useState(ALL);
  const [page, setPage] = useState(ALL);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (status !== ALL) q.set("status", status);
    if (format !== ALL) q.set("format", format);
    if (page !== ALL) q.set("fb_page", page);
    const s = q.toString();
    return `/api/content${s ? `?${s}` : ""}`;
  }, [status, format, page]);
  const list = usePoll<ContentList>(api, query, POLL_MS, active);
  const [adding, setAdding] = useState(false);
  const data = list.data;
  const ready = data && data.configured && data.ready ? data : null;
  const pages = ready?.pages ?? [];
  const { patch, errors } = useContentPatch(api, list.reload);

  const [view, setViewState] = useState<View>(() => stored(VIEW_KEY, ["calendar", "list"], "calendar"));
  const [mode, setModeState] = useState<CalendarMode>(() => stored(MODE_KEY, ["day", "week", "month", "year"], "month"));
  const [sel, setSel] = useState<Sel>(readSel);
  const [cursor, setCursor] = useState<Date>(() => parseDay(sel.day) ?? new Date());
  const setView = (v: View) => (setViewState(v), window.localStorage.setItem(VIEW_KEY, v));
  const setMode = (m: CalendarMode) => (setModeState(m), window.localStorage.setItem(MODE_KEY, m));

  useEffect(() => () => writeSel({ day: null, item: null }), []);

  const items = useMemo(() => ready?.items ?? [], [ready]);
  const days = useMemo(() => byDay(items), [items]);
  const unscheduled = useMemo(() => items.filter((it) => whenOf(it) == null), [items]);
  const openItem = useCallback((it: ContentRow) => {
    const at = whenOf(it);
    setSel({ day: at != null ? dayKey(at) : NO_DAY, item: it.id });
  }, []);
  const open = useMemo(() => ({ day: (day: string) => setSel({ day, item: null }), item: openItem }), [openItem]);
  // The selected item decides the day: an `item=`-only link opens on its day, and a time edit moves
  // the sheet along with the item instead of leaving it on a day it has left.
  const picked = sel.item != null ? items.find((it) => it.id === sel.item) : undefined;
  const pickedDay = picked ? (whenOf(picked) != null ? dayKey(whenOf(picked)!) : NO_DAY) : null;
  const sheetDay = pickedDay ?? sel.day;
  useEffect(() => writeSel(active ? { day: sheetDay, item: sel.item } : { day: null, item: null }), [sheetDay, sel.item, active]);
  const sheetItems = sheetDay === NO_DAY ? unscheduled : sheetDay ? (days.get(sheetDay) ?? []) : [];
  const today = dayKey(list.at || 0);

  return (
    <div className="h-full overflow-y-auto">
      <section aria-labelledby="content-h" className="space-y-3 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="content-h" className="flex items-center gap-1.5 text-sm font-semibold">
            <FileTextIcon aria-hidden className="size-3.5 text-muted-foreground" />
            Nội dung
            <span className="text-xs font-normal text-muted-foreground max-sm:hidden">sổ content_items của content-ai: bài FB ↔ tin news</span>
          </h2>
          {ready && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Filter label="Trạng thái" value={status} onChange={setStatus} options={CONTENT_STATUSES.map((s) => [s, STATUS_LABEL[s]])} />
              <Filter label="Định dạng" value={format} onChange={setFormat} options={CONTENT_FORMATS.map((f) => [f, FORMAT_LABEL[f]])} />
              {(pages.length > 1 || page !== ALL) && <Filter label="Trang FB" value={page} onChange={setPage} options={pages.map((p) => [p, p])} />}
              {owner && (
                <Button type="button" size="sm" variant={adding ? "secondary" : "default"} className={cn("text-xs", TOUCH)} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
                  <PlusIcon aria-hidden /> Mục mới
                </Button>
              )}
            </div>
          )}
        </div>
        {list.error && !data ? (
          <ErrorNote what="sổ nội dung" error={list.error} onRetry={list.reload} />
        ) : !data ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : !data.configured ? (
          <p className="text-xs text-muted-foreground">
            Chưa cấu hình DB nội dung. Đặt <code className="font-mono">EIGHTSYNC_CONTENT_DB</code> hoặc <code className="font-mono">~/.config/8sync/hq/content.json</code> = <code className="font-mono">{'{"db": "<đường dẫn daily-dev.db>"}'}</code>.
          </p>
        ) : !data.ready ? (
          <p role="status" className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <AlertTriangleIcon aria-hidden className="size-4 shrink-0 text-st-needs" />
            {data.error}
          </p>
        ) : (
          <>
            {owner && adding && <NewItem api={api} pages={pages} onDone={() => (setAdding(false), list.reload())} />}
            <div className="flex flex-wrap items-center gap-2">
              <ButtonGroup aria-label="Kiểu xem">
                <Button type="button" size="sm" variant={view === "calendar" ? "secondary" : "outline"} aria-pressed={view === "calendar"} className={cn("text-xs", TOUCH)} onClick={() => setView("calendar")}>
                  <CalendarIcon aria-hidden /> Lịch
                </Button>
                <Button type="button" size="sm" variant={view === "list" ? "secondary" : "outline"} aria-pressed={view === "list"} className={cn("text-xs", TOUCH)} onClick={() => setView("list")}>
                  <ListIcon aria-hidden /> Danh sách
                </Button>
              </ButtonGroup>
              {view === "calendar" && (
                <>
                  <ButtonGroup aria-label="Khoảng lịch">
                    {MODES.map(([m, label]) => (
                      <Button key={m} type="button" size="sm" variant={mode === m ? "secondary" : "outline"} aria-pressed={mode === m} className={cn("text-xs", TOUCH)} onClick={() => setMode(m)}>
                        {label}
                      </Button>
                    ))}
                  </ButtonGroup>
                  <Button type="button" size="sm" variant="outline" className={cn("text-xs", TOUCH)} onClick={() => setCursor(new Date())}>
                    Hôm nay
                  </Button>
                  <ButtonGroup>
                    <Button type="button" size="icon-sm" variant="outline" className={TOUCH} aria-label="Kỳ trước" onClick={() => setCursor((c) => stepCursor(c, mode, -1))}>
                      <ChevronLeftIcon aria-hidden />
                    </Button>
                    <Button type="button" size="icon-sm" variant="outline" className={TOUCH} aria-label="Kỳ sau" onClick={() => setCursor((c) => stepCursor(c, mode, 1))}>
                      <ChevronRightIcon aria-hidden />
                    </Button>
                  </ButtonGroup>
                  <h3 className="text-sm font-semibold tabular-nums" aria-live="polite">
                    {periodLabel(mode, cursor)}
                  </h3>
                  {unscheduled.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" className={cn("ml-auto text-xs", TOUCH)} onClick={() => open.day(NO_DAY)}>
                      Chưa có lịch ({unscheduled.length})
                    </Button>
                  )}
                </>
              )}
            </div>
            {!data.schedule && (
              <p role="status" className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
                <AlertTriangleIcon aria-hidden className="size-4 shrink-0 text-st-needs" />
                Lịch đang xếp theo giờ đã đăng. {NO_SCHEDULE}
              </p>
            )}
            {view === "calendar" ? (
              <>
                <ContentCalendar
                  mode={mode}
                  cursor={cursor}
                  days={days}
                  today={today}
                  open={open}
                  onMonth={(d) => {
                    setCursor(d);
                    setMode("month");
                  }}
                />
                <Legend />
              </>
            ) : (
              <Items items={items} api={api} now={list.at} patch={patch} errors={errors} onOpen={openItem} reload={list.reload} />
            )}
            <ContentSheet
              day={sheetDay}
              item={sel.item}
              items={sheetItems}
              schedule={data.schedule}
              api={api}
              now={list.at}
              patch={patch}
              errors={errors}
              onClose={() => setSel({ day: null, item: null })}
              onItem={(item) => setSel({ day: sheetDay, item })}
              reload={list.reload}
            />
          </>
        )}
      </section>
    </div>
  );
}

/** What the chip colours and edges mean: format by hue, status by edge (plus a tick when approved/published). */
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {CONTENT_FORMATS.map((f) => (
          <span key={f} className="inline-flex items-center gap-1">
            <span aria-hidden className={cn("size-2 rounded-full", FORMAT_DOT[f])} />
            {FORMAT_LABEL[f]}
          </span>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {CONTENT_STATUSES.map((s) => (
          <span key={s} className={cn("inline-flex items-center gap-0.5 rounded px-1.5 text-foreground", STATUS_EDGE[s])}>
            <StatusIcon status={s} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </span>
    </div>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL} className="text-xs">
          {label}: tất cả
        </SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v} className="text-xs">
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NewItem({ api, pages, onDone }: { api: Api; pages: string[]; onDone: () => void }) {
  const [format, setFormat] = useState<ContentFormat>("text");
  const [title, setTitle] = useState("");
  const [fbPage, setFbPage] = useState(pages[0] ?? "8syncdev");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ item: ContentItem }>("/api/content", { method: "POST", body: { format, title, fb_page: fbPage, source_url: source } });
      toast.success(`Đã tạo #${r.item.id}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <label className="grid gap-1 text-xs">
        Định dạng
        <Select value={format} onValueChange={(v) => setFormat(v as ContentFormat)}>
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTENT_FORMATS.map((f) => (
              <SelectItem key={f} value={f} className="text-xs">
                {FORMAT_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="grid gap-1 text-xs">
        Tiêu đề
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      </label>
      <label className="grid gap-1 text-xs">
        Trang FB
        <Input value={fbPage} onChange={(e) => setFbPage(e.target.value)} list="content-pages" required />
        <datalist id="content-pages">
          {pages.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label className="grid gap-1 text-xs">
        Nguồn (URL)
        <Input value={source} onChange={(e) => setSource(e.target.value)} inputMode="url" placeholder="https://…" />
      </label>
      <Button type="submit" size="sm" className={cn("text-xs", TOUCH)} disabled={busy || !title.trim()}>
        Tạo
      </Button>
    </form>
  );
}

/** "Danh sách": the table view; "Mở" opens the item in the sheet (approve, media, giao việc). */
function Items({
  items,
  api,
  now,
  patch,
  errors,
  onOpen,
  reload,
}: {
  items: ContentRow[];
  api: Api;
  now: number;
  patch: Patch;
  errors: Record<number, string>;
  onOpen: (it: ContentRow) => void;
  reload: () => void;
}) {
  const role = useAccess();
  const canEdit = atLeast(role, "editor");
  const remove = useCallback(
    async (it: ContentItem) => {
      if (!window.confirm(`Xoá mục #${it.id} «${it.title}»?`)) return;
      try {
        await api(`/api/content?id=${it.id}`, { method: "DELETE" });
        reload();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [api, reload],
  );

  if (items.length === 0) return <p className="text-xs text-muted-foreground">Chưa có mục nào khớp bộ lọc.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[60rem] text-left text-xs">
        <thead className="border-b bg-muted/40 text-[11px] text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Mục · định dạng</th>
            <th className="px-2 py-1.5 font-medium">Trạng thái</th>
            <th className="px-2 py-1.5 font-medium">Cảnh báo</th>
            <th className="px-2 py-1.5 font-medium">Trang FB</th>
            <th className="px-2 py-1.5 font-medium">Nguồn</th>
            <th className="px-2 py-1.5 font-medium">Check</th>
            <th className="px-2 py-1.5 font-medium">Tin news · bài FB</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((it) => {
            const warn = contentWarning(it);
            const ai = aiReason(it);
            // Approving or publishing an AI-marked item needs the sheet's confirmation tick.
            const steps = nextStatuses(it.status).filter((s) => !(ai && (s === "approved" || s === "published")));
            const note = steps.map((s) => stepHint(it, s)).find((h) => h != null);
            const err = errors[it.id];
            const who = assigneeShort(it);
            const edit = (field: ContentTextField) => (v: string) => patch(it.id, { [field]: v });
            return (
              <tr key={it.id} className={cn("align-top", (warn || ai) && "bg-destructive/5")}>
                <td className="px-2 py-2 font-mono text-muted-foreground tabular">{it.id}</td>
                <td className="w-64 min-w-56 px-2 py-2">
                  <div className="font-medium">
                    <Editable value={it.title} label={`Tiêu đề #${it.id}`} onSave={edit("title")} required />
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    {canEdit ? (
                      <Select value={it.format} onValueChange={(v) => void patch(it.id, { format: v })}>
                        <SelectTrigger size="sm" className={cn("h-7 text-xs", FORMAT_TONE[it.format])} aria-label={`Định dạng #${it.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTENT_FORMATS.map((f) => (
                            <SelectItem key={f} value={f} className="text-xs">
                              {FORMAT_LABEL[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className={cn("rounded px-1.5 py-0.5 text-xs", FORMAT_TONE[it.format])}>{FORMAT_LABEL[it.format]}</span>
                    )}
                    <Button type="button" size="sm" variant="outline" className={cn("h-7 px-2 text-[11px]", TOUCH)} onClick={() => onOpen(it)}>
                      <SendIcon aria-hidden /> Mở
                    </Button>
                    {role === "owner" && (
                      <Button type="button" size="icon" variant="ghost" className={cn("size-7", TOUCH)} aria-label={`Xoá #${it.id}`} onClick={() => void remove(it)}>
                        <Trash2Icon aria-hidden />
                      </Button>
                    )}
                  </div>
                  {who && <p className="mt-1 text-[11px] text-muted-foreground">đang xử lý: {it.assignee_base ?? who}</p>}
                </td>
                <td className="px-2 py-2">
                  <p className={cn("whitespace-nowrap", STATUS_TONE[it.status])}>{STATUS_LABEL[it.status]}</p>
                  <div className="mt-1 flex flex-col items-start gap-1">
                    {canEdit &&
                      steps
                      .map((s) => {
                        const hint = stepHint(it, s);
                        return (
                          <Button
                            key={s}
                            type="button"
                            size="sm"
                            variant={s === "rejected" ? "ghost" : "outline"}
                            className={cn("h-6 px-2 text-[11px] whitespace-nowrap", TOUCH)}
                            disabled={hint != null}
                            title={hint ?? undefined}
                            onClick={() => void patch(it.id, { status: s })}
                          >
                            {s === "rejected" ? "Bỏ" : `→ ${STATUS_LABEL[s]}`}
                          </Button>
                        );
                      })}
                    {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
                  </div>
                </td>
                <td className="w-44 min-w-36 px-2 py-2">
                  {ai && (
                    <p className="flex items-start gap-1 font-medium text-destructive">
                      <AlertTriangleIcon aria-hidden className="mt-px size-3.5 shrink-0" /> Rủi ro nhãn AI: {ai}. Duyệt trong khung chi tiết.
                    </p>
                  )}
                  {warn && (
                    <p className="flex items-start gap-1 font-medium text-destructive">
                      <AlertTriangleIcon aria-hidden className="mt-px size-3.5 shrink-0" /> {warn}
                    </p>
                  )}
                  {err && (
                    <p role="alert" className="mt-0.5 font-mono text-[11px] break-words text-destructive">
                      {err}
                    </p>
                  )}
                </td>
                <td className="px-2 py-2">
                  <Editable value={it.fb_page} label={`Trang FB #${it.id}`} onSave={edit("fb_page")} required />
                </td>
                <td className="px-2 py-2">
                  <Editable value={it.source_url} label={`Nguồn #${it.id}`} onSave={edit("source_url")} link />
                  {it.source_approved_at != null ? (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-st-running">
                      <CheckIcon aria-hidden className="size-3" /> {it.source_approved_by} · {agoShort(it.source_approved_at, now)}
                    </p>
                  ) : it.source_url && canEdit ? (
                    <Button type="button" size="sm" variant="outline" className={cn("mt-1 h-6 px-2 text-[11px]", TOUCH)} onClick={() => void patch(it.id, { approve_source: it.source_url })}>
                      Duyệt nguồn
                    </Button>
                  ) : null}
                </td>
                <td className="w-48 min-w-40 px-2 py-2">
                  <Editable value={it.check_note} label={`Check #${it.id}`} onSave={edit("check_note")} />
                  {it.checked_at != null && <p className="mt-0.5 text-[11px] text-muted-foreground">đã check · {agoShort(it.checked_at, now)}</p>}
                </td>
                <td className="min-w-48 px-2 py-2">
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-1">
                    <dt className="text-muted-foreground">News</dt>
                    <dd>
                      <Editable value={it.news_url} label={`Tin news #${it.id}`} onSave={edit("news_url")} link />
                    </dd>
                    <dt className="text-muted-foreground">FB</dt>
                    <dd>
                      <Editable value={it.fb_post_url} label={`Bài FB #${it.id}`} onSave={edit("fb_post_url")} link />
                    </dd>
                  </dl>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
