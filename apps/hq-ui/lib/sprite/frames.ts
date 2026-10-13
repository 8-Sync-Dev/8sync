// Code-drawn 32x32 pixel art: every frame is 32 strings of 32 palette chars.
// No image files. Frames are composed once at module load from small stamps.

export const SPRITE_SIZE = 32;

export const SPRITE_STATES = ["idle", "typing", "running", "reading", "waiting", "stalled", "done"] as const;
export type SpriteState = (typeof SPRITE_STATES)[number];

/** '.' is transparent. 'c' (shirt) is per session, see shirtFor(). */
export const PALETTE: Record<string, string | null> = {
  ".": null,
  o: "oklch(0.13 0.01 260)", // outline
  s: "oklch(0.82 0.07 60)", // skin
  h: "oklch(0.36 0.04 50)", // hair
  c: "oklch(0.8 0.2 134)", // shirt (overridden per session)
  d: "oklch(0.5 0.05 60)", // desk
  m: "oklch(0.55 0.01 260)", // monitor body / keyboard
  k: "oklch(0.2 0.02 260)", // screen off
  g: "oklch(0.9 0.08 210)", // screen glow
  t: "oklch(0.82 0.19 150)", // terminal green
  w: "oklch(0.98 0 0)", // bubble white
  r: "oklch(0.6 0.22 27)", // alert red
  y: "oklch(0.85 0.15 90)", // confetti
};

/** Fixed set of shirt colors, distinct from the backdrop; first is 8 Sync lime. */
export const SHIRTS = [
  "oklch(0.8 0.2 134)",
  "oklch(0.72 0.14 240)",
  "oklch(0.75 0.15 30)",
  "oklch(0.74 0.14 320)",
  "oklch(0.82 0.13 85)",
  "oklch(0.72 0.12 190)",
  "oklch(0.68 0.16 285)",
  "oklch(0.9 0.02 260)",
] as const;

export function shirtFor(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return SHIRTS[(h >>> 0) % SHIRTS.length];
}

export function paletteFor(name: string): Record<string, string | null> {
  return { ...PALETTE, c: shirtFor(name) };
}

type G = string[][];
const blank = (): G => Array.from({ length: SPRITE_SIZE }, () => Array<string>(SPRITE_SIZE).fill("."));
const px = (g: G, x: number, y: number, c: string) => {
  if (x >= 0 && x < SPRITE_SIZE && y >= 0 && y < SPRITE_SIZE) g[y][x] = c;
};
const rect = (g: G, x: number, y: number, w: number, h: number, c: string) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(g, x + i, y + j, c);
};
/** Stamp rows; ' ' is skipped. */
const stamp = (g: G, x: number, y: number, rows: string[]) =>
  rows.forEach((r, j) => [...r].forEach((c, i) => c !== " " && px(g, x + i, y + j, c)));

type Eyes = "open" | "shift" | "closed";
type Pose = {
  hy?: number; // head top
  torsoTop?: number;
  eyes?: Eyes;
  hands?: [number, number][]; // 2x2 skin hands on the keyboard
  armUp?: [number, number][]; // [x, y] of raised hands (2 wide, drawn down to the shoulder)
};

function scene(): G {
  const g = blank();
  // monitor
  rect(g, 20, 8, 11, 11, "o");
  rect(g, 21, 9, 9, 9, "m");
  rect(g, 22, 10, 7, 7, "k");
  rect(g, 24, 19, 3, 2, "m");
  rect(g, 23, 21, 5, 1, "m");
  // desk
  rect(g, 0, 22, 32, 1, "o");
  rect(g, 0, 23, 32, 3, "d");
  rect(g, 0, 26, 32, 1, "o");
  rect(g, 2, 27, 2, 4, "d");
  rect(g, 28, 27, 2, 4, "d");
  return g;
}

