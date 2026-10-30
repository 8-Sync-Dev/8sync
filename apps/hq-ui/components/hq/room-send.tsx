"use client";

import { Loader2Icon, PaperclipIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FILE_MAX_MB, FILES_MAX, fileError, toBase64 } from "@/lib/attach";
import { isImageName } from "@/lib/attachments";
import { inboxText } from "@/lib/labels";
import { roomGroups } from "@/lib/room-send";
import { groupKey } from "@/lib/sidebar";
import type { Message } from "./types";
import { cn } from "@/lib/utils";
import { Lightbox, UploadThumb, type Shown } from "./attachments";
import { MentionTextarea } from "./mention-textarea";
import { ApiError, type Api } from "./use-hq";
import type { Room } from "./use-office";

export type Upload = { id: string; name: string; size: number };

/** Phones: every control in the toolbar is a 44 px touch target; desktop keeps the dense row. */
export const TOUCH = "max-sm:h-11 max-sm:min-w-11";

/** Send only on Ctrl/Cmd+Enter: one stray Enter must not push a half-typed message. */
const isSendKey = (e: KeyboardEvent<HTMLTextAreaElement>) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing;

/**
 * The composer that sends one message to one room the owner picks (POST /api/messages), with files
 * (upload, paste, `@path`). Preview "Hỏi về ảnh này" uses it.
 */
