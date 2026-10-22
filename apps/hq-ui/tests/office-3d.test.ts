import { describe, expect, it } from "vitest";
import { DESK_GAP, FLOOR_PAD, MAX_COLS, STATE_COLOR, cameraDistance, layoutOffice } from "@/lib/office-3d";
import { NOW_STATES } from "@/lib/now";

const room = (i: number, state: "working" | "needs" | "idle" = "working") => ({ key: `r${i}`, label: `dev${i}`, state, role: "dev" });

describe("3D office layout (one floor per project, desks in a grid)", () => {
  it("gives every room a desk on its project's floor, rows of at most MAX_COLS, centred on the origin", () => {
    const l = layoutOffice([
      { project: { root: "C:/a", name: "a" }, rooms: Array.from({ length: 13 }, (_, i) => room(i)) },
      { project: { root: "C:/b", name: "b" }, rooms: [room(20, "needs")] },
    ]);
    expect(l.floors.map((f) => f.name)).toEqual(["a", "b"]);
    expect(l.desks).toHaveLength(14);
    const a = l.desks.filter((d) => d.root === "C:/a");
    const xs = new Set(a.map((d) => d.x.toFixed(3)));
    expect(xs.size).toBe(MAX_COLS);
    // floors do not overlap and the second sits further along z
    const [fa, fb] = l.floors;
    expect(fb.z - fb.d / 2).toBeGreaterThan(fa.z + fa.d / 2);
    // desks lie inside their floor plate
    for (const d of l.desks) {
      const f = l.floors.find((x) => x.root === d.root)!;
      expect(Math.abs(d.x - f.x)).toBeLessThanOrEqual(f.w / 2 - FLOOR_PAD + 1e-9);
      expect(Math.abs(d.z - f.z)).toBeLessThanOrEqual(f.d / 2 - FLOOR_PAD + 1e-9);
    }
    // centred: the floors' extent is symmetric around z = 0
    expect(fa.z - fa.d / 2).toBeCloseTo(-(fb.z + fb.d / 2), 6);
    expect(l.width).toBeCloseTo(MAX_COLS * DESK_GAP + FLOOR_PAD * 2, 6);
    expect(cameraDistance(l)).toBeGreaterThan(l.depth);
  });
  it("an empty project still gets a floor; every NowState has a colour", () => {
    const l = layoutOffice([{ project: { root: "/x", name: "x" }, rooms: [] }]);
    expect(l.floors).toHaveLength(1);
    expect(l.desks).toHaveLength(0);
    for (const s of NOW_STATES) expect(STATE_COLOR[s]).toBeTypeOf("number");
    expect(layoutOffice([])).toEqual({ floors: [], desks: [], width: 0, depth: 0 });
  });
});
