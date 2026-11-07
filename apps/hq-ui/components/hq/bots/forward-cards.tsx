"use client";

import { CheckIcon, CornerDownLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { replyForA } from "@/lib/bot-mention";
import type { Bot } from "@/lib/bots";
import type { Forward } from "@/lib/server/forward";
import type { Room } from "@/lib/server/office";
import { clock } from "../bits";
import type { Hq } from "../use-hq";
import { BotAvatar } from "./bot-avatar";
import { FullReply, useFullReply } from "./full-reply";
import { useBotBrief } from "./use-bot-brief";

/** A forward older than this has no card: the thread is about now. */
const FRESH_MS = 24 * 60 * 60 * 1000;
const SHOWN = 3;
/** What one message to A may hold (POST /api/messages). */
const SEND_MAX = 4000;

/**
 * Under bot A's conversation: each "@B …" the owner sent from A's thread (POST /api/forward), then B's
 * answer once B has replied after it: its whole last reply (GET /api/turns, folded when long), the brief's
 * 200-character summary only until that loads. Nothing goes back to A by itself: [Gửi cho A] sends that
 * answer to A, framed as a bot's information, not an owner's order (lib/bot-mention.ts replyForA).
 */
export function ForwardCards({ hq, bot, all, now, nonce }: { hq: Hq; bot: Bot<Room>; all: Bot<Room>[]; now: number; nonce: number }) {
  const [forwards, setForwards] = useState<Forward[]>([]);
  const room = bot.room.name;
  const api = hq.api;
  useEffect(() => {
    const ac = new AbortController();
    api<{ forwards: Forward[] }>(`/api/forward?room=${encodeURIComponent(room)}`, { signal: ac.signal })
      .then((d) => setForwards(d.forwards))
      .catch(() => {});
    return () => ac.abort();
  }, [api, room, nonce]);
  // The office poll's clock, not Date.now() during render.
  const shown = forwards.filter((f) => f.ts >= now - FRESH_MS).slice(-SHOWN);
  if (!shown.length) return null;
  return (
    <section aria-label="Tin anh chuyển cho bot khác" className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto border-t bg-muted/30 px-4 py-2.5 sm:px-6">
      {shown.map((f) => {
        const b = all.find((x) => x.room.name === f.to);
        return <ForwardCard key={`${f.ts}:${f.to}`} f={f} to={b ?? null} a={bot} hq={hq} />;
      })}
    </section>
  );
}

function ForwardCard({ f, to, a, hq }: { f: Forward; to: Bot<Room> | null; a: Bot<Room>; hq: Hq }) {
  const name = to?.display ?? f.to;
  return (
    <article className="rounded-xl border bg-background px-3 py-2.5 text-sm">
      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {to && <BotAvatar id={to.key} status={to.status} size={18} />}
        <span>
          Anh gửi <span className="font-medium text-foreground/80">{name}</span> · {clock(f.ts)}
        </span>
      </p>
      <p className="mt-1 line-clamp-2 text-muted-foreground" title={f.text}>
        {f.text}
      </p>
      {to ? <Reply f={f} to={to} a={a} hq={hq} /> : <p className="mt-2 text-xs text-muted-foreground">{name} không còn mở.</p>}
    </article>
  );
}

function Reply({ f, to, a, hq }: { f: Forward; to: Bot<Room>; a: Bot<Room>; hq: Hq }) {
  const brief = useBotBrief(hq.api, to.room);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const summary = brief?.lastReply && (brief.updatedAt ?? 0) > f.ts ? brief.lastReply : null;
  const full = useFullReply(hq.api, to.room, f.ts, !!summary);
  const reply = full ?? summary;
  if (!reply) return <p className="mt-2 text-xs text-muted-foreground">{to.status === "working" ? `${to.display} đang làm…` : `Chưa có trả lời từ ${to.display}.`}</p>;

  const send = async () => {
    setBusy(true);
    try {
      await hq.api("/api/messages", { method: "POST", body: { session: a.room.name, text: [...replyForA(to.name, reply)].slice(0, SEND_MAX).join("") } });
      setSent(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 border-l-2 border-primary/40 pl-3">
      <p className="text-[11px] font-medium text-muted-foreground">Trả lời từ {to.display}</p>
      {full ? <FullReply text={full} className="mt-0.5" /> : <p className="mt-0.5 whitespace-pre-wrap break-words">{reply}</p>}
      <Button type="button" size="sm" variant="outline" className="mt-2 max-md:h-11" onClick={send} disabled={busy || sent}>
        {sent ? <CheckIcon aria-hidden /> : <CornerDownLeftIcon aria-hidden />}
        {sent ? `Đã gửi cho ${a.display}` : `Gửi cho ${a.display}`}
      </Button>
    </div>
  );
}
