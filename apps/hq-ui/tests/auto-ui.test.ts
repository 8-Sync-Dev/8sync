import { describe, expect, it } from "vitest";
import { autoButton, autoText, criticNote, leaseMs, shouldAutoStart, staleText } from "@/lib/auto";
import { parseBinaryVersion, uiVersion } from "@/lib/server/version";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("stale UI notice", () => {
  it("says so only when both versions are known and differ", () => {
    expect(staleText({ on: false, paused: false })).toBeNull();
    expect(staleText({ on: false, paused: false, versions: { ui: "0.94.0", binary: "0.94.0" } })).toBeNull();
    expect(staleText({ on: false, paused: false, versions: { ui: null, binary: "0.94.0" } })).toBeNull(); // dev checkout
    expect(staleText({ on: false, paused: false, versions: { ui: "0.93.3", binary: null } })).toBeNull(); // no 8sync on PATH
    expect(staleText({ on: true, paused: false, versions: { ui: "0.93.3", binary: "0.94.0" } })).toBe(
      "HQ đang chạy giao diện 0.93.3, 8sync đã là 0.94.0 — Ctrl-C ở terminal `8sync hq ui` rồi chạy lại để lấy giao diện mới",
    );
  });
  it("parses `8sync --version` and the installed VERSION file, rejecting junk", () => {
    expect(parseBinaryVersion("8sync 0.94.0\n")).toBe("0.94.0");
    expect(parseBinaryVersion("8sync v0.94.0-rc1")).toBe("0.94.0-rc1");
    expect(parseBinaryVersion("")).toBeNull();
    expect(parseBinaryVersion("command not found")).toBeNull();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "hq-ver-"));
    const app = path.join(base, "hq-ui");
    fs.mkdirSync(app);
    expect(uiVersion(app)).toBeNull(); // no VERSION next to the app = dev checkout
    fs.writeFileSync(path.join(base, "VERSION"), "0.93.3\n");
    expect(uiVersion(app)).toBe("0.93.3");
    fs.writeFileSync(path.join(base, "VERSION"), "garbage");
    expect(uiVersion(app)).toBeNull();
    fs.rmSync(base, { recursive: true, force: true });
  });
});

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
    expect(autoText({ on: true, paused: false, company: true })).toBe("Luôn chạy · Công ty: một team, mọi dự án");
    expect(autoText({ on: false, paused: false, error: "HTTP 401" })).toBe("Không đọc được trạng thái auto: HTTP 401");
    expect(autoText({ on: false, paused: false, error: "không rõ `auto`" })).toBe("8sync chưa có lệnh auto — chạy 8sync up");
  });
  it("texts and button", () => {
    expect(autoText({ on: true, paused: false, lease_until: 1_800_000_000 })).toMatch(/^Luôn chạy · lease tới \d\d:\d\d$/);
    expect(autoText({ on: true, paused: false })).toBe("Luôn chạy");
    // CI held by GitHub billing: the header says so (once per poll, no extra fetch); ok/failing stay quiet.
    expect(autoText({ on: true, paused: false, ci: "billing" })).toBe("Luôn chạy · CI dừng: GitHub billing (Settings → Billing)");
    expect(autoText({ on: true, paused: false, ci: "failing" })).toBe("Luôn chạy");
    expect(autoText({ on: true, paused: false, ci: "local" })).toBe("Luôn chạy · CI: máy release (GitHub chỉ lưu code)");
    expect(autoText({ on: false, paused: true })).toBe("Tạm dừng (owner)");
    expect(autoText({ on: false, paused: false, error: "usage: 8sync ccc" })).toBe("8sync chưa có lệnh auto — chạy 8sync up");
    expect(autoButton({ on: true, paused: false })).toEqual({ label: "Tạm dừng", action: "pause" });
    expect(autoButton({ on: false, paused: true })).toEqual({ label: "Chạy liên tục", action: "on" });
    expect(autoButton({ on: false, paused: false, error: "e" })).toBeNull();
  });
});

describe("critic note in Anh cần trả lời", () => {
  it("says why rooms wait on the owner while the critic is off (seen live 2026-10-18), silent while it runs", () => {
    expect(criticNote({ on: true, paused: false, delegate: true })).toBeNull();
    expect(criticNote({ on: true, paused: false })).toBeNull();
    expect(criticNote({ on: false, paused: true, delegate: false })).toMatch(/auto đang tạm dừng.*Chạy liên tục.*vẫn cần anh/);
    expect(criticNote({ on: false, paused: false })).toMatch(/auto đang tắt/);
    expect(criticNote({ on: true, paused: false, delegate: false })).toMatch(/critic đang tắt/);
    expect(criticNote({ on: false, paused: false, error: "x" })).toBeNull();
    expect(criticNote(null)).toBeNull();
  });
});