function person(g: G, p: Pose = {}) {
  const hy = p.hy ?? 8;
  const ty = p.torsoTop ?? hy + 8;
  // torso (x 6..15) down to the desk
  for (let y = ty; y <= 21; y++) {
    const edge = y === ty;
    stamp(g, 6, y, [edge ? ".oooooooo." : "occccccccco".replace("cc", "c")]);
  }
  // head x 7..14
  stamp(g, 7, hy, [
    ".oooooo.",
    "ohhhhhho",
    "ohhhhhho",
    "osssssso",
    "osssssso",
    "osssssso",
    ".osssso.",
    "..oooo..",
  ]);
  const e = p.eyes ?? "open";
  if (e === "open") {
    px(g, 9, hy + 4, "o");
    px(g, 12, hy + 4, "o");
  } else if (e === "shift") {
    px(g, 10, hy + 4, "o");
    px(g, 13, hy + 4, "o");
  } else {
    rect(g, 9, hy + 5, 2, 1, "o");
    rect(g, 12, hy + 5, 2, 1, "o");
  }
  // keyboard in front of the torso, hands on it
  rect(g, 12, 21, 8, 1, "m");
  for (const [x, y] of p.hands ?? [[13, 20], [17, 20]]) rect(g, x, y, 2, 2, "s");
  // raised arms: sleeve from shoulder up to a skin hand
  for (const [x, y] of p.armUp ?? []) {
    const left = x < 10;
    const sx = left ? 4 : 16;
    rect(g, Math.min(sx, x), y + 3, 2, Math.max(1, ty + 2 - (y + 3)), "c");
    rect(g, x, y, 2, 3, "s");
  }
}

const lines = (g: G, c: string, lens: number[], y0 = 11) =>
  lens.forEach((n, i) => rect(g, 22 + 1, y0 + i * 2, Math.min(5, Math.max(0, n)), 1, c));

function bubble(g: G, kind: "?" | "!", dy: number) {
  const fill = kind === "!" ? "r" : "w";
  const ink = kind === "!" ? "w" : "o";
  rect(g, 18, dy, 11, 7, "o");
  rect(g, 19, dy + 1, 9, 5, fill);
  px(g, 19, dy + 7, "o");
  const glyph = kind === "?" ? ["ooo", "..o", ".oo", "...", ".o."] : [".o.", ".o.", ".o.", "...", ".o."];
  glyph.forEach((r, j) => [...r].forEach((c, i) => c === "o" && px(g, 22 + i, dy + 1 + j, ink)));
}

const out = (g: G) => g.map((r) => r.join(""));
function frame(pose: Pose, deco?: (g: G) => void): string[] {
  const g = scene();
  deco?.(g);
  person(g, pose);
  return out(g);
}

const idleScreen = (g: G) => lines(g, "g", [3, 2]);

export const SPRITES: Record<SpriteState, string[][]> = {
  idle: [
    frame({}, idleScreen),
    frame({ hy: 9, torsoTop: 17 }, idleScreen),
  ],
  typing: [0, 1, 2, 3].map((i) =>
    frame(
      { hands: i % 2 ? [[13, 21], [17, 20]] : [[13, 20], [17, 21]], eyes: "open" },
      (g) => lines(g, "g", [2 + i, 1 + (i % 3), i]),
    ),
  ),
  running: [0, 1, 2].map((i) =>
    frame({ hands: i === 1 ? [[13, 21], [17, 20]] : [[13, 20], [17, 21]] }, (g) => {
      // terminal glow: halo around the monitor + scrolling green lines
      for (let y = 9; y <= 17; y++) {
        px(g, 19, y, "g");
        px(g, 31, y, "g");
      }
      rect(g, 21, 7, 9, 1, "g");
      lines(g, "t", [5 - i, 3, 4 + (i % 2)], 10 + i);
      px(g, 23, 16, "t");
    }),
  ),
  reading: [0, 1].map((i) =>
    frame({ eyes: i ? "shift" : "open", hands: [[13, 21], [17, 21]] }, (g) => {
      lines(g, "g", [5, 4, 5]);
      rect(g, 22, i ? 14 : 12, 7, 1, "t"); // scan line
    }),
  ),
  waiting: [0, 1].map((i) =>
    frame({ armUp: [[4 - i, 10]], hands: [[17, 20], [17, 20]] }, (g) => {
      bubble(g, "?", 0);
      lines(g, "g", [2]);
    }),
  ),
  stalled: [0, 1].map((i) =>
    frame({ hy: 11, eyes: "closed", hands: [[13, 21], [17, 21]] }, (g) => {
      bubble(g, "!", i);
      lines(g, "r", [4, 2]);
    }),
  ),
  done: [0, 1, 2].map((i) =>
    frame(
      { hy: i === 2 ? 7 : 8, armUp: i === 1 ? [[3, 8], [18, 8]] : [[4, 9], [16, 9]], hands: [[13, 20], [17, 20]] },
      (g) => {
        // check mark on the screen + confetti
        stamp(g, 23, 12, ["     t", "    t ", "t  t  ", " tt   "]);
        const spots: [number, number][][] = [
          [[3, 2], [14, 3], [27, 4]],
          [[6, 4], [11, 1], [30, 2]],
          [[2, 5], [16, 2], [24, 3]],
        ];
        spots[i].forEach(([x, y], n) => px(g, x, y, n % 2 ? "y" : "c"));
      },
    ),
  ),
};
