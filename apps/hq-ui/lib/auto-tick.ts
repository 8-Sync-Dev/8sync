// "Chạy liên tục": HQ wakes idle sessions while `8sync ccc auto` is on and not paused. Pure rules, no fs.

export const TICK_IDLE_MS = 60_000;
/** The Office polls every 60 s too: a few seconds of jitter must not push the tick to the next poll. */
export const TICK_SLACK_MS = 5_000;
export const TICK_EVERY_MS = 10 * 60_000;
/** No poll for this long (tab closed, auto paused): the idle-since map is stale and starts over. */
export const STALE_MS = 3 * 60_000;
const PRUNE_MS = 24 * 3600_000;

export const TICK_PROMPT =
  "8sync auto-tick: phiên này rảnh hơn 1 phút trong lúc HQ đang 'Chạy liên tục'. Nếu đã có /loop hoặc cron riêng đang chạy (CronList) → trả lời 'đã có loop' và không làm gì thêm. Nếu su-code/ship/ACTIVE có vòng lặp mở → /ship-tick <slug>. Không thì làm MỘT nhịp theo .claude/loop.md nếu có; thiếu file thì MỘT việc từ su-code/STATE.md mục Next hợp với phòng của bạn và tự chọn skill (code → /ship, ≤3 file → /do, R&D → /deep-research), rồi `8sync ccc meet --say`. Không merge/push main/tag/deploy; câu hỏi Ship vẫn chờ owner.";

export type TickRoom = { session_id: string | null; status: string; inboxLive: boolean; pending: number; idleSince: number };

export function tickTargets(rooms: TickRoom[], ticked: Record<string, number>, now: number): string[] {
  const out: string[] = [];
  for (const r of rooms) {
    const sid = r.session_id;
    // Allowlist: only "idle" (lib/server/proc.ts) — running / needs_input / ended / anything new never ticks.
    if (!sid || r.status !== "idle" || !r.inboxLive || r.pending !== 0) continue;
    if (now - r.idleSince < TICK_IDLE_MS - TICK_SLACK_MS || now - (ticked[sid] ?? 0) < TICK_EVERY_MS) continue;
    if (!out.includes(sid)) out.push(sid);
  }
  return out;
}

export function pruneTicked(ticked: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(ticked).filter(([, ts]) => typeof ts === "number" && now - ts <= PRUNE_MS));
}
