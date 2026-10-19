import { describe, expect, it } from "vitest";
import { limitsView, timeLeft } from "@/lib/office";

const NOW = Date.UTC(2026, 9, 19, 6, 0, 0);
const s = (ms: number) => Math.floor(ms / 1000);

describe("plan usage meter", () => {
  it("counts down to the reset like Orca's bar", () => {
    expect(timeLeft(s(NOW + (4 * 60 + 11) * 60_000), NOW)).toBe("4h 11m");
    expect(timeLeft(s(NOW + 38 * 60_000), NOW)).toBe("38m");
    expect(timeLeft(s(NOW + (2 * 24 + 3) * 3_600_000), NOW)).toBe("2d 3h");
    expect(timeLeft(s(NOW - 60_000), NOW)).toBeNull();
    expect(timeLeft(null, NOW)).toBeNull();
  });

  it("shows 5h then 7d, clamps the percentage, and empties a window whose reset passed", () => {
    const v = limitsView(
      { five_hour_pct: 101.6, five_hour_resets_at: s(NOW + 90 * 60_000), seven_day_pct: 18.4, seven_day_resets_at: s(NOW - 1000), ts: s(NOW) },
      NOW,
    );
    expect(v.map((w) => [w.label, w.pct, w.left])).toEqual([
      ["5h", 100, "1h 30m"],
      ["7d", 0, null],
    ]);
    expect(limitsView({ five_hour_pct: null, five_hour_resets_at: null, seven_day_pct: 7, seven_day_resets_at: null, ts: null }, NOW)).toEqual([
      { label: "7d", pct: 7, left: null, reset: null },
    ]);
    expect(limitsView(null, NOW)).toEqual([]);
  });
});
