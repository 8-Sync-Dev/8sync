import { describe, expect, it } from "vitest";
import { autoButton, autoText, leaseMs, shouldAutoStart } from "@/lib/auto";

describe("auto control model", () => {
  it("lease accepts unix seconds or ms", () => {
    expect(leaseMs(1_800_000_000)).toBe(1_800_000_000_000);
    expect(leaseMs(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(leaseMs(0)).toBeNull();
    expect(leaseMs(null)).toBeNull();
  });
  it("turns on by itself only when off, never paused, no error", () => {
    expect(shouldAutoStart({ on: false, paused: false })).toBe(true);
    expect(shouldAutoStart({ on: false, paused: true })).toBe(false);
    expect(shouldAutoStart({ on: true, paused: false })).toBe(false);
    expect(shouldAutoStart({ on: false, paused: false, error: "x" })).toBe(false);
    expect(shouldAutoStart({ on: false, paused: false, manual: true })).toBe(false); // hand-set idle/delegate
    expect(shouldAutoStart({ on: false, paused: false }, true)).toBe(false); // already tried this page load
  });
  it("an expired lease is shown and offered a fresh run, never re-armed by itself", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const s = { on: true, paused: false, gate: "lease hết hạn", lease_until: past };
    expect(autoText(s)).toBe("Lease hết hạn — bấm Chạy liên tục để gia hạn");
    expect(autoButton(s)).toEqual({ label: "Chạy liên tục", action: "on" });
    expect(shouldAutoStart(s)).toBe(false);
    expect(autoText({ on: true, paused: false, gate: "chạm trần $5/giờ", lease_until: past + 7200 })).toBe("Đang nghỉ: chạm trần $5/giờ");
    expect(autoText({ on: false, paused: false, manual: true })).toBe("Idle/delegate bật tay — Chạy liên tục sẽ ghi đè");
    expect(autoText({ on: false, paused: false, error: "HTTP 401" })).toBe("Không đọc được trạng thái auto: HTTP 401");
    expect(autoText({ on: false, paused: false, error: "không rõ `auto`" })).toBe("8sync chưa có lệnh auto — chạy 8sync up");
  });
  it("texts and button", () => {
    expect(autoText({ on: true, paused: false, lease_until: 1_800_000_000 })).toMatch(/^Luôn chạy · lease tới \d\d:\d\d$/);
    expect(autoText({ on: true, paused: false })).toBe("Luôn chạy");
    expect(autoText({ on: false, paused: true })).toBe("Tạm dừng (owner)");
    expect(autoText({ on: false, paused: false, error: "usage: 8sync ccc" })).toBe("8sync chưa có lệnh auto — chạy 8sync up");
    expect(autoButton({ on: true, paused: false })).toEqual({ label: "Tạm dừng", action: "pause" });
    expect(autoButton({ on: false, paused: true })).toEqual({ label: "Chạy liên tục", action: "on" });
    expect(autoButton({ on: false, paused: false, error: "e" })).toBeNull();
  });
});
