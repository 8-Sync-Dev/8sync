"use client";

import { ArrowUpIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, type Hq } from "../use-hq";

/** What a 409 from POST /api/chief/ask means to the owner (the route's own words when it gave Vietnamese ones). */
export function chiefError(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return e.message === "session-waiting" ? "Chief đang chờ anh trả lời trong terminal: trả lời ở đó rồi gửi lại." : e.message;
  return (e as Error).message || "Không gửi được cho Chief.";
}

/**
 * The Chief of Staff's message box: the owner's words go to POST /api/chief/ask {text}, which hands them
 * on with the live rooms and the routing rule; a 409 (off, room gone, dialog open) shows under the box.
 */
export function ChiefComposer({ hq, name }: { hq: Hq; name: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await hq.api("/api/chief/ask", { method: "POST", body: { text: body } });
      setText("");
      area.current?.focus();
    } catch (e) {
      setError(chiefError(e));
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="shrink-0 border-t bg-background px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      <div className="flex items-end gap-2 rounded-xl border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring/50">
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          aria-label={`Nhắn Chief ${name}`}
          placeholder={`Nhắn Chief ${name}: Chief chia việc cho các phòng`}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base outline-none placeholder:text-muted-foreground md:text-sm [field-sizing:content]"
        />
        <Button type="button" size="icon" onClick={() => void send()} disabled={!text.trim() || busy} aria-label="Gửi cho Chief" className="size-9 shrink-0 rounded-full max-md:size-11">
          <ArrowUpIcon aria-hidden />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 px-1 text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 px-1 text-xs text-muted-foreground">HQ gửi kèm danh sách các phòng đang mở cho Chief.</p>
      )}
    </div>
  );
}
