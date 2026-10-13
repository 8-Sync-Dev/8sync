import { describe, expect, it } from "vitest";
import { PALETTE, SHIRTS, SPRITES, SPRITE_SIZE, SPRITE_STATES, shirtFor } from "@/lib/sprite/frames";

describe("sprite data", () => {
  it("every state has frames", () => {
    for (const s of SPRITE_STATES) expect(SPRITES[s].length, s).toBeGreaterThanOrEqual(1);
    expect(SPRITES.idle.length).toBe(2);
    expect(SPRITES.typing.length).toBe(4);
    expect(SPRITES.running.length).toBe(3);
    expect(SPRITES.done.length).toBe(3);
  });
  it("every frame is 32 rows of 32 palette chars", () => {
    for (const s of SPRITE_STATES) {
      SPRITES[s].forEach((f, i) => {
        expect(f.length, `${s}#${i} rows`).toBe(SPRITE_SIZE);
        f.forEach((row, y) => {
          expect(row.length, `${s}#${i} row ${y}`).toBe(SPRITE_SIZE);
          for (const ch of row) expect(Object.hasOwn(PALETTE, ch), `${s}#${i} char ${ch}`).toBe(true);
        });
      });
    }
  });
  it("frames of a state differ (animation exists)", () => {
    for (const s of SPRITE_STATES) {
      if (SPRITES[s].length > 1) expect(new Set(SPRITES[s].map((f) => f.join())).size, s).toBeGreaterThan(1);
    }
  });
  it("shirt colors are stable, from the fixed set, and include 8 Sync lime", () => {
    expect(shirtFor("hq-a")).toBe(shirtFor("hq-a"));
    expect(SHIRTS).toContain("oklch(0.8 0.2 134)");
    expect(SHIRTS).toContain(shirtFor("anything"));
  });
});
