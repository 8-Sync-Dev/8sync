"use client";

import { AlertTriangleIcon, CheckIcon, FileTextIcon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CONTENT_FORMATS,
  CONTENT_STATUSES,
  FORMAT_LABEL,
  STATUS_LABEL,
  contentTaskText,
  contentWarning,
  nextStatuses,
  type ContentFormat,
  type ContentItem,
  type ContentList,
  type ContentStatus,
  type ContentTextField,
} from "@/lib/content";
import { agoShort } from "@/lib/now";
import { cn } from "@/lib/utils";
import { ErrorNote } from "./bits";
import { RoomSend, TOUCH } from "./room-send";
import { makeApi, type Api } from "./use-hq";
import type { Room } from "./use-office";
import { usePoll } from "./use-poll";

const POLL_MS = 15_000;
const ALL = "__all";

const STATUS_TONE: Record<ContentStatus, string> = {
  ordered: "text-muted-foreground",
  drafted: "text-foreground",
  checked: "text-foreground",
  approved: "text-st-running",
  published: "font-semibold text-st-running",
  rejected: "text-muted-foreground line-through",
};

/** "Nội dung" tab: content-post-agency's `content_items` (FB ↔ news), read and written in place; the DB's triggers gate approve/publish. */
export function ContentView({ token, rooms, active }: { token: string; rooms: Room[]; active: boolean }) {
  const api = useMemo(() => makeApi(token), [token]);
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
              {pages.length > 1 && <Filter label="Trang FB" value={page} onChange={setPage} options={pages.map((p) => [p, p])} />}
              <Button type="button" size="sm" variant={adding ? "secondary" : "default"} className={cn("text-xs", TOUCH)} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
                <PlusIcon aria-hidden /> Mục mới
              </Button>
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
            {adding && <NewItem api={api} pages={pages} onDone={() => (setAdding(false), list.reload())} />}
            <Items items={data.items} api={api} token={token} rooms={rooms} now={list.at} reload={list.reload} />
          </>
        )}
      </section>
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

function Items({ items, api, token, rooms, now, reload }: { items: ContentItem[]; api: Api; token: string; rooms: Room[]; now: number; reload: () => void }) {
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [sendFor, setSendFor] = useState<number | null>(null);
  const patch = useCallback(
    async (id: number, body: Record<string, unknown>) => {
      try {
        await api(`/api/content?id=${id}`, { method: "PATCH", body });
        setErrors((x) => {
          const rest = { ...x };
          delete rest[id];
          return rest;
        });
        reload();
        return true;
      } catch (e) {
        const msg = (e as Error).message;
        setErrors((x) => ({ ...x, [id]: msg }));
        toast.error(`#${id}: ${msg}`);
        return false;
      }
    },
    [api, reload],
  );
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
            const err = errors[it.id];
            const edit = (field: ContentTextField) => (v: string) => patch(it.id, { [field]: v });
            return [
              <tr key={it.id} className={cn("align-top", warn && "bg-destructive/5")}>
                <td className="px-2 py-2 font-mono text-muted-foreground tabular">{it.id}</td>
                <td className="w-64 min-w-56 px-2 py-2">
                  <div className="font-medium">
                    <Editable value={it.title} label={`Tiêu đề #${it.id}`} onSave={edit("title")} required />
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <Select value={it.format} onValueChange={(v) => void patch(it.id, { format: v })}>
                      <SelectTrigger size="sm" className="h-7 text-xs" aria-label={`Định dạng #${it.id}`}>
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
                    <Button
                      type="button"
                      size="sm"
                      variant={sendFor === it.id ? "secondary" : "outline"}
                      className={cn("h-7 px-2 text-[11px]", TOUCH)}
                      aria-expanded={sendFor === it.id}
                      onClick={() => setSendFor((x) => (x === it.id ? null : it.id))}
                    >
                      <SendIcon aria-hidden /> Gửi task
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className={cn("size-7", TOUCH)} aria-label={`Xoá #${it.id}`} onClick={() => void remove(it)}>
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <p className={cn("whitespace-nowrap", STATUS_TONE[it.status])}>{STATUS_LABEL[it.status]}</p>
                  <div className="mt-1 flex flex-col items-start gap-1">
                    {nextStatuses(it.status).map((s) => (
                      <Button
                        key={s}
                        type="button"
                        size="sm"
                        variant={s === "rejected" ? "ghost" : "outline"}
                        className={cn("h-6 px-2 text-[11px] whitespace-nowrap", TOUCH)}
                        onClick={() => void patch(it.id, { status: s })}
                      >
                        {s === "rejected" ? "Bỏ" : `→ ${STATUS_LABEL[s]}`}
                      </Button>
                    ))}
                  </div>
                </td>
                <td className="w-44 min-w-36 px-2 py-2">
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
                  ) : it.source_url ? (
                    <Button type="button" size="sm" variant="outline" className={cn("mt-1 h-6 px-2 text-[11px]", TOUCH)} onClick={() => void patch(it.id, { approve_source: true })}>
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
              </tr>,
              sendFor === it.id && (
                <tr key={`${it.id}-send`}>
                  <td colSpan={8} className="bg-muted/20 px-3 py-2.5">
                    <TaskBox it={it} api={api} token={token} rooms={rooms} onSent={() => setSendFor(null)} />
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaskBox({ it, api, token, rooms, onSent }: { it: ContentItem; api: Api; token: string; rooms: Room[]; onSent: () => void }) {
  const prepare = useCallback(async (typed: string) => ({ text: contentTaskText(it, typed), files: [] }), [it]);
  return (
    <RoomSend api={api} token={token} rooms={rooms} id={`content-${it.id}`} placeholder={`Việc cho mục #${it.id}, vd: sửa caption ngắn lại (Ctrl+Enter để gửi)`} prepare={prepare} onSent={onSent}>
      <p className="mb-1.5 text-xs text-muted-foreground">
        Gửi đi: <code className="font-mono">[Nội dung #{it.id} · {it.fb_page}] {it.title}</code> + dòng anh gõ. Chọn phòng rồi bấm gửi.
      </p>
    </RoomSend>
  );
}

/** A value shown as text (a link for URLs); click or Enter edits, Enter or leaving saves, Esc cancels. */
function Editable({ value, label, onSave, link = false, required = false }: { value: string | null; label: string; onSave: (v: string) => Promise<boolean>; link?: boolean; required?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value ?? "";

  async function commit() {
    if (draft === null) return;
    const v = draft.trim();
    if (v === shown || (required && !v)) return setDraft(null);
    if (await onSave(v)) setDraft(null);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) void commit();
    if (e.key === "Escape") setDraft(null);
  }

  if (draft !== null)
    return <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => void commit()} aria-label={label} className="h-7 text-xs" autoFocus />;
  return (
    <div className="group/ed flex min-w-0 items-baseline gap-1">
      {link && value ? (
        <a href={value} target="_blank" rel="noreferrer noopener" className="block max-w-40 min-w-0 truncate text-primary underline-offset-2 hover:underline" title={value}>
          {value.replace(/^https?:\/\//, "")}
        </a>
      ) : (
        <span className={cn("line-clamp-3 min-w-0 break-words", !value && "text-muted-foreground")} title={value ?? undefined}>
          {value || "—"}
        </span>
      )}
      <button
        type="button"
        className="shrink-0 rounded px-1 text-[11px] text-muted-foreground opacity-60 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:min-h-11"
        aria-label={`Sửa ${label}`}
        onClick={() => setDraft(shown)}
      >
        sửa
      </button>
    </div>
  );
}
