import { describe, expect, it } from "vitest";
import { flipAnchor, flipMoves, type FlipBox } from "@/lib/flip";

const ROW = 72;
const rows = (...keys: string[]): FlipBox[] => keys.map((key, i) => ({ key, top: 4 + i * ROW, height: ROW }));

describe("flipMoves", () => {
  it("slides the row that rose to the top up from where it was; the rows it passed shift down one slot", () => {
    const { moves, entered } = flipMoves(rows("a", "b", "c", "d"), rows("d", "a", "b", "c"));
    expect(entered).toEqual([]);
    expect(moves).toEqual([
      { key: "d", dy: 3 * ROW, rose: true },
      { key: "a", dy: -ROW, rose: false },
      { key: "b", dy: -ROW, rose: false },
      { key: "c", dy: -ROW, rose: false },
    ]);
  });

  it("names new rows, leaves still rows alone and counts a swap of neighbours as no rise", () => {
    const { moves, entered } = flipMoves(rows("a", "b", "c"), rows("n", "a", "c", "b"));
    expect(entered).toEqual(["n"]);
    // c keeps its slot (index 2): no move.
    expect(moves).toEqual([
      { key: "a", dy: -ROW, rose: false },
      { key: "b", dy: -2 * ROW, rose: false },
    ]);
    expect(flipMoves(rows("a", "b"), rows("a", "b")).moves).toEqual([]);
  });

  it("adds the scroll shift: a row that kept its place on screen does not move", () => {
    const { moves } = flipMoves(rows("a", "b", "c", "d"), rows("d", "a", "b", "c"), ROW);
    expect(moves.find((m) => m.key === "b")).toBeUndefined();
    expect(moves.find((m) => m.key === "d")).toEqual({ key: "d", dy: 4 * ROW, rose: true });
  });
});

describe("flipAnchor", () => {
  it("does nothing at the top of the list: the new top row slides in where the reader looks", () => {
    expect(flipAnchor(rows("a", "b", "c"), rows("c", "a", "b"), 0)).toBe(0);
  });

  it("keeps the first row on screen still for a reader scrolled down", () => {
    // Scrolled to row b (index 1): d jumps to the top, b moves down one slot, so does the view.
    expect(flipAnchor(rows("a", "b", "c", "d"), rows("d", "a", "b", "c"), ROW + 10)).toBe(ROW);
  });

  it("never anchors on the row that jumped or one that is gone", () => {
    // The first row on screen is d itself (it jumps from 3 to 0): the next one, e, anchors.
    expect(flipAnchor(rows("a", "b", "c", "d", "e"), rows("d", "a", "b", "c", "e"), 3 * ROW + 10)).toBe(0);
    expect(flipAnchor(rows("a", "b", "c"), rows("a", "c"), ROW + 10)).toBe(-ROW);
  });
});
