// Code-drawn 32x32 pixel art: every frame is 32 strings of 32 palette chars.
// No image files. Frames are composed on demand from small stamps and memoised.
// Clips with per-frame durations, role props and a blink variant follow the PixelSpec
// ideas of agent-sprite-forge (MIT; ideas only, the art and code are ours).
import type { SeatKey } from "../office";

export const SPRITE_SIZE = 32;

export const SPRITE_STATES = ["idle", "typing", "running", "reading", "waiting", "stalled", "done", "meeting"] as const;
export type SpriteState = (typeof SPRITE_STATES)[number];

/**
 * Every clip a desk sprite can play: the session states, "rest" (empty seat, screen off), "away"
 * (the chair is empty: its person is in the sprint meeting; desk props stay) and
 * the two one-shot transitions "stand" (rise from the chair before work) / "sit" (back to idle).
 */
export const CLIPS = [...SPRITE_STATES, "rest", "away", "stand", "sit"] as const;
export type Clip = (typeof CLIPS)[number];

/** '.' is transparent. 'c' (shirt) is per role / session, see shirtOf(). */
export const PALETTE: Record<string, string | null> = {
  ".": null,
  o: "oklch(0.13 0.01 260)", // outline
  s: "oklch(0.82 0.07 60)", // skin
  h: "oklch(0.36 0.04 50)", // hair
  c: "oklch(0.8 0.2 134)", // shirt (overridden per role / session)
  d: "oklch(0.5 0.05 60)", // desk
  m: "oklch(0.55 0.01 260)", // monitor body / keyboard
  k: "oklch(0.2 0.02 260)", // screen off
  g: "oklch(0.9 0.08 210)", // screen glow
  t: "oklch(0.82 0.19 150)", // terminal green
  w: "oklch(0.98 0 0)", // bubble white / paper
  r: "oklch(0.6 0.22 27)", // alert red
  y: "oklch(0.85 0.15 90)", // confetti / spark
  b: "oklch(0.55 0.15 255)", // book blue
  n: "oklch(0.45 0.08 45)", // wood brown
  e: "oklch(0.78 0.13 80)", // brass
  l: "oklch(0.85 0.06 220)", // lens
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

/** A specialist wears its role colour in every room, so "the blue one" always means R&D. */
export const ROLE_SHIRT: Record<SeatKey, string> = {
  lead: SHIRTS[0],
  rd: SHIRTS[1],
  plan: SHIRTS[4],
  dev: SHIRTS[5],
  review: SHIRTS[2],
  qa: SHIRTS[3],
  quick: SHIRTS[7],
  critic: SHIRTS[6],
};

/** The lead is the session itself: its shirt follows the session (same as its chat avatar). */
export function shirtOf(role: SeatKey, sessionKey: string): string {
  return role === "lead" ? shirtFor(sessionKey) : ROLE_SHIRT[role];
}

export function paletteFor(shirt: string): Record<string, string | null> {
  return { ...PALETTE, c: shirt };
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
  chair?: boolean; // the chair back shows beside the torso (person has risen off it)
};

/**
 * Role props. `desk` sits left of the person (x 0..5, resting on the desk top at y 21);
 * `head` is worn and follows the head's y (breath, jumps), drawn under the eyes; `face`
 * (glasses) goes over the eyes. Raised arms stay on top of desk props.
 */
type Prop = { desk?: [number, number, string[]]; head?: (g: G, hy: number) => void; face?: (g: G, hy: number) => void };

export const PROPS: Record<SeatKey, Prop> = {
  // headset + mug
  lead: {
    desk: [1, 17, ["oooo ", "owwoo", "owwo o", "owwoo", "oooo "]],
    head: (g, hy) => {
      rect(g, 8, hy - 1, 6, 1, "m");
      px(g, 7, hy, "m");
      px(g, 14, hy, "m");
      rect(g, 6, hy + 1, 1, 4, "m");
      rect(g, 15, hy + 1, 1, 4, "m");
      px(g, 15, hy + 5, "m");
      px(g, 14, hy + 6, "m");
      px(g, 13, hy + 6, "r");
    },
  },
  // magnifier over a book
  rd: { desk: [0, 14, [" oo   ", "ollo  ", "ollo  ", " oon  ", "    n ", "oooooo", "bbbbbb", "wwwwwb"]] },
  // clipboard with a checklist
  plan: { desk: [0, 13, [" mmm ", "nmmmn", "nwwwn", "nooon", "nwwwn", "nowon", "nwwwn", "nooon", "nnnnn"]] },
  // a second laptop with code
  dev: { desk: [0, 16, ["oooooo", "ottkko", "okttto", "otkkko", "oooooo", "mmmmmm"]] },
  // red-rimmed glasses + red pen on a sheet
  review: {
    desk: [0, 17, ["    w ", "   r  ", "  r   ", " o    ", "wwwwww"]],
    face: (g, hy) => stamp(g, 8, hy + 4, ["oloolo"]),
  },
  // a ladybug on the desk
  qa: { desk: [0, 16, [" o  o ", "  oo  ", "orrrro", " roor ", "orrrro", " rrrr "]] },
  // lightning bolt
  quick: { desk: [1, 15, ["  yy", " yy ", "yyyy", " yy ", "yy  ", "y   "]] },
  // brass scales
  critic: { desk: [0, 14, ["  e  ", "eeeee", "e e e", "e e e", "nnenn", "  e  ", "  e  ", " eee "]] },
};

/** Sprint board on the wall where the monitor stands: 3 columns of tiny cards (todo / doing / done). */
function board(g: G, moved: boolean) {
  rect(g, 19, 5, 13, 14, "o");
  rect(g, 20, 6, 11, 12, "w");
  rect(g, 20, 8, 11, 1, "o"); // header rule under the title
  stamp(g, 21, 6, ["o o o o o"]); // "sprint" title: dashes, too small for letters
  for (const x of [23, 27]) rect(g, x, 9, 1, 9, "m"); // column rules
  const cards: [number, number, string][] = [
    [21, 10, "y"],
    [21, 13, "y"],
    [25, 10, "b"],
    [29, 10, "t"],
    [29, 13, "t"],
  ];
  // one card moves from todo to doing when the meeting "decides"
  cards.push(moved ? [25, 13, "b"] : [21, 16, "y"]);
  for (const [x, y, c] of cards) rect(g, x, y, 2, 2, c);
}

function scene(screenOff = false, noMonitor = false): G {
  const g = blank();
  if (!noMonitor) {
    // monitor
    rect(g, 20, 8, 11, 11, "o");
    rect(g, 21, 9, 9, 9, "m");
    rect(g, 22, 10, 7, 7, "k");
    rect(g, 24, 19, 3, 2, "m");
    rect(g, 23, 21, 5, 1, "m");
    if (screenOff) px(g, 29, 17, "t"); // standby light
  }
  // desk
  rect(g, 0, 22, 32, 1, "o");
  rect(g, 0, 23, 32, 3, "d");
  rect(g, 0, 26, 32, 1, "o");
  rect(g, 2, 27, 2, 4, "d");
  rect(g, 28, 27, 2, 4, "d");
  return g;
}

function person(g: G, p: Pose, prop?: Prop) {
  const hy = p.hy ?? 8;
  const ty = p.torsoTop ?? hy + 8;
  // chair back behind the torso, 1 px wider on each side so it shows once the person rises
  if (p.chair) {
    rect(g, 4, 15, 14, 7, "o");
    rect(g, 5, 16, 12, 6, "n");
  }
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
  prop?.head?.(g, hy);
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
  prop?.face?.(g, hy);
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

/** Small speech bubble (top left, clear of the board) with 1..3 dots: someone is talking. */
function dots(g: G, n: number) {
  rect(g, 0, 1, 11, 6, "o");
  rect(g, 1, 2, 9, 4, "w");
  px(g, 8, 7, "o");
  for (let k = 0; k < n; k++) px(g, 3 + k * 2, 4, "o");
}

/**
 * Rising from the chair, frame 0..2: head and torso go up 1 px per frame (3 px in all), the
 * hands leave the keyboard for the sides on frame 1, and the chair back shows throughout.
 */
const risePose = (i: number): Pose => ({
  hy: 7 - i,
  torsoTop: 15 - i,
  chair: true,
  hands: i === 0 ? [[13, 20], [17, 20]] : [[4, 18 - i], [16, 18 - i]],
});

type Spec = {
  ms: number[];
  pose: (i: number) => Pose;
  deco?: (g: G, i: number) => void;
  off?: boolean;
  loop?: boolean;
  /** No monitor in the scene (the clip draws a wall board instead). */
  noMonitor?: boolean;
  /** Nobody at the desk (the clip draws the empty chair itself). */
  noPerson?: boolean;
};

const idleScreen = (g: G) => lines(g, "g", [3, 2]);
const typeHands = (i: number): [number, number][] => (i % 2 ? [[13, 21], [17, 20]] : [[13, 20], [17, 21]]);

/** Each clip: per-frame durations (ms) + how to pose / decorate frame i. */
const SPECS: Record<Clip, Spec> = {
  // breath: the head and torso sink 1 px on the exhale
  idle: { ms: [900, 700], pose: (i) => (i ? { hy: 9, torsoTop: 17 } : {}), deco: idleScreen },
  typing: {
    ms: [130, 110, 140, 120],
    pose: (i) => ({ hands: typeHands(i), eyes: "open" }),
    deco: (g, i) => lines(g, "g", [2 + i, 1 + (i % 3), i]),
  },
  running: {
    ms: [150, 150, 150],
    pose: (i) => ({ hands: typeHands(i === 1 ? 1 : 0) }),
    deco: (g, i) => {
      // terminal glow: halo around the monitor + scrolling green lines
      for (let y = 9; y <= 17; y++) {
        px(g, 19, y, "g");
        px(g, 31, y, "g");
      }
      rect(g, 21, 7, 9, 1, "g");
      lines(g, "t", [5 - i, 3, 4 + (i % 2)], 10 + i);
      px(g, 23, 16, "t");
    },
  },
  reading: {
    ms: [800, 600],
    pose: (i) => ({ eyes: i ? "shift" : "open", hands: [[13, 21], [17, 21]] }),
    deco: (g, i) => {
      lines(g, "g", [5, 4, 5]);
      rect(g, 22, i ? 14 : 12, 7, 1, "t"); // scan line
    },
  },
  waiting: {
    ms: [450, 450],
    pose: (i) => ({ armUp: [[4 - i, 10]], hands: [[17, 20], [17, 20]] }),
    deco: (g) => {
      bubble(g, "?", 0);
      lines(g, "g", [2]);
    },
  },
  stalled: {
    ms: [700, 500],
    pose: () => ({ hy: 11, eyes: "closed", hands: [[13, 21], [17, 21]] }),
    deco: (g, i) => {
      bubble(g, "!", i);
      lines(g, "r", [4, 2]);
    },
  },
  // flash (2 frames: white screen + burst, then a wider ring) and one cheer; plays once
  done: {
    ms: [110, 130, 900],
    loop: false,
    pose: (i) => ({ hy: i === 2 ? 7 : 8, armUp: i === 1 ? [[3, 8], [18, 8]] : [[4, 9], [16, 9]], hands: [[13, 20], [17, 20]] }),
    deco: (g, i) => {
      if (i === 0) {
        rect(g, 22, 10, 7, 7, "w");
        for (const [x, y] of [[25, 6], [25, 5], [18, 13], [17, 13], [31, 6], [19, 6]] as const) px(g, x, y, "y");
        return;
      }
      stamp(g, 23, 12, ["     t", "    t ", "t  t  ", " tt   "]);
      if (i === 1) {
        for (const [x, y] of [[25, 3], [18, 5], [31, 4], [16, 10]] as const) px(g, x, y, "w");
        return;
      }
      for (const [n, [x, y]] of ([[3, 2], [14, 3], [27, 4], [6, 4], [30, 2]] as const).entries()) px(g, x, y, n % 2 ? "y" : "c");
    },
  },
  // sprint meeting: turned to the board (eyes shift), hands off the keyboard, a point at the
  // board on frame 1, a card moves to "doing" on frame 2 while the speech dots build up
  meeting: {
    ms: [600, 650, 550],
    noMonitor: true,
    pose: (i) => ({ eyes: "shift", hands: i === 1 ? [[13, 21]] : [[13, 21], [17, 21]], armUp: i === 1 ? [[17, 11]] : [] }),
    deco: (g, i) => {
      board(g, i === 2);
      dots(g, i + 1);
    },
  },
  // the person is away (sprint meeting): screen off, the empty chair back where the torso was
  away: {
    ms: [1400, 1100],
    off: true,
    noPerson: true,
    pose: () => ({}),
    deco: (g) => {
      rect(g, 4, 15, 14, 7, "o");
      rect(g, 5, 16, 12, 6, "n");
    },
  },
  // empty seat: screen off, settled lower, slow breath
  rest: { ms: [1400, 1100], off: true, pose: (i) => ({ hy: 9 + i, torsoTop: 17 + i, hands: [[13, 21], [16, 21]] }) },
  // transitions (one-shot): rise before work, sit back down before idle; render.ts chains them
  stand: { ms: [140, 130, 150], loop: false, pose: risePose, deco: idleScreen },
  sit: { ms: [150, 130, 140], loop: false, pose: (i) => risePose(2 - i), deco: idleScreen },
};

/** Per-frame durations of a clip; same length as its frame list. */
export const CLIP_MS = {} as Record<Clip, readonly number[]>;
for (const c of CLIPS) CLIP_MS[c] = SPECS[c].ms;

/** Clips that play once and then hand over (done/sit -> idle, stand -> the clip it was started for). */
export const ONE_SHOT: ReadonlySet<Clip> = new Set(CLIPS.filter((c) => SPECS[c].loop === false));

/** Clips where a blink makes sense (eyes are open in the pose). */
export const BLINKS: ReadonlySet<Clip> = new Set(["idle", "typing", "running", "reading", "waiting", "meeting", "rest"]);

const built = new Map<string, string[]>();

/** Frame `i` of `clip` for a role (null = no prop), optionally with the eyes shut. Memoised. */
export function spriteFrame(role: SeatKey | null, clip: Clip, i: number, blink = false): string[] {
  const spec = SPECS[clip];
  const f = ((i % spec.ms.length) + spec.ms.length) % spec.ms.length;
  const key = `${role}|${clip}|${f}|${blink ? 1 : 0}`;
  const hit = built.get(key);
  if (hit) return hit;
  const g = scene(spec.off, spec.noMonitor);
  spec.deco?.(g, f);
  const prop = role ? PROPS[role] : undefined;
  if (prop?.desk) stamp(g, prop.desk[0], prop.desk[1], prop.desk[2]);
  if (!spec.noPerson) {
    const pose = spec.pose(f);
    person(g, blink ? { ...pose, eyes: "closed" } : pose, prop);
  }
  const rows = g.map((r) => r.join(""));
  built.set(key, rows);
  return rows;
}

/** Role-neutral frames of every session state (kept for the floor view and tests). */
export const SPRITES: Record<SpriteState, string[][]> = Object.fromEntries(
  SPRITE_STATES.map((s) => [s, SPECS[s].ms.map((_, i) => spriteFrame(null, s, i))]),
) as Record<SpriteState, string[][]>;
