"use client";

// Pieces the "Nội dung" list, calendar and sheet share: format hues, status edges, the PATCH helper,
// the inline editor and the session picker that sends a task and remembers who holds the item.
import { CheckCheckIcon, CheckIcon, Loader2Icon, SendIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { contentTaskText, type ContentFormat, type ContentItem, type ContentStatus } from "@/lib/content";
import { inboxText } from "@/lib/labels";
import { agoShort } from "@/lib/now";
import type { OmpTreeRow } from "@/lib/session-tree";
import { repoOf } from "@/lib/sidebar";
import { cn } from "@/lib/utils";
import { TOUCH } from "./room-send";
import type { Api } from "./use-hq";
import type { Message } from "./types";
import { usePoll } from "./use-poll";

export const ALL = "__all";

/** One hue per format (chip fill + ink); the legend names them, so colour is never the only cue. */
export const FORMAT_TONE: Record<ContentFormat, string> = {
  text: "bg-chart-2/12 text-chart-2",
  infographic: "bg-chart-4/14 text-chart-4",
  course_video: "bg-chart-3/12 text-chart-3",
  ai_video: "bg-chart-5/12 text-chart-5",
  asmr: "bg-fmt-asmr/12 text-fmt-asmr",
  clip: "bg-fmt-clip/12 text-fmt-clip",
  other: "bg-muted text-muted-foreground",
};
/** The swatch in the legend and the year view's dots. */
export const FORMAT_DOT: Record<ContentFormat, string> = {
  text: "bg-chart-2",
  infographic: "bg-chart-4",
  course_video: "bg-chart-3",
  ai_video: "bg-chart-5",
  asmr: "bg-fmt-asmr",
  clip: "bg-fmt-clip",
  other: "bg-muted-foreground",
};

/** The status as the chip's edge (with an icon for the two done states), named in the legend. */
export const STATUS_EDGE: Record<ContentStatus, string> = {
  ordered: "border border-dashed border-current/45",
  drafted: "border border-dotted border-current/60",
  checked: "border border-current/40",
  approved: "border-2 border-current",
  published: "border-2 border-current",
  rejected: "border border-current/30 line-through opacity-60",
};

export function StatusIcon({ status, className }: { status: ContentStatus; className?: string }) {
  if (status === "approved") return <CheckIcon aria-hidden className={cn("size-3 shrink-0", className)} />;
  if (status === "published") return <CheckCheckIcon aria-hidden className={cn("size-3 shrink-0", className)} />;
  return null;
}

export const STATUS_TONE: Record<ContentStatus, string> = {
  ordered: "text-muted-foreground",
  drafted: "text-foreground",
  checked: "text-foreground",
  approved: "text-st-running",
  published: "font-semibold text-st-running",
  rejected: "text-muted-foreground line-through",
};

/** The short handle of a saved assignee ("core · su-code" → "core"). */
export const assigneeShort = (it: Pick<ContentItem, "assignee_base" | "assignee_session">) => (it.assignee_base ?? it.assignee_session ?? "").split(" · ")[0];

export type Patch = (id: number, body: Record<string, unknown>) => Promise<boolean>;

/** PATCH one item, keep its last error (the gate's words) until a later write of it succeeds. */
export function useContentPatch(api: Api, reload: () => void) {
  const [errors, setErrors] = useState<Record<number, string>>({});
  const patch: Patch = useCallback(
    async (id, body) => {
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
  return { patch, errors };
}

/**
 * A value shown as text (a link for URLs); "sửa" edits. One line: Enter or leaving saves. `multiline`:
 * Ctrl+Enter or leaving saves. Esc cancels.
 */
export function Editable({
  value,
  label,
  onSave,
  link = false,
  required = false,
  multiline = false,
  className,
}: {
  value: string | null;
  label: string;
  onSave: (v: string) => Promise<boolean>;
  link?: boolean;
  required?: boolean;
  multiline?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Enter saves, and the blur that follows must not send the same PATCH again.
  const saving = useRef(false);
  const shown = value ?? "";

  async function commit() {
    if (draft === null || saving.current) return;
    const v = draft.trim();
    if (v === shown || (required && !v)) return setDraft(null);
    saving.current = true;
    try {
      if (await onSave(v)) setDraft(null);
    } finally {
      saving.current = false;
    }
  }
  function onKey(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const save = multiline ? e.key === "Enter" && (e.ctrlKey || e.metaKey) : e.key === "Enter";
    if (save && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void commit();
    }
    if (e.key === "Escape") {
      // Inside the sheet, Esc cancels the edit only (not the sheet).
      e.stopPropagation();
      setDraft(null);
    }
  }

  if (draft !== null)
    return multiline ? (
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => void commit()} aria-label={label} className="max-h-96 min-h-28 text-sm" autoFocus />
    ) : (
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => void commit()} aria-label={label} className="h-7 text-xs" autoFocus />
    );
  return (
    <div className={cn("group/ed flex min-w-0 items-baseline gap-1", className)}>
      {link && value && /^https?:\/\//i.test(value) ? (
        <a href={value} target="_blank" rel="noreferrer noopener" className="block max-w-40 min-w-0 truncate text-primary underline-offset-2 hover:underline" title={value}>
          {value.replace(/^https?:\/\//, "")}
        </a>
      ) : (
        <span className={cn("min-w-0 break-words", multiline ? "whitespace-pre-wrap" : "line-clamp-3", !value && "text-muted-foreground")} title={multiline ? undefined : (value ?? undefined)}>
          {value || "chưa có"}
        </span>
      )}
      <button
        type="button"
        className="shrink-0 rounded px-1 text-[11px] text-muted-foreground opacity-70 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:min-h-11"
        aria-label={`Sửa ${label}`}
        onClick={() => setDraft(shown)}
      >
        sửa
      </button>
    </div>
  );
}

const SESSIONS_POLL_MS = 60_000;

/** A session's label as saved on the item and shown on the chip: "<name> · <repo>". */
const sessionLabel = (s: Pick<OmpTreeRow, "name" | "cwd">) => (s.cwd ? `${s.name} · ${repoOf(s.cwd).name}` : s.name);

/**
 * "Giao việc": pick an omp session (GET /api/omp/sessions?all=1), type, send (POST /api/messages, the
 * item's `contentTaskText`), then save the pick on the item (`assignee_session`): the chip and the
 * sheet show who holds it, and the box opens on that session next time.
 */
export function AssignBox({ it, api, now, canSave, onSaved }: { it: ContentItem; api: Api; now: number; canSave: boolean; onSaved: () => void }) {
  const sessions = usePoll<{ sessions: OmpTreeRow[] }>(api, "/api/omp/sessions?all=1", SESSIONS_POLL_MS, true);
  const list = useMemo(() => sessions.data?.sessions ?? [], [sessions.data]);
  const groups = useMemo(() => {
    const by = new Map<string, OmpTreeRow[]>();
    for (const s of list) {
      const g = s.cwd ? repoOf(s.cwd).name : "Không rõ thư mục";
      by.set(g, [...(by.get(g) ?? []), s]);
    }
    return [...by.entries()];
  }, [list]);
  const [picked, setPicked] = useState<string | null>(null);
  const session = picked ?? it.assignee_session ?? "";
  const row = list.find((s) => s.id === session) ?? null;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `assign-${it.id}`;

  async function send() {
    const typed = text.trim();
    if (!session || !typed || busy) return;
    setBusy(true);
    try {
      const r = await api<{ message: Message; delivery: string; live?: boolean; error: string | null }>("/api/messages", {
        method: "POST",
        body: { session, text: contentTaskText(it, typed), ...(row?.cwd ? { base: row.cwd } : {}) },
      });
      const label = row ? sessionLabel(row) : (it.assignee_base ?? session);
      if (r.delivery === "failed") {
        toast.error(`Chưa gửi được tới ${label}: ${r.error ?? "lỗi không rõ"}`);
        return;
      }
      toast.success(`Đã gửi cho ${label}: ${r.delivery === "inbox" ? inboxText(r.live, session) : "đã gõ vào terminal"}`);
      setText("");
      if (canSave) {
        await api(`/api/content?id=${it.id}`, { method: "PATCH", body: { assignee_session: session, assignee_base: label } });
        onSaved();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const savedMissing = it.assignee_session && !list.some((s) => s.id === it.assignee_session);
  return (
    <form
      aria-labelledby={`${id}-h`}
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h3 id={`${id}-h`} className="flex items-center gap-1.5 text-xs font-medium">
        <SendIcon aria-hidden className="size-3.5 text-muted-foreground" />
        Giao việc
        {it.assignee_session && (
          <span className="font-normal text-muted-foreground">
            · đang xử lý: <span className="font-medium text-foreground">{it.assignee_base ?? it.assignee_session}</span>
            {it.assigned_at ? ` · ${agoShort(it.assigned_at, now)}` : ""}
          </span>
        )}
      </h3>
      <Select value={session || undefined} onValueChange={setPicked}>
        <SelectTrigger size="sm" className={cn("w-full text-xs", TOUCH)} aria-label="Phiên nhận việc">
          <SelectValue placeholder={sessions.data ? "Chọn phiên omp" : "Đang tải phiên…"} />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {savedMissing && (
            <SelectGroup>
              <SelectLabel className="text-[11px]">Đã lưu trên mục</SelectLabel>
              <SelectItem value={it.assignee_session!} className="text-xs">
                {it.assignee_base ?? it.assignee_session}
              </SelectItem>
            </SelectGroup>
          )}
          {groups.map(([g, rows]) => (
            <SelectGroup key={g}>
              <SelectLabel className="text-[11px]">{g}</SelectLabel>
              {rows.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  <span className="font-medium">{s.name}</span>
                  {s.title && <span className="max-w-56 truncate text-muted-foreground">{s.title}</span>}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <label htmlFor={id} className="sr-only">
        Việc cho mục #{it.id}
      </label>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={2}
        maxLength={2000}
        placeholder={`Việc cho mục #${it.id}, vd: sửa caption ngắn lại (Ctrl+Enter để gửi)`}
        className="min-h-14 text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Gửi kèm dòng <code className="font-mono">[Nội dung #{it.id} · {it.fb_page}]</code>
          {canSave ? ", lưu phiên vào mục." : "."}
        </p>
        <Button type="submit" size="sm" className={cn("text-xs", TOUCH)} disabled={!session || !text.trim() || busy}>
          {busy ? <Loader2Icon aria-hidden className="animate-spin" /> : <SendIcon aria-hidden />} Gửi
        </Button>
      </div>
    </form>
  );
}
