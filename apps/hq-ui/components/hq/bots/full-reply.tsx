"use client";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import type { Turn } from "@/lib/room-turns";
import type { Room } from "@/lib/server/office";
import { cn } from "@/lib/utils";
import { pathMarkdown } from "../path-open";
import type { Hq } from "../use-hq";

/** Past this many characters or lines the reply opens folded. */
const FOLD_CHARS = 480;
const FOLD_LINES = 8;

/**
 * Bot `r`'s whole last answer written after `since` (GET /api/turns: the turn's final reply, up to 8 000
 * characters, secrets masked), not the brief's 200-character summary. Reads when `ready` (its brief shows a
 * reply after `since`) and again whenever the office row moves; null until then, or when no turn has one.
 */
export function useFullReply(api: Hq["api"], r: Pick<Room, "name" | "status" | "last_active">, since: number, ready: boolean): string | null {
  const [got, setGot] = useState<{ key: string; text: string | null } | null>(null);
  const key = `${r.name}:${since}`;
  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    api<{ turns: Turn[] }>(`/api/turns?room=${encodeURIComponent(r.name)}&n=3`, { signal: ac.signal })
      .then((d) => {
        const t = d.turns.findLast((x) => x.output && (x.outputAt ?? x.at ?? 0) > since);
        setGot({ key, text: t?.output ?? null });
      })
      .catch(() => {});
    return () => ac.abort();
  }, [api, r.name, r.status, r.last_active, since, ready, key]);
  return got?.key === key ? got.text : null;
}

/** A bot's answer in full: markdown, folded behind "Xem đủ" when long. */
export function FullReply({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > FOLD_CHARS || text.split("\n").length > FOLD_LINES;
  return (
    <div className={className}>
      <div className={cn("relative text-sm break-words", long && !open && "max-h-40 overflow-hidden")}>
        <MessageResponse {...pathMarkdown}>{text}</MessageResponse>
        {long && !open && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent" />}
      </div>
      {long && (
        <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-1.5 text-xs text-muted-foreground max-md:h-11" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDownIcon aria-hidden className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          {open ? "Thu gọn" : `Xem đủ (${text.length.toLocaleString("vi-VN")} ký tự)`}
        </Button>
      )}
    </div>
  );
}
