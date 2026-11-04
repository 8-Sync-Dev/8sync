"use client";

import { Loader2Icon, SendIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FILES_MAX } from "@/lib/attach";
import { inboxText } from "@/lib/labels";
import { roomGroups } from "@/lib/room-send";
import { groupKey } from "@/lib/sidebar";
import type { Message } from "./types";
import { cn } from "@/lib/utils";
import { AttachButton, AttachList, useAttach, type Upload } from "./attach";
import { MentionTextarea } from "./mention-textarea";
import { ApiError, type Api } from "./use-hq";
import type { Room } from "./use-office";

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
  /** Builds the text actually sent for the picked room (Preview: image path + pins) and adds uploads made at send time. */
  prepare?: (typed: string, room: Room) => Promise<{ text: string; files: Upload[] }>;
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
  const slots = FILES_MAX - reserve;
  const att = useAttach(api, slots);
  const { files, uploading } = att;
  const draft = text.trim().length > 0 || files.length > 0;
  useEffect(() => onDraft?.(draft), [draft, onDraft]);

  const byKey = (k: string | null | undefined) => (k ? (all.find((r) => r.key === k) ?? null) : null);
  // The owner's pick while it still exists; else the preferred room; else the first room of the project in scope.
  const inScope = preferRoot ? groups.find((g) => groupKey(g.root) === groupKey(preferRoot))?.rooms[0] : undefined;
  const room = byKey(picked) ?? byKey(preferRoom) ?? inScope ?? all[0] ?? null;
  const group = room ? groups.find((g) => g.rooms.includes(room)) : undefined;
  const disabled = room == null;

  async function send() {
    const typed = text.trim();
    if (!room || (!typed && !allowEmpty) || busy || uploading > 0) return;
    setBusy(true);
    try {
      const made = prepare ? await prepare(typed, room) : { text: typed, files: [] };
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
      setLast({ ok: true, text: `${room.label}: ${r.delivery === "inbox" ? inboxText(r.live, room.session_id ?? room.name) : "đã gõ vào terminal"}` });
      toast.success(`Đã gửi cho ${room.label}`);
      setText("");
      att.clear();
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
    ? `Chỉ ${room.label}${group ? ` (${group.name})` : ""} nhận, ${room.delivery === "inbox" ? inboxText(room.inboxLive, room.session_id ?? room.name) : "gõ thẳng vào terminal của phòng"}.${room.waiting ? " Phòng đang chờ anh trả lời, trả lời trước rồi gửi." : ""}`
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
          onPaste={att.onPaste}
          disabled={disabled}
          rows={2}
          maxLength={2000}
          aria-describedby={`${id}-summary`}
          placeholder={placeholder}
          className="max-h-48 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <AttachList a={att} token={token} />
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
                        {/* The closed trigger shows only this item: without the project, rooms named alike ("core") look the same. */}
                        {r.label.toLowerCase() !== g.name.toLowerCase() ? ` · ${g.name}` : ""}
                        {r.delivery === "inbox" ? " · inbox" : ""}
                        {r.waiting ? " · đang chờ anh" : ""}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <AttachButton a={att} disabled={disabled} className={TOUCH} />
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
