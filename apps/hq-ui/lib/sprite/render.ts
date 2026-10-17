// Canvas renderer for the code-drawn sprites. Browser only (call from effects).
// ONE shared requestAnimationFrame loop drives every desk sprite and walker with
// per-frame durations; a canvas is only redrawn when its frame changes, by blitting a
// frame pre-rendered once (cache by role/clip/frame/blink/shirt). The loop stops while
// the tab is hidden; offscreen sprites are skipped; reduced motion draws frame 0 only.
import type { SeatKey } from "../office";
import { BLINKS, CLIP_MS, ONE_SHOT, PALETTE, SPRITE_SIZE, spriteFrame, type Clip } from "./frames";
import { blinker, frameAt, memo, phaseOf } from "./anim";
import {
  DUST_MS,
  WALK_MS,
  WALKER_CARRY,
  WALKER_CARRY_DUST,
  WALKER_CARRY_STAND,
  WALKER_DUST,
  WALKER_FRAMES,
  WALKER_H,
  WALKER_PALETTE,
  WALKER_STAND,
  WALKER_W,
  mirror,
} from "./walker";

/** The loop wakes at most this often; the shortest frame is 110 ms. */
const TICK_MS = 33;

type Ticker = { visible: boolean; tick(now: number): void };

const tickers = new Set<Ticker>();
let raf = 0;
let last = 0;
let hooked = false;

function loop(t: number) {
  raf = 0;
  if (document.hidden || tickers.size === 0) return;
  if (t - last >= TICK_MS) {
    last = t;
    for (const p of tickers) if (p.visible) p.tick(t);
  }
  raf = requestAnimationFrame(loop);
}

function ensureLoop() {
  if (!hooked) {
    hooked = true;
    document.addEventListener("visibilitychange", ensureLoop);
  }
  if (!raf && !document.hidden && tickers.size > 0) raf = requestAnimationFrame(loop);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Paint palette rows once into a 1x canvas; every later draw is a single drawImage. */
function paint(rows: string[], w: number, h: number, palette: Record<string, string | null>, shirt: string) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  let cur = "";
  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const color = ch === "c" ? shirt : palette[ch];
      if (!color) continue;
      if (color !== cur) ctx.fillStyle = cur = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

const deskCache = memo((key: string) => {
  const [role, clip, i, blink, shirt] = key.split("|");
  const rows = spriteFrame(role === "" ? null : (role as SeatKey), clip as Clip, Number(i), blink === "1");
  return paint(rows, SPRITE_SIZE, SPRITE_SIZE, PALETTE, shirt);
});

const WALKER_SETS = {
  plain: { walk: WALKER_FRAMES, dust: WALKER_DUST, stand: WALKER_STAND },
  carry: { walk: WALKER_CARRY, dust: WALKER_CARRY_DUST, stand: WALKER_CARRY_STAND },
} as const;

const walkerCache = memo((key: string) => {
  const [set, kind, i, shirt, dir] = key.split("|");
  const s = WALKER_SETS[set === "carry" ? "carry" : "plain"];
  const rows = kind === "dust" ? s.dust[Number(i)] : kind === "stand" ? s.stand : s.walk[Number(i)];
  return paint(dir === "left" ? mirror(rows) : rows, WALKER_W, WALKER_H, WALKER_PALETTE, shirt);
});

function blit(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, w: number, h: number) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
}

