// Pure animation timing (no DOM): clip frame lookup, seeded phase / blink, a build-once cache.
// The shared rAF loop in render.ts uses these. Tested in tests/sprite.test.ts.

/** FNV-1a 32-bit: a stable seed from a name. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const totalMs = (ms: readonly number[]) => ms.reduce((a, b) => a + b, 0);

/**
 * Frame index at `t` ms into a clip with per-frame durations. Looping clips wrap;
 * one-shot clips return -1 once they are over. Reduced motion: always frame 0.
 */
export function frameAt(ms: readonly number[], t: number, opts: { loop?: boolean; reduced?: boolean } = {}): number {
  if (opts.reduced || ms.length === 0) return 0;
  const total = totalMs(ms);
  if (total <= 0) return 0;
  let x = Math.max(0, t);
  if (opts.loop === false) {
    if (x >= total) return -1;
  } else x %= total;
  for (let i = 0; i < ms.length; i++) {
    if (x < ms[i]) return i;
    x -= ms[i];
  }
  return ms.length - 1;
}

/** Where in its loop a sprite starts, so seats in a room do not move in lockstep. */
export function phaseOf(seed: string, ms: readonly number[]): number {
  const total = totalMs(ms);
  return total > 0 ? hashSeed(seed) % total : 0;
}

export const BLINK_MS = 140;

/** A blink scheduler: eyes shut for BLINK_MS every 2.2-5.5 s, seeded per sprite. */
export function blinker(seed: string, start: number) {
  const r = rng(hashSeed(`blink:${seed}`));
  let at = start + 600 + r() * 4000;
  return (now: number): boolean => {
    while (now >= at + BLINK_MS) at += 2200 + r() * 3300;
    return now >= at;
  };
}

/** Build-once cache: the same key always returns the same value (e.g. a pre-rendered canvas). */
export function memo<V>(build: (key: string) => V) {
  const m = new Map<string, V>();
  return {
    get(key: string): V {
      let v = m.get(key);
      if (v === undefined) {
        v = build(key);
        m.set(key, v);
      }
      return v;
    },
    get size() {
      return m.size;
    },
  };
}
