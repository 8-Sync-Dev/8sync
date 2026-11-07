// UI audit 2026-11-07: the shared display helpers speak the owner's Vietnamese, not English.
import { describe, expect, it } from "vitest";
import { KIND_LABEL, stamp } from "@/components/hq/activity-view";
import { STATUS_LABEL, dayLabel, shortName } from "@/components/hq/bits";
import { loopStop, roomNameOf } from "@/lib/labels";
import { NOW_LABEL } from "@/lib/now";

describe("Vietnamese display helpers", () => {
  it("session states use the office words", () => {
    expect(STATUS_LABEL).toEqual({ running: "Đang làm", idle: "Rảnh", needs_input: "Chờ anh", ended: "Đã dừng" });
    expect(STATUS_LABEL.running).toBe(NOW_LABEL.working);
    expect(STATUS_LABEL.needs_input).toBe(NOW_LABEL.needs);
  });

  it("names: the owner is anh, no name is không rõ, hq- prefix and uuids shortened", () => {
    expect(shortName("owner")).toBe("anh");
    expect(shortName(null)).toBe("không rõ");
    expect(shortName("hq-core")).toBe("core");
    expect(shortName("c1f506dd-8ec8-4f8c-9abc-0123456789ab")).toBe("c1f506dd");
  });

  it("day separators: Hôm nay / Hôm qua / a date", () => {
    const now = new Date(2026, 10, 7, 15, 0).getTime();
    expect(dayLabel(new Date(2026, 10, 7, 0, 5).getTime(), now)).toBe("Hôm nay");
    expect(dayLabel(new Date(2026, 10, 6, 23, 59).getTime(), now)).toBe("Hôm qua");
    expect(dayLabel(new Date(2026, 10, 1, 9, 0).getTime(), now)).not.toMatch(/Today|Yesterday|Nov/);
  });

  it("activity log: dd/MM HH:mm:ss and Vietnamese kinds", () => {
    expect(stamp(new Date(2026, 10, 7, 9, 3, 4).getTime())).toBe("07/11 09:03:04");
    expect(Object.values(KIND_LABEL).join(" ")).not.toMatch(/message|reply|notification|start|end/i);
  });

  it("loop stop reasons in words, unknown ones kept raw", () => {
    expect(loopStop("done")).toBe("xong");
    expect(loopStop("no-change")).toBe("dừng: không còn thay đổi");
    expect(loopStop("max-iter")).toBe("dừng: hết lượt");
    expect(loopStop("weird")).toBe("dừng: weird");
  });

  it("messages name rooms, not raw omp ids", () => {
    const sessions = [{ label: "core", name: "omp-c1f506dd8ec8f8c5", session_id: "omp-c1f506dd8ec8f8c5", cwd: "C:\\r\\su-code" }];
    expect(roomNameOf(sessions, "omp-c1f506dd8ec8f8c5")).toBe("core · su-code");
    expect(roomNameOf(sessions, "omp-0000000000000000")).toBeNull();
    expect(roomNameOf(sessions, null)).toBeNull();
  });
});
