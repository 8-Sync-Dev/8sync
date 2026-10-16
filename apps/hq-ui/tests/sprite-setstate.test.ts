// mountSprite.setState over time (lib/sprite/render.ts). sprite.test.ts / sprite-pipeline.test.ts
// cover transitionFor() as a table; this drives a real desk sprite: a fake canvas, a manual clock
// and a hand-run requestAnimationFrame queue feed the shared loop, and each blit is read back from
// the desk-cache key `role|clip|frame|blink|shirt` (memo is wrapped so paint() still runs).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIP_MS, type Clip } from "@/lib/sprite/frames";
import { totalMs } from "@/lib/sprite/anim";

vi.mock("@/lib/sprite/anim", async (importOriginal) => {
  const a = await importOriginal<typeof import("@/lib/sprite/anim")>();
  // Same build-once cache; each cached value also carries its key, so a blit says what it drew.
  return { ...a, memo: (build: (key: string) => unknown) => a.memo((key) => ({ key, img: build(key) })) };
});

type Drawn = { clip: Clip; frame: number };

let now = 0;
let queue: FrameRequestCallback[] = [];
let reduced = false;
let mountSprite: typeof import("@/lib/sprite/render").mountSprite;

function fakeCanvas() {
  const drawn: Drawn[] = [];
  const ctx = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    fillRect() {},
    clearRect() {},
    drawImage(img: { key: string }) {
      const [, clip, frame] = img.key.split("|");
      drawn.push({ clip: clip as Clip, frame: Number(frame) });
    },
  };
  return { width: 0, height: 0, style: {} as Record<string, string>, getContext: () => ctx, drawn };
}

/** Run the clock forward in 16 ms display frames, firing queued rAF callbacks like a browser. */
function advance(ms: number) {
  const end = now + ms;
  while (now < end) {
    now = Math.min(end, now + 16);
    const due = queue;
    queue = [];
    for (const cb of due) cb(now);
  }
}

/** Collapse consecutive repeats: [idle, idle, stand, typing, typing] -> [idle, stand, typing]. */
const runs = <T,>(xs: T[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

function mount(state: Clip) {
  const canvas = fakeCanvas();
  const h = mountSprite(canvas as unknown as HTMLCanvasElement, { state, role: null, shirt: "#123", seed: "room:alpha" });
  const { drawn } = canvas;
  return { h, drawn, last: () => drawn[drawn.length - 1], clips: () => runs(drawn.map((d) => d.clip)) };
}

const STAND = totalMs(CLIP_MS.stand);
const SIT = totalMs(CLIP_MS.sit);
const DONE = totalMs(CLIP_MS.done);

beforeEach(async () => {
  now = 1000;
  queue = [];
  reduced = false;
  vi.stubGlobal("document", { hidden: false, addEventListener() {}, createElement: () => fakeCanvas() });
  vi.stubGlobal("window", { devicePixelRatio: 1, matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queue.push(cb));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  // The rAF loop keeps module state (ticker set, pending frame, last tick): fresh module per test.
  vi.resetModules();
  ({ mountSprite } = await import("@/lib/sprite/render"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mountSprite.setState over time", () => {
  it("idle -> typing stands up first, plays every stand frame in order, then hands over to typing", () => {
    const s = mount("idle");
    advance(500);
    s.h.setState("typing");
    expect(s.last()).toEqual({ clip: "stand", frame: 0 });
    advance(STAND - 50);
    expect(s.last().clip).toBe("stand");
    advance(150);
    expect(s.last().clip).toBe("typing");
    expect(s.clips()).toEqual(["idle", "stand", "typing"]);
    expect(runs(s.drawn.filter((d) => d.clip === "stand").map((d) => d.frame))).toEqual(CLIP_MS.stand.map((_, i) => i));
  });

  it("typing -> idle sits down first, then hands over to idle", () => {
    const s = mount("typing");
    advance(300);
    s.h.setState("idle");
    expect(s.last()).toEqual({ clip: "sit", frame: 0 });
    advance(SIT - 50);
    expect(s.last().clip).toBe("sit");
    advance(150);
    expect(s.last().clip).toBe("idle");
    expect(s.clips()).toEqual(["typing", "sit", "idle"]);
  });

  it("asking again for the state it is already heading to does not skip or restart the transition", () => {
    const s = mount("idle");
    s.h.setState("typing");
    advance(STAND / 2);
    s.h.setState("typing");
    expect(s.last().clip).toBe("stand");
    // Still on the first stand-up's clock: typing arrives STAND after the first call, not later.
    advance(STAND / 2 + 150);
    expect(s.last().clip).toBe("typing");
    expect(s.clips()).toEqual(["idle", "stand", "typing"]);
  });

  it("changing target mid-transition sits back down from the target, then settles", () => {
    const s = mount("idle");
    s.h.setState("typing");
    advance(STAND / 2);
    s.h.setState("idle");
    expect(s.last()).toEqual({ clip: "sit", frame: 0 });
    advance(SIT + 150);
    expect(s.clips()).toEqual(["idle", "stand", "sit", "idle"]);
  });

  it("done is a one-shot cheer: a second done restarts it, and it hands over to idle", () => {
    const s = mount("idle");
    s.h.setState("done");
    expect(s.last()).toEqual({ clip: "done", frame: 0 });
    advance(DONE / 2);
    expect(s.last().frame).toBeGreaterThan(0);
    s.h.setState("done");
    expect(s.last()).toEqual({ clip: "done", frame: 0 });
    advance(DONE - 50);
    expect(s.last().clip).toBe("done");
    advance(150);
    expect(s.last().clip).toBe("idle");
  });

  it("reduced motion: no loop, no transition, the new state's frame 0 at once", () => {
    reduced = true;
    const s = mount("idle");
    expect(queue).toHaveLength(0);
    s.h.setState("typing");
    expect(s.last()).toEqual({ clip: "typing", frame: 0 });
    const n = s.drawn.length;
    advance(2000);
    expect(s.drawn).toHaveLength(n);
    expect(s.clips()).toEqual(["idle", "typing"]);
  });

  it("dispose stops drawing and lets the shared loop stop", () => {
    const s = mount("typing");
    advance(400);
    expect(s.drawn.length).toBeGreaterThan(1);
    s.h.dispose();
    const n = s.drawn.length;
    advance(2000);
    expect(s.drawn).toHaveLength(n);
    expect(queue).toHaveLength(0);
  });
});
