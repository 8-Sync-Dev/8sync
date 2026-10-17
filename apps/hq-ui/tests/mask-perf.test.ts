import { describe, expect, it } from "vitest";
import { activityFrom } from "@/lib/server/activity";

describe("room log stays fast on huge blocks", () => {
  it("a 300 KB reply with one long word renders within a second", () => {
    const word = "a".repeat(300_000);
    const line = JSON.stringify({ type: "assistant", timestamp: "2026-10-17T16:00:00Z", message: { role: "assistant", content: [{ type: "text", text: `start ${word} end` }] } });
    const t0 = performance.now();
    const ev = activityFrom([line]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(ev).toHaveLength(1);
    expect(ev[0].text!.length).toBeLessThanOrEqual(400);
  });
});
