// Regression (2026-10-23, owner: "ccc mở không xem được"): an interactive Claude Code session (open in
// the owner's own terminal window) was opened from HQ with `claude attach`, which said "No job
// matching"; HQ showed "Phiên đã tắt hẳn" and marked the live session ended.
import { describe, expect, it } from "vitest";
import { oneTapKind } from "@/components/hq/ask-panel";
import { endsWhenDead, interactiveHint, termGate } from "@/lib/interactive";

describe("interactive sessions: HQ never attaches, never ends them", () => {
  it("termGate refuses an interactive session with 409 and the hint, lets a background one through", () => {
    expect(termGate({ label: "core", interactive: true })).toEqual({
      ok: false,
      status: 409,
      error: "`core` là phiên mở tay trong cửa sổ terminal của anh, không chạy nền: trả lời ngay trong cửa sổ đó.",
    });
    expect(termGate({ label: "dev" })).toEqual({ ok: true });
    expect(termGate({ label: "dev", interactive: false })).toEqual({ ok: true });
  });

  it("a dead terminal ends a background room only", () => {
    expect(endsWhenDead({}, true)).toBe(true);
    expect(endsWhenDead({ interactive: false }, true)).toBe(true);
    expect(endsWhenDead({ interactive: true }, true)).toBe(false);
    expect(endsWhenDead({}, false)).toBe(false);
  });

  it("no one-tap answer for an interactive session (the answer goes through the terminal bridge)", () => {
    const r = { ask: null, waiting: "permission prompt", tmux: false, session_id: "1eb79553-8369-4a90-b428-2dedb50e18db" };
    expect(oneTapKind(r)).toBe("permission");
    expect(oneTapKind({ ...r, interactive: true })).toBeNull();
    expect(interactiveHint("core")).toContain("cửa sổ terminal của anh");
  });
});
