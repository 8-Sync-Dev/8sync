"use client";

import { SendIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ANSWER_MAX } from "@/lib/ask";
import { cn } from "@/lib/utils";
import { TOUCH } from "./room-send";

/**
 * "Khác": the owner's own one-line answer, next to the option buttons (a question's free-text row,
 * a /solo question). `onSend` resolves true when it went out; the box clears then.
 */
export function OtherAnswer({ label, disabled, onSend }: { label: string; disabled: boolean; onSend: (text: string) => Promise<boolean> }) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const t = text.trim();
  return (
    <form
      className="flex max-w-xl items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!t || busy) return;
        setBusy(true);
        try {
          if (await onSend(t)) setText("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id} className="shrink-0 text-xs font-medium text-muted-foreground">
        Khác
      </label>
      <Input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={ANSWER_MAX}
        disabled={disabled || busy}
        placeholder="Gõ câu trả lời của anh"
        aria-label={label}
        enterKeyHint="send"
        className={cn("h-8 min-w-0 flex-1 text-sm", "max-sm:h-11")}
      />
      <Button type="submit" size="sm" variant="outline" className={cn("h-8", TOUCH)} disabled={disabled || busy || !t} aria-busy={busy}>
        <SendIcon aria-hidden /> Gửi
      </Button>
    </form>
  );
}
