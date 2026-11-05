"use client";

import { PlayIcon, SquareIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { agoShort } from "@/lib/now";
import type { ProjectSolo } from "@/lib/server/solo";
import type { SoloAction, SoloLog } from "@/lib/solo";
import { cn } from "@/lib/utils";
import { TOUCH } from "./room-send";
import { SoloChip, SoloQuestion, SoloRoomPick, soloSend, useSoloRoom } from "./solo-parts";
import type { Room } from "./use-office";

const LOG_SHOWN = 5;
const CRITIC_SHOWN = 3;

/**
 * "Vòng lặp" tab, per project: `/solo` (auto-do, auto-ship, auto-evolve; stops only for the owner's
 * choice). Status, the item in hand, the pending question, the Critic's latest picks (each one can be
 * overridden) and the last log lines; Bật Solo / Dừng into the project's Claude Code room the owner
 * picks (no room is created here).
 */
export function SoloCard({ root, name, solo, rooms, token, now }: { root: string; name: string; solo: ProjectSolo | null; rooms: Room[]; token: string; now: number }) {
  const { room, choices, pick } = useSoloRoom(root, rooms);
  const [busy, setBusy] = useState<SoloAction | null>(null);
  const state = solo?.state ?? "stopped";
  const s = solo?.solo ?? null;
  const critics = (s?.log ?? []).filter((l) => l.kind === "critic").slice(-CRITIC_SHOWN).reverse();
  const log = (s?.log ?? []).slice(-LOG_SHOWN).reverse();

  const act = async (action: SoloAction, answer?: string) => {
    if (!room) return;
    setBusy(action);
    try {
      if (await soloSend(token, root, room, action, answer))
        toast.success(action === "start" ? `Đã gửi /solo vào ${room.label}` : action === "stop" ? `Đã bảo Solo ở ${name} dừng` : `Đã đổi lựa chọn: “${answer}”`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="solo" className="max-w-5xl space-y-2 px-4 pb-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id="solo" className="flex items-center gap-1.5 text-sm font-semibold">
          <ZapIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Solo
          <span className="text-xs font-normal text-muted-foreground">tự làm, tự ship, chỉ dừng khi cần anh chọn</span>
        </h2>
        <SoloChip state={state} />
      </div>
      <div className="space-y-3 rounded-lg border px-3 py-3 text-sm">
        {s?.item && state !== "stopped" && (
          <p className="text-pretty">
            <span className="text-muted-foreground">Đang làm: </span>
            {s.item}
            {s.updated != null && <span className="text-xs text-muted-foreground"> · {agoShort(s.updated, now)}</span>}
          </p>
        )}

        {solo && state === "waiting" && <SoloQuestion s={solo} room={room} token={token} now={now} />}

        {critics.length > 0 && (
          <ul className="space-y-2" aria-label="Lựa chọn của Critic">
            {critics.map((c, i) => (
              <CriticPick key={`${c.at}-${i}`} c={c} now={now} disabled={!room || busy != null} canOverride={state !== "stopped"} onOverride={(label) => void act("override", label)} />
            ))}
          </ul>
        )}

        {log.length > 0 && (
          <ol className="space-y-0.5 border-t pt-2" aria-label="Nhật ký Solo, mới nhất trước">
            {log.map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex gap-2 text-xs">
                <span className="w-10 shrink-0 text-right text-muted-foreground tabular">{agoShort(l.at, now)}</span>
                <span className="min-w-0 break-words text-muted-foreground">
                  {l.kind === "asked" ? `Hỏi anh: ${l.question}` : l.kind === "critic" ? `Critic chọn “${l.label}”` : l.kind === "owner" ? `Anh chọn “${l.label}”` : l.text}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {state === "stopped" ? (
            <Button type="button" size="sm" className={TOUCH} disabled={!room || busy != null} aria-busy={busy === "start"} onClick={() => void act("start")}>
              <PlayIcon aria-hidden /> Bật Solo
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" className={TOUCH} disabled={!room || busy != null} aria-busy={busy === "stop"} onClick={() => void act("stop")}>
              <SquareIcon aria-hidden /> Dừng Solo
            </Button>
          )}
          <SoloRoomPick room={room} choices={choices} pick={pick} />
          <span className={cn("text-xs text-muted-foreground", !room && "text-foreground")}>
            {!room ? `Mở một phiên Claude Code trong ${name} để bật Solo.` : choices.length < 2 ? `Gửi vào phiên ${room.label}` : null}
          </span>
        </div>
      </div>
    </section>
  );
}

/** One Critic pick: what it chose and why, and (while /solo runs) the other options of that question to override it. */
function CriticPick({ c, now, disabled, canOverride, onOverride }: { c: SoloLog; now: number; disabled: boolean; canOverride: boolean; onOverride: (label: string) => void }) {
  const [open, setOpen] = useState(false);
  const others = canOverride ? c.options.filter((o) => o !== c.label) : [];
  return (
    <li className="space-y-1.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-pretty">
          <span className="mr-1.5 rounded-sm bg-muted px-1.5 py-px align-[1px] text-[11px] font-semibold text-muted-foreground">Critic chọn</span>
          <span className="font-medium">“{c.label}”</span>
          {c.reason && <span className="text-muted-foreground">: {c.reason}</span>}
          <span className="text-xs text-muted-foreground"> · {agoShort(c.at, now)}</span>
        </p>
        {others.length > 0 && (
          <Button type="button" size="xs" variant="outline" className={cn("shrink-0", TOUCH)} aria-expanded={open} onClick={() => setOpen(!open)}>
            Đổi
          </Button>
        )}
      </div>
      {open && others.length > 0 && c.question && <p className="text-xs text-muted-foreground">{c.question}</p>}
      {open && others.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Đổi lựa chọn của Critic: ${c.label}`}>
          {others.map((o) => (
            <Button key={o} type="button" size="sm" variant="outline" className={cn("h-auto min-h-7 py-1.5 text-left whitespace-normal", "max-sm:min-h-11")} disabled={disabled} onClick={() => onOverride(o)}>
              Chọn “{o}”
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}
