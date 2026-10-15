/**
 * "Giao việc theo lịch": HQ does not run its own timer. It hands the session one prompt asking it to
 * schedule the task with Claude Code's native `CronCreate` (https://code.claude.com/docs/en/scheduled-tasks):
 * the session's own scheduler fires it between turns, in local time, recurring tasks expire after 7 days
 * (a bound Claude Code sets on purpose; HQ does not work around it), and the owner sees and cancels
 * the job like any other (`CronList` / `CronDelete`, or Esc on a /loop).
 */
export type Schedule =
  | { kind: "once"; at: string }
  | { kind: "daily"; at: string }
  | { kind: "every"; n: number; unit: "m" | "h" };

/** Steps that divide the hour / day evenly, so the cron step is exact (docs: other steps get rounded). */
export const EVERY_MINUTES = [5, 10, 15, 20, 30] as const;
export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12] as const;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validate `body.schedule` from the API: `null`/absent = deliver now. */
export function parseSchedule(v: unknown): { ok: true; value: Schedule | null } | { ok: false; error: string } {
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v !== "object") return { ok: false, error: "must be an object" };
  const o = v as Record<string, unknown>;
  if (o.kind === "once" || o.kind === "daily") {
    if (typeof o.at !== "string" || !HHMM.test(o.at)) return { ok: false, error: "at must be HH:MM (24h)" };
    return { ok: true, value: { kind: o.kind, at: o.at } };
  }
  if (o.kind === "every") {
    const n = Number(o.n);
    if (o.unit === "m" && (EVERY_MINUTES as readonly number[]).includes(n)) return { ok: true, value: { kind: "every", n, unit: "m" } };
    if (o.unit === "h" && (EVERY_HOURS as readonly number[]).includes(n)) return { ok: true, value: { kind: "every", n, unit: "h" } };
    return { ok: false, error: `every: n phút ∈ ${EVERY_MINUTES.join(",")} hoặc n giờ ∈ ${EVERY_HOURS.join(",")}` };
  }
  return { ok: false, error: "kind must be once, daily or every" };
}

/** 5-field cron in the session's local time, and whether it recurs. */
export function cronOf(s: Schedule): { cron: string; recurring: boolean } {
  if (s.kind === "every") {
    // Minute 7 for hourly steps: off the hour, so it does not stack with other :00 jobs.
    return s.unit === "m" ? { cron: `*/${s.n} * * * *`, recurring: true } : { cron: `7 ${s.n === 1 ? "*" : `*/${s.n}`} * * *`, recurring: true };
  }
  const [h, m] = s.at.split(":").map(Number);
  return { cron: `${m} ${h} * * *`, recurring: s.kind === "daily" };
}

/** Short Vietnamese label for the task list and toasts. */
export function scheduleLabel(s: Schedule): string {
  if (s.kind === "once") return `lúc ${s.at}`;
  if (s.kind === "daily") return `hằng ngày ${s.at}`;
  // Recurring runs get jitter (docs: up to half the gap, ≤30 min late; only */5 is exact).
  return `${s.n === 5 && s.unit === "m" ? "" : "≈"}mỗi ${s.n} ${s.unit === "m" ? "phút" : "giờ"}`;
}

/** Lets `8sync ccc hook wake` (UserPromptSubmit) skip a fire while the session is busy, at zero tokens. */
export const WAKE_MARK = "[8sync:wake]";

/** The prompt HQ delivers instead of the task itself. */
export function scheduledPrompt(task: string, s: Schedule): string {
  const { cron, recurring } = cronOf(s);
  return [
    `Lên lịch, KHÔNG làm ngay: gọi CronCreate với cron "${cron}" (giờ máy local), recurring: ${recurring}, prompt là nguyên văn phần dưới dòng ---. Xong trả lời một dòng: job id + lần chạy kế (${scheduleLabel(s)}).`,
    recurring ? "Lịch lặp tự hết hạn sau 7 ngày (giới hạn của Claude Code); không tự tạo lại, owner sẽ giao lại nếu cần." : "Một lần, tự xoá sau khi chạy.",
    "Giữ nguyên dấu [8sync:wake] ở đầu prompt (hook của kit dùng nó để bỏ qua lượt khi phiên đang bận). Tới giờ mà việc không còn ý nghĩa: nói một dòng lý do rồi bỏ qua lượt đó.",
    "---",
    `${WAKE_MARK} ${task}`,
  ].join("\n");
}

/**
 * Preset "R&D trực": the R&D room never sits idle — it studies the codebase, the web, papers and
 * GitHub trending, then hands concrete work to the rooms that are free. Owner (2026-10-15): "R&D
 * nghiên cứu codebase, internet, học thuật… rồi giao task tất cả session (phòng ban)".
 */
export const RD_DUTY = {
  subject: "R&D trực: nghiên cứu rồi giao việc cho phòng rảnh",
  details: [
    "Nếu phòng đang có việc dở: bỏ qua lượt này.",
    "1. Backlog: item kế trong su-code/STATE.md Next, dòng `failure:` trong su-code/KNOWLEDGE.md chưa có ghi chú, hoặc dòng còn trống cột 'Có ích cho 8sync vì' trong su-code/research/trending/<hôm nay>.md (chưa có file hôm nay → chạy `8sync learn trending` một lần).",
    "2. Nghiên cứu (≤5 lần search, nguồn primary, ghi ngày/phiên bản): codebase (`codegraph query`), internet (WebSearch/WebFetch), học thuật (arXiv / Semantic Scholar, trích DOI hoặc arXiv id). Ghi su-code/research/<slug>.md: kết luận trước, bằng chứng, việc đề xuất.",
    "3. Giao việc: `8sync ccc . ls` xem phòng nào rảnh (không có task in_progress); gửi ≤2 task cụ thể (file/lệnh kiểm/tiêu chí) cho phòng khớp tên bằng SendMessage, ghi 'từ R&D trực, theo research/<slug>.md'. Việc không khớp phòng nào → HQ Giao việc (POST /api/tasks) hoặc ghi vào STATE.md Next.",
    "Repo đáng học (có licence) → đề xuất lệnh `8sync skill learn <owner/repo>` trong STATE.md Next cho owner chạy; KHÔNG tự cài (skill cài vào ~/.claude/skills được nạp toàn cục, cần người duyệt).",
    "Không còn item: nói 'rest: hết backlog' một dòng. Không sửa code sản phẩm; không tự merge/push/deploy.",
  ].join("\n"),
  schedule: { kind: "every", n: 30, unit: "m" } as const satisfies Schedule,
};