/** Integer backing scale for crisp pixels: floor(css * dpr / art), at least 1. */
function backing(canvas: HTMLCanvasElement, artW: number, artH: number, cssW: number) {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.floor((cssW * dpr) / artW));
  canvas.width = artW * k;
  canvas.height = artH * k;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${(cssW * artH) / artW}px`;
  canvas.style.imageRendering = "pixelated";
}

function watch(canvas: HTMLCanvasElement, t: Ticker) {
  if (typeof IntersectionObserver === "undefined") return null;
  const io = new IntersectionObserver((es) => {
    t.visible = es[es.length - 1]?.isIntersecting ?? true;
  });
  io.observe(canvas);
  return io;
}

export type SpriteHandle = {
  /** `after`: for a one-shot ("done"), the clip it hands over to instead of idle. */
  setState(clip: Clip, after?: Clip): void;
  dispose(): void;
};

/** Clips where the person is up at the desk working; reached from a seated clip via "stand". */
const WORKING: ReadonlySet<Clip> = new Set<Clip>(["typing", "running", "reading", "meeting", "waiting"]);
/** Clips where the person sits (idle, dozing, cheering, slumped); leaving them for work plays "stand". */
const SEATED: ReadonlySet<Clip> = new Set<Clip>(["idle", "rest", "done", "stalled"]);

/** The transition to play before `next`, if any: stand up for work, sit down for a seated clip. */
export function transitionFor(from: Clip, next: Clip): Clip | null {
  if (SEATED.has(from) && WORKING.has(next)) return "stand";
  if (WORKING.has(from) && SEATED.has(next)) return "sit";
  return null;
}

/**
 * A desk sprite. `size` is the CSS width/height; `seed` (e.g. room:seat) offsets its loop
 * phase and blink timing so a room never moves in lockstep; `shirt` is its colour.
 */
export function mountSprite(
  canvas: HTMLCanvasElement,
  opts: { state: Clip; role: SeatKey | null; shirt: string; seed: string; size?: number },
): SpriteHandle {
  backing(canvas, SPRITE_SIZE, SPRITE_SIZE, opts.size ?? 96);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { setState() {}, dispose() {} };
  const reduced = reducedMotion();
  const role = opts.role ?? "";
  const blinkAt = blinker(opts.seed, performance.now());
  let clip = opts.state;
  /** What a one-shot hands over to when it ends (stand -> the work clip); null = idle. */
  let then: Clip | null = null;
  /** Where a one-shot settles once it is over (setState's `after`); null = idle. */
  let settle: Clip | null = null;
  let t0 = performance.now();
  let shown = "";

  const draw = (key: string) => {
    if (key === shown) return;
    shown = key;
    blit(ctx, deskCache.get(key), canvas.width, canvas.height);
  };
  const keyOf = (i: number, blink: boolean) => `${role}|${clip}|${i}|${blink ? 1 : 0}|${opts.shirt}`;

  const p: Ticker = {
    visible: true,
    tick(now) {
      const ms = CLIP_MS[clip];
      const once = ONE_SHOT.has(clip);
      let i = frameAt(ms, now - t0 + (once ? 0 : phaseOf(opts.seed, ms)), { loop: !once });
      if (i < 0) {
        // A one-shot is over: "stand"/"sit" hand over to the clip they were played for,
        // "done" (cheer) to its `after` clip, else idle.
        if (then) {
          clip = then;
          then = null;
        } else {
          clip = settle ?? "idle";
          settle = null;
        }
        t0 = now;
        i = ONE_SHOT.has(clip) ? 0 : frameAt(CLIP_MS[clip], phaseOf(opts.seed, CLIP_MS[clip]));
      }
      draw(keyOf(i, BLINKS.has(clip) && blinkAt(now)));
    },
  };
  draw(keyOf(0, false));
  /** The state the sprite is in or heading to (a transition counts as its target). */
  const target = () => then ?? clip;

  let io: IntersectionObserver | null = null;
  if (!reduced) {
    io = watch(canvas, p);
    tickers.add(p);
    ensureLoop();
  }

  return {
    setState(next, after) {
      if (next === target() && next !== "done") return;
      // Reduced motion: no transition and no one-shot, just the static frame of the state it lands in.
      if (reduced && ONE_SHOT.has(next) && after) next = after;
      const via = reduced ? null : transitionFor(target(), next);
      clip = via ?? next;
      then = via ? next : null;
      settle = ONE_SHOT.has(next) ? (after ?? null) : null;
      t0 = performance.now();
      if (reduced) draw(keyOf(0, false));
      else p.tick(t0);
    },
    dispose() {
      tickers.delete(p);
      io?.disconnect();
    },
  };
}

/** The walk-in lasts as long as the CSS slide (hq-walk-in). */
export const WALK_IN_MS = 1600;

/**
 * A specialist walking into a room: 4-frame walk for WALK_IN_MS, a dust puff on arrival,
 * then it stands and leaves the loop. `carry`: holding a task paper (bringing work in).
 * Reduced motion: stands from the start.
 */
export function mountWalker(canvas: HTMLCanvasElement, opts: { shirt: string; carry?: boolean; size?: number; dir?: "right" | "left" }): () => void {
  backing(canvas, WALKER_W, WALKER_H, opts.size ?? WALKER_W * 2);
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  let shown = "";
  const set = opts.carry ? "carry" : "plain";
  const dir = opts.dir ?? "right";
  const draw = (key: string) => {
    if (key === shown) return;
    shown = key;
    blit(ctx, walkerCache.get(`${set}|${key}|${opts.shirt}|${dir}`), canvas.width, canvas.height);
  };
  if (reducedMotion()) {
    draw("stand|0");
    return () => {};
  }
  draw("walk|0");
  const t0 = performance.now();
  const p: Ticker = {
    visible: true,
    tick(now) {
      const t = now - t0;
      if (t < WALK_IN_MS) return draw(`walk|${frameAt(WALK_MS, t)}`);
      const d = frameAt(DUST_MS, t - WALK_IN_MS, { loop: false });
      if (d >= 0) return draw(`dust|${d}`);
      draw("stand|0");
      tickers.delete(p);
    },
  };
  const io = watch(canvas, p);
  tickers.add(p);
  ensureLoop();
  return () => {
    tickers.delete(p);
    io?.disconnect();
  };
}
