// Canvas renderer for the code-drawn sprites. Browser only (call from effects).
// One shared requestAnimationFrame loop drives every sprite at ~7 fps, and it
// stops while the tab is hidden or when a sprite is offscreen.
import { SPRITES, SPRITE_SIZE, paletteFor, type SpriteState } from "./frames";

export const SPRITE_FPS = 7;

export type SpriteHandle = {
  setState(state: SpriteState): void;
  dispose(): void;
};

type Player = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  palette: Record<string, string | null>;
  scale: number;
  state: SpriteState;
  frame: number;
  visible: boolean;
  step(): void;
};

const players = new Set<Player>();
let raf = 0;
let last = 0;
let hooked = false;

function draw(p: Player) {
  const rows = SPRITES[p.state];
  const f = rows[p.frame % rows.length];
  const { ctx, scale: k } = p;
  ctx.clearRect(0, 0, SPRITE_SIZE * k, SPRITE_SIZE * k);
  let cur = "";
  for (let y = 0; y < SPRITE_SIZE; y++) {
    const row = f[y];
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const color = p.palette[row[x]];
      if (!color) continue;
      if (color !== cur) ctx.fillStyle = cur = color;
      ctx.fillRect(x * k, y * k, k, k);
    }
  }
}

function loop(t: number) {
  raf = 0;
  if (document.hidden || players.size === 0) return;
  if (t - last >= 1000 / SPRITE_FPS) {
    last = t;
    for (const p of players) if (p.visible) p.step();
  }
  raf = requestAnimationFrame(loop);
}

function ensureLoop() {
  if (!hooked) {
    hooked = true;
    document.addEventListener("visibilitychange", ensureLoop);
  }
  if (!raf && !document.hidden && players.size > 0) raf = requestAnimationFrame(loop);
}

/**
 * `size` is the CSS pixel width/height. The backing store uses an integer
 * scale (floor(size * dpr / 32), min 1) so pixels stay crisp.
 */
export function mountSprite(
  canvas: HTMLCanvasElement,
  opts: { state: SpriteState; shirtKey: string; size?: number },
): SpriteHandle {
  const ctx = canvas.getContext("2d");
  const size = opts.size ?? 96;
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor((size * dpr) / SPRITE_SIZE));
  canvas.width = canvas.height = SPRITE_SIZE * scale;
  canvas.style.width = canvas.style.height = `${size}px`;
  canvas.style.imageRendering = "pixelated";
  if (!ctx) return { setState() {}, dispose() {} };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const p: Player = {
    canvas,
    ctx,
    palette: paletteFor(opts.shirtKey),
    scale,
    state: opts.state,
    frame: 0,
    visible: true,
    step() {
      this.frame++;
      // "done" cheers once, then the character sits down again.
      if (this.state === "done" && this.frame >= SPRITES.done.length) {
        this.state = "idle";
        this.frame = 0;
      }
      draw(this);
    },
  };
  draw(p);

  let io: IntersectionObserver | null = null;
  if (!reduced) {
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((es) => {
        p.visible = es[es.length - 1]?.isIntersecting ?? true;
      });
      io.observe(canvas);
    }
    players.add(p);
    ensureLoop();
  }

  return {
    setState(state) {
      if (state === p.state && !(state === "done" && p.frame === 0)) return;
      p.state = state;
      p.frame = 0;
      draw(p);
    },
    dispose() {
      players.delete(p);
      io?.disconnect();
    },
  };
}
