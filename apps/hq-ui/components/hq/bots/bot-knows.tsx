"use client";

import { BrainIcon, CheckIcon, ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { Bot } from "@/lib/bots";
import type { Facts } from "@/lib/server/facts";
import type { Room } from "@/lib/server/office";
import { cn } from "@/lib/utils";
import { clock } from "../bits";
import type { Hq } from "../use-hq";

type DigestView = { room: string; last: { text: string; at: number | null } | null; optOut: boolean; now: string | null; changed: boolean };

/**
 * "Bot này đang biết gì": the shared facts every bot gets (the owner edits them here, and approves or drops
 * what a bot proposed with `hq.mjs fact`), the last "ai đang làm gì" digest this bot received
 * (lib/server/digest.ts), and the owner's switch for it. Reads GET /api/facts and /api/digest again when the
 * bot's office row moves; writes are the owner's page only (PUT, the server answers 403 to a room).
 */
export function BotKnows({ hq, bot }: { hq: Hq; bot: Bot<Room> }) {
  const api = hq.api;
  const room = bot.room.name;
  const [facts, setFacts] = useState<Facts | null>(null);
  const [digest, setDigest] = useState<(DigestView & { key: string }) | null>(null);
  const [nonce, setNonce] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** null: not toggled yet, open while a proposal waits for the owner. */
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api<Facts>("/api/facts", { signal: ac.signal })
      .then(setFacts)
      .catch(() => {});
    api<DigestView>(`/api/digest?room=${encodeURIComponent(room)}`, { signal: ac.signal })
      .then((d) => setDigest({ ...d, key: room }))
      .catch(() => {});
    return () => ac.abort();
  }, [api, room, nonce, bot.room.status, bot.room.last_active]);
  const d = digest?.key === room ? digest : null;
  const pending = facts?.pending ?? [];
  const list = facts?.facts ?? [];

  const put = useCallback(
    async (path: string, body: Record<string, unknown>, ok?: string) => {
      setBusy(true);
      try {
        await api(path, { method: "PUT", body });
        if (ok) toast.success(ok);
        setNonce((n) => n + 1);
        return true;
      } catch (e) {
        toast.error((e as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [api],
  );
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (t && (await put("/api/facts", { facts: [...list.map((f) => f.text), t] }))) setDraft("");
  };

  return (
    <Collapsible open={open ?? pending.length > 0} onOpenChange={setOpen} className="shrink-0 border-b">
      <CollapsibleTrigger className="group/knows flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60">
        <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground transition-transform group-data-[state=open]/knows:rotate-90 motion-reduce:transition-none" />
        <BrainIcon aria-hidden className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">Bot này đang biết gì</span>
        {pending.length > 0 && (
          <span title={`${pending.length} đề xuất chờ anh duyệt`} className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground tabular">
            {pending.length}
            <span className="sr-only"> đề xuất chờ duyệt</span>
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-4 pb-4 text-sm">
          <section aria-labelledby={`knows-digest-${bot.key}`} className="space-y-2">
            <div className="flex items-center gap-3">
              <h3 id={`knows-digest-${bot.key}`} className="flex-1 text-xs font-medium text-muted-foreground">
                Bảng &ldquo;ai đang làm gì&rdquo; bot nhận{d?.last?.at ? ` · ${clock(d.last.at)}` : ""}
              </h3>
              <button
                type="button"
                role="switch"
                aria-checked={d ? !d.optOut : true}
                aria-label="Gửi bảng ai đang làm gì cho bot này"
                disabled={!d || busy}
                onClick={() => d && put("/api/digest", { room, optOut: !d.optOut }, d.optOut ? "Đã bật bảng cho bot này" : "Đã tắt bảng cho bot này")}
                className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
              >
                <span className={cn("relative h-5 w-9 rounded-full transition-colors motion-reduce:transition-none", d && !d.optOut ? "bg-primary" : "bg-muted-foreground/30")}>
                  <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow transition-transform motion-reduce:transition-none", d && !d.optOut && "translate-x-4")} />
                </span>
                {d && !d.optOut ? "Bật" : "Tắt"}
              </button>
            </div>
            {d?.last ? (
              <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">{d.last.text}</pre>
            ) : (
              <p className="text-xs text-muted-foreground">Chưa nhận bảng nào.</p>
            )}
            {d && (
              <p className="text-xs text-muted-foreground">
                {d.optOut
                  ? "Đã tắt: tin của anh tới bot này không kèm bảng (bot vẫn tự đọc được bằng hq.mjs digest)."
                  : d.changed
                    ? "Bảng đã đổi: sẽ đi kèm tin tới của anh."
                    : d.now
                      ? "Không đổi từ lần trước: tin tới không kèm lại."
                      : "Chưa có gì để báo: không bot nào khác, chưa có fact chung."}
              </p>
            )}
          </section>

          <section aria-labelledby={`knows-facts-${bot.key}`} className="space-y-2">
            <h3 id={`knows-facts-${bot.key}`} className="text-xs font-medium text-muted-foreground">
              Fact chung, mọi bot cùng biết ({list.length})
            </h3>
            {facts?.broken && <p className="text-xs text-destructive">facts.json hỏng: lưu lại danh sách để ghi đè (HQ giữ bản cũ ở facts.json.bad).</p>}
            {list.length > 0 && (
              <ul className="space-y-1">
                {list.map((f) => (
                  <li key={f.id} className="flex items-start gap-2 rounded-md bg-muted/40 py-1 pr-1 pl-2.5">
                    <span className="min-w-0 flex-1 py-1 break-words">{f.text}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 max-md:size-11"
                      aria-label={`Bỏ fact: ${f.text}`}
                      disabled={busy}
                      onClick={() => put("/api/facts", { facts: list.filter((x) => x.id !== f.id).map((x) => x.text) })}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={add} className="flex gap-2">
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={160} placeholder="VD: Chủ là Tú, múi giờ GMT+7" aria-label="Fact chung mới" className="max-md:h-11" />
              <Button type="submit" size="sm" variant="outline" disabled={busy || !draft.trim()} className="shrink-0 max-md:h-11">
                <PlusIcon aria-hidden /> Thêm
              </Button>
            </form>
          </section>

          {pending.length > 0 && (
            <section aria-labelledby={`knows-pending-${bot.key}`} className="space-y-2">
              <h3 id={`knows-pending-${bot.key}`} className="text-xs font-medium text-muted-foreground">
                Bot đề xuất, chờ anh duyệt ({pending.length})
              </h3>
              <ul className="space-y-1.5">
                {pending.map((p) => (
                  <li key={p.id} className="rounded-lg border px-2.5 py-2">
                    <p className="break-words">{p.text}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="flex-1 text-[11px] text-muted-foreground">
                        {p.from ? `từ ${p.from}` : "từ một bot"} · {clock(p.at)}
                      </span>
                      <Button type="button" size="sm" variant="ghost" className="max-md:h-11" disabled={busy} onClick={() => put("/api/facts", { reject: p.id }, "Đã bỏ đề xuất")}>
                        <XIcon aria-hidden /> Bỏ
                      </Button>
                      <Button type="button" size="sm" className="max-md:h-11" disabled={busy} onClick={() => put("/api/facts", { approve: p.id }, "Đã thêm vào fact chung")}>
                        <CheckIcon aria-hidden /> Duyệt
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
