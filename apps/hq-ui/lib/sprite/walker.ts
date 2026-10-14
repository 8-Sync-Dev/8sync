// A specialist walking between rooms: 12x18 code-drawn pixel art, PixelSpec-style (a palette
// of single characters + rows; the idea comes from agent-sprite-forge, MIT; the art is ours).
// Two frames per step, drawn facing right; facing left is a mirror. Tested in tests/office.test.ts.

export const WALKER_W = 12;
export const WALKER_H = 18;

/** '.' transparent · o outline · s skin · h hair · c shirt (role colour) · p pants · b shoes. */
export const WALKER_PALETTE: Record<string, string | null> = {
  ".": null,
  o: "oklch(0.13 0.01 260)",
  s: "oklch(0.82 0.07 60)",
  h: "oklch(0.36 0.04 50)",
  c: "oklch(0.8 0.2 134)",
  p: "oklch(0.32 0.03 260)",
  b: "oklch(0.2 0.01 260)",
};

const HEAD = [
  "...oooo.....",
  "..ohhhho....",
  "..ohhhhho...",
  "..ohsssso...",
  "..osso.so...",
  "..ossssso...",
  "...osssoo...",
];
const BODY = [
  "..occcccco..",
  ".occcccccco.",
  ".osccccccso.",
  ".oscccccco..",
  "..occcccco..",
  "..oppppppo..",
];
const LEGS_A = [
  "..oppo.opo..",
  ".opo...opo..",
  ".obbo..obbo.",
  "..oo....oo..",
  "............",
];
const LEGS_B = [
  "...oppppo...",
  "...opo.po...",
  "...obbobbo..",
  "....oo.oo...",
  "............",
];

export const WALKER_FRAMES: string[][] = [
  [...HEAD, ...BODY, ...LEGS_A],
  [...HEAD, ...BODY, ...LEGS_B],
];

/** Draw one frame at integer `scale` (nearest neighbour), optionally mirrored. */
export function drawWalker(
  ctx: CanvasRenderingContext2D,
  frame: number,
  shirt: string,
  scale: number,
  mirror = false,
): void {
  const rows = WALKER_FRAMES[frame % WALKER_FRAMES.length];
  ctx.clearRect(0, 0, WALKER_W * scale, WALKER_H * scale);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = ch === "c" ? shirt : WALKER_PALETTE[ch];
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect((mirror ? WALKER_W - 1 - x : x) * scale, y * scale, scale, scale);
    });
  });
}
