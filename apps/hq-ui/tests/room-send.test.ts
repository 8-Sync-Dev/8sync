import { describe, expect, it } from "vitest";
import { askText, containRect, imageRoom, pinLine, pinPx, pinRadius, pointToPin, roomGroups } from "@/lib/room-send";

const room = (label: string, root: string | null, o: { tokens?: number | null; role?: string | null; delivery?: "terminal" | "inbox" | null; cwd?: string } = {}) => ({
  key: `k-${label}`,
  name: `hq-${label}`,
  label,
  cwd: o.cwd ?? root,
  project: root ? { root, name: root.split("/").pop()!, branch: "main" } : null,
  delivery: o.delivery === undefined ? ("terminal" as const) : o.delivery,
  role: o.role ?? null,
  tokens: o.tokens === undefined ? 40_000 : o.tokens,
});

describe("room groups", () => {
  it("groups only rooms a message can reach", () => {
    const g = roomGroups([room("dev", "/w/shop"), room("ghost", "/w/shop", { delivery: null }), room("ops", "/w/tools")]);
    expect(g.map((x) => [x.root, x.rooms.map((r) => r.label)])).toEqual([
      ["/w/shop", ["dev"]],
      ["/w/tools", ["ops"]],
    ]);
  });
});

describe("image room", () => {
  it("a worktree image goes to the room working in that worktree, else nobody is picked", () => {
    const rooms = [room("lead", "/w/shop"), room("wt", "/w/shop/.claude/worktrees/wt-9")];
    expect(imageRoom({ root: "/w/shop/.claude/worktrees/wt-9", worktree: "wt-9" }, rooms)?.label).toBe("wt");
    expect(imageRoom({ root: "/w/shop", worktree: null }, rooms)).toBeNull();
  });
});

describe("pin math", () => {
  const img = { w: 1600, h: 900 };
  it("finds the letterboxed image inside the box", () => {
    expect(containRect({ w: 800, h: 800 }, img)).toEqual({ x: 0, y: 175, w: 800, h: 450 });
  });

  it("maps a point to image fractions and pixels; letterbox is null", () => {
    const p = pointToPin({ x: 200, y: 175 + 225 }, { w: 800, h: 800 }, img)!;
    expect(p).toEqual({ fx: 0.25, fy: 0.5 });
    expect(pinPx(p, img)).toEqual({ x: 400, y: 450 });
    expect(pointToPin({ x: 200, y: 100 }, { w: 800, h: 800 }, img)).toBeNull();
  });

  it("scales the marker with the image, within 12..72 px", () => {
    expect(pinRadius({ w: 1600, h: 900 })).toBe(27);
    expect(pinRadius({ w: 120, h: 80 })).toBe(12);
    expect(pinRadius({ w: 8000, h: 6000 })).toBe(72);
  });
});

describe("message text", () => {
  const img = { w: 1280, h: 720 };
  it("one pin line with %, px and the comment", () => {
    expect(pinLine(2, { fx: 0.125, fy: 0.4, note: "  nút   lệch " }, img)).toBe("#2 (12.5%, 40.0%; 160 px, 288 px): nút lệch");
    expect(pinLine(1, { fx: 1, fy: 0, note: "" }, img)).toBe("#1 (100.0%, 0.0%; 1280 px, 0 px)");
  });

  it("carries the path, every pin and the question", () => {
    const t = askText({ path: "C:\\w\\shop\\qa\\evidence\\card-7-home.png", img, question: "Sao lệch?", pins: [{ fx: 0.5, fy: 0.5, note: "đây" }, { fx: 0.1, fy: 0.9, note: "" }] });
    expect(t).toBe(
      [
        "Về ảnh: C:\\w\\shop\\qa\\evidence\\card-7-home.png",
        "Ghim (bản có đánh số ở file đính kèm; ảnh 1280×720 px):",
        "#1 (50.0%, 50.0%; 640 px, 360 px): đây",
        "#2 (10.0%, 90.0%; 128 px, 648 px)",
        "",
        "Sao lệch?",
      ].join("\n"),
    );
    expect(askText({ path: "/a.png", img: null, question: " ", pins: [] })).toBe("Về ảnh: /a.png\n\nXem ảnh này và xử lý.");
  });
});
