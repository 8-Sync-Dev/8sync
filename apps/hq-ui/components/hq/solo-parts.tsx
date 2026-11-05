"use client";

import { BotIcon, CheckIcon, TimerIcon } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rootKey } from "@/lib/preview";
import type { ProjectSolo } from "@/lib/server/solo";
import { criticIn, SOLO_LABEL, type SoloAction, type SoloStatus } from "@/lib/solo";
import { cn } from "@/lib/utils";
import { OtherAnswer } from "./other-answer";
import { TOUCH } from "./room-send";
import { ApiError, makeApi } from "./use-hq";
import type { Room } from "./use-office";

/** The Claude Code rooms of a project (where `/solo` can run), most recently active first. */
export function soloRooms(rooms: Room[], root: string): Room[] {
  const k = rootKey(root);
  return rooms
    .filter((r) => r.engine !== "omp" && r.status !== "ended" && r.project != null && rootKey(r.project.root) === k)
    .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0));
}

const PICK_EVENT = "hq-solo-room";
const pickKey = (root: string) => `hq.solo.room:${rootKey(root)}`;
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(PICK_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(PICK_EVENT, cb);
  };
}

/**
 * The room that gets the project's /solo messages: the one the owner picked (remembered per project,
 * shared by the pinned question and the "Vòng lặp" card), else the most recently active.
 */
export function useSoloRoom(root: string, rooms: Room[]): { room: Room | null; choices: Room[]; pick: (name: string) => void } {
  const choices = soloRooms(rooms, root);
  const saved = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(pickKey(root)),
    () => null,
  );
  const pick = useCallback(
    (name: string) => {
      window.localStorage.setItem(pickKey(root), name);
      window.dispatchEvent(new Event(PICK_EVENT));
    },
    [root],
  );
  return { room: choices.find((r) => r.name === saved) ?? choices[0] ?? null, choices, pick };
}

/** POST /api/solo; true when it was handed to the room. Errors are toasted. */
export async function soloSend(token: string, root: string, room: Room, action: SoloAction, answer?: string): Promise<boolean> {
  try {
    const r = await makeApi(token)<{ delivery: string; error: string | null }>("/api/solo", { method: "POST", body: { root, session: room.name, action, ...(answer != null && { answer }) } });
    if (r.delivery === "failed") {
      toast.error(`Chưa gửi được tới ${room.label}${r.error ? ` (${r.error})` : ""}`);
      return false;
    }
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.message === "session-waiting") toast.error(`${room.label} đang chờ anh trả lời trong terminal: trả lời trước rồi thử lại`);
    else toast.error((e as Error).message);
    return false;
  }
}

const CHIP: Record<SoloStatus, string> = {
  running: "border-st-running/40 bg-st-running/10 text-st-running",
  waiting: "border-st-needs/50 bg-st-needs/12 text-foreground",
  stopped: "border-border bg-muted text-muted-foreground",
};

/** Đang chạy / Chờ anh chọn / Đã dừng, with a dot (never color alone: the word says it). */
export function SoloChip({ state }: { state: SoloStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", CHIP[state])}>
      <span aria-hidden className={cn("size-1.5 rounded-full", state === "running" ? "bg-st-running" : state === "waiting" ? "bg-st-needs" : "bg-st-idle")} />
      {SOLO_LABEL[state]}
    </span>
  );
}

/** Which room gets the messages, when the project has more than one Claude Code room. */
export function SoloRoomPick({ room, choices, pick, className }: { room: Room | null; choices: Room[]; pick: (name: string) => void; className?: string }) {
  if (choices.length < 2) return null;
  return (
    <Select value={room?.name} onValueChange={pick}>
      <SelectTrigger size="sm" className={cn("max-w-60 text-xs", TOUCH, className)} aria-label="Phiên chạy Solo">
        <SelectValue placeholder="Chọn phiên" />
      </SelectTrigger>
      <SelectContent>
        {choices.map((r) => (
          <SelectItem key={r.name} value={r.name} className="text-xs">
            {r.label}
            {r.status === "needs_input" ? <span className="text-muted-foreground"> · đang chờ anh</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The question /solo waits on (SOLO.md `Question:` + `Options:`): one button per option (the first is
 * the one /solo recommends) and "Khác"; each sends `solo: <answer>` to the room. The Critic answers
 * by itself at `Deadline:`, shown as a countdown.
 */
export function SoloQuestion({ s, room, token, now }: { s: ProjectSolo; room: Room | null; token: string; now: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const q = s.solo;
  if (!q || s.state !== "waiting") return null;
  const left = criticIn(q.deadline, now);
  const answer = async (text: string) => {
    if (!room) return false;
    setBusy(text);
    try {
      const ok = await soloSend(token, s.root, room, "answer", text);
      if (ok) toast.success(`Đã gửi “${text}” cho Solo ở ${s.name}`);
      return ok;
    } finally {
      setBusy(null);
    }
  };
  const off = !room || busy != null;
  return (
    <div className="space-y-2">
      <p className="max-w-[75ch] text-[15px] leading-snug font-medium text-pretty">{q.question ?? "Solo đang chờ anh chọn (SOLO.md chưa ghi câu hỏi)."}</p>
      {q.options.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Chọn cho Solo ở ${s.name}`}>
          {q.options.map((o, i) => (
            <Button
              key={o}
              type="button"
              size="sm"
              variant={i === 0 ? "default" : "outline"}
              className={cn("h-auto min-h-7 max-w-full justify-start py-1.5 text-left whitespace-normal", "max-sm:min-h-11")}
              disabled={off}
              aria-busy={busy === o}
              onClick={() => void answer(o)}
            >
              {i === 0 && <CheckIcon aria-hidden />}
              <span className="min-w-0">
                {o}
                {i === 0 && <span className="ml-1.5 text-xs font-normal opacity-80">đề xuất</span>}
              </span>
            </Button>
          ))}
        </div>
      )}
      <OtherAnswer label={`Câu trả lời khác cho Solo ở ${s.name}`} disabled={off} onSend={answer} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {left ? (
          <span className="inline-flex items-center gap-1 font-medium text-foreground tabular">
            <TimerIcon aria-hidden className="size-3.5 text-st-needs" />
            {left}
          </span>
        ) : q.deadline != null ? (
          <span className="inline-flex items-center gap-1">
            <BotIcon aria-hidden className="size-3.5" /> Hết giờ chờ: Critic đang chọn
          </span>
        ) : null}
        <span>{room ? `Gửi vào phiên ${room.label}` : "Dự án chưa có phiên Claude Code nào để nhận câu trả lời"}</span>
      </p>
    </div>
  );
}
