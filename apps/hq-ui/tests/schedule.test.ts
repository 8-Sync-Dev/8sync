import { describe, expect, it } from "vitest";
import { cronOf, parseSchedule, MEET_DAILY, RD_DUTY, scheduleLabel, scheduledPrompt } from "@/lib/schedule";

describe("schedule", () => {
  it("parses the four shapes and rejects the rest", () => {
    expect(parseSchedule(undefined)).toEqual({ ok: true, value: null });
    expect(parseSchedule("")).toEqual({ ok: true, value: null });
    expect(parseSchedule({ kind: "once", at: "15:42" })).toEqual({ ok: true, value: { kind: "once", at: "15:42" } });
    expect(parseSchedule({ kind: "daily", at: "09:03" }).ok).toBe(true);
    expect(parseSchedule({ kind: "every", n: "30", unit: "m" })).toEqual({ ok: true, value: { kind: "every", n: 30, unit: "m" } });
    for (const bad of [{ kind: "once", at: "24:00" }, { kind: "once", at: "9:3" }, { kind: "every", n: 7, unit: "m" }, { kind: "every", n: 5, unit: "h" }, { kind: "every", n: 1, unit: "s" }, { kind: "cron", cron: "* * * * *" }, "x", { kind: "every", n: 30.5, unit: "m" }, { kind: "every", n: null, unit: "m" }]) {
      expect(parseSchedule(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it("maps to local cron, recurring only for daily/every", () => {
    expect(cronOf({ kind: "once", at: "15:42" })).toEqual({ cron: "42 15 * * *", recurring: false });
    expect(cronOf({ kind: "daily", at: "09:03" })).toEqual({ cron: "3 9 * * *", recurring: true });
    expect(cronOf({ kind: "every", n: 15, unit: "m" })).toEqual({ cron: "*/15 * * * *", recurring: true });
    expect(cronOf({ kind: "every", n: 1, unit: "h" })).toEqual({ cron: "7 * * * *", recurring: true });
    expect(cronOf({ kind: "every", n: 6, unit: "h" })).toEqual({ cron: "7 */6 * * *", recurring: true });
  });
  it("prompt books CronCreate, keeps the 7-day bound and carries the task verbatim", () => {
    const p = scheduledPrompt("New task: x\nline2", { kind: "every", n: 30, unit: "m" });
    expect(p).toContain('CronCreate với cron "*/30 * * * *"');
    expect(p).toContain("recurring: true");
    expect(p).toContain("7 ngày");
    expect(p).toContain("không tự tạo lại");
    expect(p.endsWith("---\n[8sync:wake] New task: x\nline2")).toBe(true);
    expect(scheduledPrompt("t", { kind: "once", at: "08:05" })).toContain("recurring: false");
    expect(scheduleLabel({ kind: "every", n: 2, unit: "h" })).toBe("≈mỗi 2 giờ");
    expect(scheduleLabel({ kind: "every", n: 5, unit: "m" })).toBe("mỗi 5 phút");
    expect(RD_DUTY.schedule).toEqual({ kind: "every", n: 30, unit: "m" });
  });
  it("R&D duty studies code, web, papers and trending, then hands work to free rooms", () => {
    const d = RD_DUTY.details;
    for (const must of ["codegraph", "WebSearch", "arXiv", "8sync learn trending", "8sync skill learn", "KHÔNG tự cài", "8sync ccc . ls", "SendMessage", "≤2 task", "bỏ qua lượt này", "Không sửa code sản phẩm"]) {
      expect(d, must).toContain(must);
    }
    expect(d.length).toBeLessThanOrEqual(2000); // POST /api/tasks clamps details at 2000
    const p = scheduledPrompt(`New task: ${RD_DUTY.subject}\n${d}`, RD_DUTY.schedule);
    expect(p).toContain("[8sync:wake] New task: R&D trực");
  });
});

describe("MEET_DAILY preset", () => {
  it("daily 09:00, tells each room to report, take one open item, stop within 30 minutes", () => {
    expect(MEET_DAILY.schedule).toEqual({ kind: "daily", at: "09:00" });
    expect(parseSchedule(MEET_DAILY.schedule)).toEqual({ ok: true, value: MEET_DAILY.schedule });
    const d = MEET_DAILY.details;
    for (const must of ['8sync ccc meet --say "<done>|<doing>|<blocked>"', "≤100 ký tự", "bằng chứng", "8sync ccc meet --json", "MỘT việc", "30 phút", "rest"]) {
      expect(d, must).toContain(must);
    }
    expect(d.length).toBeLessThanOrEqual(2000);
    expect(MEET_DAILY.subject.length).toBeLessThanOrEqual(300);
    const p = scheduledPrompt(`New task: ${MEET_DAILY.subject}\n${d}`, MEET_DAILY.schedule);
    expect(p).toContain('CronCreate với cron "0 9 * * *"');
    expect(p).toContain("recurring: true");
  });
});
