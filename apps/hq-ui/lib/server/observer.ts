// "Quan sát phòng" (/solo P1 Observer, su-code/research/self-improve-loop.md): Canh máy's tick also
// looks at every live room and acts on hard rules only (no model call, never kills). Per room and
// signal it climbs a ladder: `note` (shown on the Máy tab) → `nudge` (one short line to that room)
// → `page` (to the Canh máy room, which the owner reads), one step per `cooldownMin`, back to zero
// as soon as the signal clears. This file is pure; machine-watch.ts delivers what it decides.
import { BG_LABEL, STALL_QUIET as QUIET, type FloorRow } from "../floor";

export type Signal = "stalled" | "looping" | "waiting" | "error";
export type Level = "note" | "nudge" | "page";

export type ObserveConfig = { stallMin: number; loopMin: number; waitMin: number; cooldownMin: number };
export const OBSERVE_DEFAULT: ObserveConfig = { stallMin: 20, loopMin: 20, waitMin: 15, cooldownMin: 30 };

/**
 * The ladder per signal. A room waiting on the owner (question or dialog open) or stopped on an API
 * error / usage limit is never nudged: a message would answer its open question, or start a turn
 * that hits the same limit.
 */
export const LADDER: Record<Signal, readonly Level[]> = {
  stalled: ["note", "nudge", "page"],
  looping: ["note", "nudge", "page"],
  waiting: ["note", "page"],
  error: ["note", "page"],
};

/**
 * `seen`: per room, the step it shows, since when (unix ms) and its transcript time then (loop
 * timing); `steps`: per `room|signal`, the last rung and when.
 */
export type ObserveState = {
  seen: Record<string, { caption: string; since: number; active: number | null }>;
  steps: Record<string, { level: Level; at: number }>;
};
export const observeZero = (): ObserveState => ({ seen: {}, steps: {} });

export type ObserveAction = { room: string; title: string; signal: Signal; level: Level; at: number; why: string };

/**
 * Who not to look at (the owner's list), and the Canh máy room: never nudged or paged about itself,
 * and with none chosen nobody can be paged, so every ladder stops at `nudge`.
 */
export type ObserveScope = { skip: readonly string[]; watchRoom: string | null };

const WORKING = new Set<FloorRow["state"]>(["typing", "running", "reading"]);

/**
 * The signals a room shows this tick (pure), with a reason in Vietnamese. `loop`: how long it has
 * shown the same step (ms) and whether its transcript moved in that time.
 */
export function roomSignals(r: FloorRow, loop: { ms: number; moved: boolean }, now: number, cfg: ObserveConfig): { signal: Signal; why: string }[] {
  const out: { signal: Signal; why: string }[] = [];
  const quietMin = r.last_active != null ? Math.floor((now - r.last_active * 1000) / 60_000) : null;
  if (r.state === "stalled" && !r.caption.startsWith(QUIET)) out.push({ signal: "error", why: `dừng vì lỗi: ${r.caption}` });
  if (r.state === "waiting" && quietMin != null && quietMin >= cfg.waitMin) out.push({ signal: "waiting", why: `chờ owner ${quietMin} phút: ${r.caption}` });
  // A room still at work (or quiet with open work) whose transcript has not moved. Background jobs
  // count as work, and an hq-only row's last_active is its start time, not activity.
  const open = WORKING.has(r.state) || (r.state === "stalled" && r.caption.startsWith(QUIET));
  if (open && r.label !== BG_LABEL && !r.unmatched && quietMin != null && quietMin >= cfg.stallMin) out.push({ signal: "stalled", why: `đứng ${quietMin} phút` });
  const loopMin = Math.floor(loop.ms / 60_000);
  if (WORKING.has(r.state) && r.label !== BG_LABEL && loop.moved && loopMin >= cfg.loopMin) out.push({ signal: "looping", why: `lặp "${r.caption}" ${loopMin} phút` });
  return out;
}

/**
 * One tick (pure). `rows`: the live rooms HQ can reach (keyed by `inbox_id`). Returns the rungs
 * reached this tick and the next state. Skipped rooms are not looked at; the Canh máy room only
 * ever gets a `note`, and without a Canh máy room nothing climbs past `nudge`. A signal that clears
 * drops its rung, so it starts again at `note`.
 */
export function observeStep(state: ObserveState, rows: readonly FloorRow[], now: number, cfg: ObserveConfig, scope: ObserveScope): { actions: ObserveAction[]; next: ObserveState } {
  const skip = new Set(scope.skip);
  const next: ObserveState = { seen: {}, steps: {} };
  const actions: ObserveAction[] = [];
  for (const r of rows) {
    const id = r.inbox_id;
    if (!id || skip.has(id) || next.seen[id]) continue;
    // Loop: the room shows the same step for loopMin while its transcript keeps moving (a transcript
    // that does not move is the stall rule's case).
    const prev = state.seen[id];
    const kept = prev != null && WORKING.has(r.state) && r.caption !== "" && prev.caption === r.caption;
    next.seen[id] = kept ? prev : { caption: r.caption, since: now, active: r.last_active };
    const seen = next.seen[id];
    const loop = { ms: now - seen.since, moved: r.last_active != null && seen.active != null && r.last_active > seen.active };
    for (const { signal, why } of roomSignals(r, loop, now, cfg)) {
      const key = `${id}|${signal}`;
      const ladder: readonly Level[] = id === scope.watchRoom ? ["note"] : scope.watchRoom ? LADDER[signal] : LADDER[signal].filter((l) => l !== "page");
      const step = state.steps[key];
      const at = step ? ladder.indexOf(step.level) : -1;
      const rung = !step ? ladder[0] : at >= 0 && now - step.at >= cfg.cooldownMin * 60_000 ? ladder[at + 1] : undefined;
      if (rung) {
        next.steps[key] = { level: rung, at: now };
        actions.push({ room: id, title: r.title || r.name, signal, level: rung, at: now, why });
      } else next.steps[key] = step;
    }
  }
  return { actions, next };
}

const SIGNAL_LABEL: Record<Signal, string> = { stalled: "đứng", looping: "lặp", waiting: "chờ owner", error: "dừng vì lỗi" };

/** The one line a nudged room gets. */
export function nudgeText(a: ObserveAction): string {
  return `[Canh máy] Phòng này ${a.signal === "looping" ? "đang lặp lại cùng một bước" : a.why}: kiểm lại bước hiện tại, đổi hướng nếu cần, hoặc báo blocker cho owner.`;
}

/** What the Canh máy room gets when a room climbs to `page`. */
export function pageText(a: ObserveAction): string {
  return [
    `[Canh máy · quan sát phòng] Phòng "${a.title}" (${a.room}) ${SIGNAL_LABEL[a.signal]}: ${a.why}.`,
    "Đừng kill hay gõ vào phòng đó. Báo owner một dòng (phòng nào, đứng ở đâu, owner cần làm gì) rồi dừng.",
  ].join("\n");
}