export function RoomSend({
  api,
  token,
  rooms,
  id,
  preferRoot,
  preferRoom,
  placeholder,
  prepare,
  allowEmpty = false,
  reserve = 0,
  onMessage,
  onSent,
  onDraft,
  className,
  children,
}: {
  api: Api;
  /** The HQ token, for the attachment thumbnails (an <img> cannot send the header). */
  token: string;
  rooms: Room[];
  /** DOM id prefix (two composers can be mounted at once). */
  id: string;
  /** The project in scope: its first room is picked when no room is preferred. */
  preferRoot?: string | null;
  /** Room key picked first (Preview: the room that saved the image) until the owner picks. */
  preferRoom?: string | null;
  placeholder: string;
  /** Builds the text actually sent (Preview: image path + pins) and adds uploads made at send time. */
  prepare?: (typed: string) => Promise<{ text: string; files: Upload[] }>;
  /** Send with an empty box (Preview: the pins carry the question). */
  allowEmpty?: boolean;
  /** File slots `prepare` will use (the pinned PNG). */
  reserve?: number;
  /** The stored owner message, for the timeline. */
  onMessage?: (m: Message) => void;
  onSent?: () => void;
  /** Whether the box holds unsent text or files (the phone's floating button shows a dot). */
  onDraft?: (has: boolean) => void;
  className?: string;
  /** Above the box (Preview: the pin list). */
  children?: ReactNode;
}) {
  const groups = useMemo(() => roomGroups(rooms), [rooms]);
  const all = useMemo(() => groups.flatMap((g) => g.rooms), [groups]);
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(0);
  const [shown, setShown] = useState<Shown | null>(null);
  const draft = text.trim().length > 0 || files.length > 0;
  useEffect(() => onDraft?.(draft), [draft, onDraft]);

  const byKey = (k: string | null | undefined) => (k ? (all.find((r) => r.key === k) ?? null) : null);
  // The owner's pick while it still exists; else the preferred room; else the first room of the project in scope.
  const inScope = preferRoot ? groups.find((g) => groupKey(g.root) === groupKey(preferRoot))?.rooms[0] : undefined;
  const room = byKey(picked) ?? byKey(preferRoom) ?? inScope ?? all[0] ?? null;
  const group = room ? groups.find((g) => g.rooms.includes(room)) : undefined;
  const disabled = room == null;
  const slots = FILES_MAX - reserve;

  async function attach(list: File[]) {
    const free = slots - files.length - uploading;
    if (list.length > free) toast.warning(`Tối đa ${slots} file mỗi lần gửi`);
    for (const f of list.slice(0, Math.max(0, free))) {
      const why = fileError(f);
      if (why) {
        toast.error(why);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const up = await api<Upload>("/api/uploads", { method: "POST", body: { name: f.name || "anh-dan.png", data: await toBase64(f) } });
        setFiles((xs) => [...xs, up]);
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length === 0) return;
    e.preventDefault();
    void attach(pasted);
  }

  async function send() {
    const typed = text.trim();
    if (!room || (!typed && !allowEmpty) || busy || uploading > 0) return;
    setBusy(true);
    try {
      const made = prepare ? await prepare(typed) : { text: typed, files: [] };
      const ids = [...files, ...made.files].map((f) => f.id);
      const r = await api<{ message: Message; delivery: string; live?: boolean; error: string | null }>("/api/messages", {
        method: "POST",
        body: { session: room.name, text: made.text, base: room.cwd, files: ids },
      });
      onMessage?.(r.message);
      if (r.delivery === "failed") {
        setLast({ ok: false, text: `${room.label}: chưa gửi được (${r.error ?? "lỗi không rõ"})` });
        toast.error(`Chưa gửi được tới ${room.label}`);
        return;
      }
      setLast({ ok: true, text: `${room.label}: ${r.delivery === "inbox" ? inboxText(r.live) : "đã gõ vào terminal"}` });
      toast.success(`Đã gửi cho ${room.label}`);
      setText("");
      setFiles([]);
      onSent?.();
      area.current?.focus();
    } catch (e) {
      if (e instanceof ApiError && e.message === "session-waiting") toast.error(`${room.label} đang chờ anh trả lời trong terminal: trả lời trước rồi gửi lại`);
      else toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSendKey(e)) {
      e.preventDefault();
      void send();
    }
  }

  const summary = room
    ? `Chỉ ${room.label}${group ? ` (${group.name})` : ""} nhận, ${room.delivery === "inbox" ? inboxText(room.inboxLive) : "gõ thẳng vào terminal của phòng"}.${room.waiting ? " Phòng đang chờ anh trả lời, trả lời trước rồi gửi." : ""}`
    : "Chưa có phòng nào nhận tin được.";
  const titleId = `${id}-title`;

  return (
    <form
      aria-labelledby={titleId}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h2 id={titleId} className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        <SendIcon className="size-3.5 text-muted-foreground" aria-hidden />
        {room ? `Gửi cho phòng ${room.label}` : "Gửi cho một phòng"}
      </h2>
      {children}
      <div className="rounded-xl border bg-card transition-shadow duration-150 focus-within:ring-2 focus-within:ring-ring/40 motion-reduce:transition-none">
        <label htmlFor={id} className="sr-only">
          {room ? `Tin cho ${room.label}` : "Tin cho phòng"}
        </label>
        <MentionTextarea
          id={id}
          ref={area}
          value={text}
          onValueChange={setText}
          base={room?.cwd ?? null}
          api={api}
          onKeyDown={onKey}
          onPaste={onPaste}
          disabled={disabled}
          rows={2}
          maxLength={2000}
          aria-describedby={`${id}-summary`}
          placeholder={placeholder}
          className="max-h-48 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        {(files.length > 0 || uploading > 0) && (
          <ul className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-2" aria-label="File đính kèm">
            {files.map((f) =>
              isImageName(f.name) ? (
                <li key={f.id}>
                  <UploadThumb token={token} file={f} onOpen={setShown} className="size-16">
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-7"
                      aria-label={`Bỏ ${f.name}`}
                      onClick={() => setFiles((xs) => xs.filter((x) => x.id !== f.id))}
                    >
                      <XIcon className="size-3" aria-hidden />
                    </button>
                  </UploadThumb>
                </li>
              ) : (
                <li key={f.id} className="inline-flex max-w-56 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                  <PaperclipIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate" title={f.name}>
                    {f.name}
                  </span>
                  <button
                    type="button"
                    className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-8"
                    aria-label={`Bỏ ${f.name}`}
                    onClick={() => setFiles((xs) => xs.filter((x) => x.id !== f.id))}
                  >
                    <XIcon className="size-3" aria-hidden />
                  </button>
                </li>
              ),
            )}
            {uploading > 0 && <li className="px-1.5 py-0.5 text-xs text-muted-foreground">Đang tải {uploading} file…</li>}
          </ul>
        )}
        <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 pb-2">
          <Select value={room?.key ?? ""} onValueChange={setPicked} disabled={all.length === 0}>
            <SelectTrigger size="sm" className={cn("h-7 max-w-full min-w-0 gap-1.5 border-0 bg-muted/60 text-xs sm:max-w-[55%]", TOUCH, "max-sm:basis-full")} aria-label="Gửi tới">
              <SelectValue placeholder="Chưa có phòng" />
            </SelectTrigger>
            <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
              {groups.map((g, i) => (
                <SelectGroup key={g.root}>
                  {i > 0 && <SelectSeparator />}
                  <SelectLabel>{g.name}</SelectLabel>
                  {g.rooms.map((r) => (
                    <SelectItem key={r.key} value={r.key} className="text-xs">
                      {r.label}
                      <span className="text-muted-foreground">
                        {r.delivery === "inbox" ? " · inbox" : ""}
                        {r.waiting ? " · đang chờ anh" : ""}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void attach([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn("h-7 text-xs", TOUCH)}
            disabled={disabled || files.length + uploading >= slots}
            title={`Ảnh, PDF hay file bất kỳ, tối đa ${slots} file, ${FILE_MAX_MB} MB mỗi file; dán ảnh thẳng vào ô cũng được. Phòng mở bằng Read.`}
            onClick={() => picker.current?.click()}
          >
            <PaperclipIcon /> <span className="max-sm:sr-only">Đính kèm</span>
          </Button>
          <Button type="submit" size="sm" className={cn("ml-auto", TOUCH, "max-sm:px-4")} disabled={disabled || busy || uploading > 0 || (!text.trim() && !allowEmpty)} aria-busy={busy}>
            {busy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden /> : <SendIcon aria-hidden />}
            {busy ? "Đang gửi…" : room ? `Gửi ${room.label}` : "Gửi"}
          </Button>
        </div>
      </div>
      {/* Phones: two lines; screen readers still get it whole (aria-describedby). */}
      <p id={`${id}-summary`} className="mt-1.5 text-xs text-muted-foreground max-sm:line-clamp-2">
        {summary}
      </p>
      {/* Mounted before the first send so screen readers announce the result when it arrives. */}
      <p role="status" className={cn("mt-1 text-xs empty:hidden", last?.ok === false ? "text-destructive" : "text-foreground")}>
        {last?.text}
      </p>
    </form>
  );
}
