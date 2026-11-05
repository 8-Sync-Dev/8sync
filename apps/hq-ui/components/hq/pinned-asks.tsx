"use client";

import { ChevronDownIcon, HandIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { askLine } from "@/lib/ask";
import { roster } from "@/lib/now";
import type { ProjectSolo } from "@/lib/server/solo";
import { cn } from "@/lib/utils";
import { AskCard, askRoomOf, pinnedAsk } from "./ask-panel";
import { TOUCH } from "./room-send";
import { SoloQuestion, SoloRoomPick, useSoloRoom } from "./solo-parts";
import type { Office, Room } from "./use-office";

/**
 * Pinned under the header on every tab: each question waiting on the owner. A room stopped on an
 * AskUserQuestion (options as one-tap buttons, "Khác", or its terminal for multi-select), an omp room
 * waiting (its terminal: HQ cannot read omp's question), and a /solo question from SOLO.md (answered
 * as a message). Permission prompts stay in the Tổng quan / Văn phòng panels. Folds to one line; a new
 * question unfolds it again.
 */
export function PinnedAsks({ office, token, onOpenRoom }: { office: Office | null; token: string; onOpenRoom: (r: Room) => void }) {
  const now = office?.at ?? 0;
  const rooms = useMemo(() => office?.rooms ?? [], [office]);
  const asks = useMemo(
    () =>
      roster(rooms, now).flatMap((n) => {
        if (n.state !== "needs") return [];
        const a = askRoomOf(n.room);
        return pinnedAsk(a) ? [a] : [];
      }),
    [rooms, now],
  );
  const solos = useMemo(() => (office?.solo ?? []).filter((s) => s.state === "waiting"), [office]);
  const sig = [...solos.map((s) => `${s.root}\n${s.solo?.question ?? ""}`), ...asks.map((a) => `${a.key}\n${askLine(a.ask) ?? ""}`)].join("\n\n");
  const [folded, setFolded] = useState<string | null>(null);
  const n = asks.length + solos.length;
  if (!n) return null;
  const open = folded !== sig;
  const first = solos[0] ? `Solo ở ${solos[0].name}: ${solos[0].solo?.question ?? "đang chờ anh chọn"}` : (askLine(asks[0].ask) ?? `${asks[0].label} đang chờ anh`);

  return (
    <section aria-label="Câu hỏi đang chờ anh" className="shrink-0 border-b bg-st-needs/6 px-3 py-1.5 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <HandIcon aria-hidden className="size-4 shrink-0 text-st-needs" />
        <h2 className="shrink-0 text-sm font-semibold">
          Chờ anh chọn <span className="tabular">· {n}</span>
        </h2>
        {!open && <p className="min-w-0 truncate text-xs text-muted-foreground">{first}</p>}
        <Button type="button" size="sm" variant="ghost" className={cn("ml-auto shrink-0", TOUCH)} aria-expanded={open} onClick={() => setFolded(open ? sig : null)}>
          <ChevronDownIcon aria-hidden className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          {open ? "Thu gọn" : "Xem"}
        </Button>
      </div>
      {open && (
        <ul className="mt-1.5 max-h-[38dvh] space-y-2.5 overflow-y-auto overscroll-contain pb-1.5 sm:max-h-[45dvh]">
          {solos.map((s) => (
            <SoloPin key={s.root} s={s} rooms={rooms} token={token} now={now} />
          ))}
          {asks.map((a) => (
            <AskCard
              key={a.key}
              r={a}
              now={now}
              token={token}
              onOpen={(key) => {
                const r = rooms.find((x) => x.key === key);
                if (r) onOpenRoom(r);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SoloPin({ s, rooms, token, now }: { s: ProjectSolo; rooms: Room[]; token: string; now: number }) {
  const { room, choices, pick } = useSoloRoom(s.root, rooms);
  return (
    <li className="rounded-xl border border-st-needs bg-background px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-sm">
          <span className="font-semibold">Solo</span>
          <span className="text-muted-foreground"> · {s.name}</span>
          {s.solo?.item && <span className="text-muted-foreground"> · {s.solo.item}</span>}
        </p>
        <SoloRoomPick room={room} choices={choices} pick={pick} className="ml-auto" />
      </div>
      <SoloQuestion s={s} room={room} token={token} now={now} />
    </li>
  );
}
