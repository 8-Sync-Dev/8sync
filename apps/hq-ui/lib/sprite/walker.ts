// A specialist walking between rooms: 12x18 code-drawn pixel art, PixelSpec-style (a palette
// of single characters + rows; the idea comes from agent-sprite-forge, MIT; the art is ours).
// Four frames per step, drawn facing right; drawn by the shared rAF loop in render.ts. Tested in tests/office.test.ts.

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
  u: "oklch(0.78 0.03 70)", // dust
  v: "oklch(0.55 0.02 70)", // cooled dust
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

/** Passing poses: legs together, head and body bob down 1 px (the feet stay on the ground line). */
const BLANK = "............";
const PASS_A = ["...oppo.....", "...obbo.....", "....oo......", BLANK];
const PASS_B = ["....oppo....", "....obbo....", ".....oo.....", BLANK];

/** Four-beat walk [contact-a, pass, contact-b, pass-2] at WALK_MS each (ASF walker idea). */
export const WALKER_FRAMES: string[][] = [
  [...HEAD, ...BODY, ...LEGS_A],
  [BLANK, ...HEAD, ...BODY, ...PASS_A],
  [...HEAD, ...BODY, ...LEGS_B],
  [BLANK, ...HEAD, ...BODY, ...PASS_B],
];
export const WALK_MS = [150, 150, 150, 150] as const;

/** Standing still after the walk. */
export const WALKER_STAND: string[] = WALKER_FRAMES[2];

const puff = (rows: string[], spots: [number, number, string][]) =>
  rows.map((r, y) => [...r].map((c, x) => spots.find(([sx, sy]) => sx === x && sy === y)?.[2] ?? c).join(""));

/** Arrival dust: two puffs at the feet that shrink and cool (no alpha fades in pixel art). */
export const WALKER_DUST: string[][] = [
  puff(WALKER_STAND, [[1, 16], [2, 16], [1, 15], [9, 16], [10, 16], [10, 15]].map(([x, y]) => [x, y, "u"] as [number, number, string])),
  puff(WALKER_STAND, [[0, 14], [11, 14]].map(([x, y]) => [x, y, "v"] as [number, number, string])),
];
export const DUST_MS = [120, 140] as const;
