// Quality gates from the owner's sprite-pipeline skill (Generation Invariants + Quality Gates),
// applied to the code-drawn HQ sprites. The "manifest" is the exported CLIPS / SPRITE_STATES /
// CLIP_MS / ONE_SHOT / WALKER_CLIPS constants plus render.ts transitionFor(). Complements
// tests/sprite.test.ts and the walker gates in tests/office.test.ts (not repeated here).
import { describe, expect, it } from "vitest";
import { SEATS } from "@/lib/office";
import { BLINKS, CLIPS, CLIP_MS, ONE_SHOT, PALETTE, SPRITE_SIZE, SPRITE_STATES, spriteFrame, type Clip } from "@/lib/sprite/frames";
import { transitionFor } from "@/lib/sprite/render";
import { totalMs } from "@/lib/sprite/anim";
import {
  DUST_MS,
  WALKER_CARRY,
  WALKER_CARRY_DUST,
  WALKER_CARRY_STAND,
  WALKER_CLIPS,
  WALKER_DUST,
  WALKER_FRAMES,
  WALKER_H,
  WALKER_PALETTE,
  WALKER_STAND,
  WALKER_W,
  WALK_MS,
  mirror,
} from "@/lib/sprite/walker";

const ROLES = [null, ...SEATS.map((s) => s.key)] as const;
const frames = (role: (typeof ROLES)[number], c: Clip) => CLIP_MS[c].map((_, i) => spriteFrame(role, c, i));

/** The desk is fixed art: it starts at this row in every frame, the person sits above it. */
const DESK_TOP = 22;
const PERSON_CLIPS = CLIPS.filter((c) => c !== "away");

/** Person silhouette: hair/skin/shirt pixels in the body columns, above the desk. */
const sil = (f: string[]) => {
  const s = new Set<string>();
  f.slice(0, DESK_TOP).forEach((r, y) => [...r].forEach((ch, x) => x >= 4 && x <= 17 && "hsc".includes(ch) && s.add(`${x},${y}`)));
  return s;
};
const diff = (a: Set<string>, b: Set<string>) => [...a].filter((k) => !b.has(k)).length + [...b].filter((k) => !a.has(k)).length;
/** One pixel of breath = one row of head + torso moved = the smallest motion the art uses (measured: 24 cells). */
const ONE_PX_STEP = diff(sil(spriteFrame(null, "idle", 0)), sil(spriteFrame(null, "idle", 1)));
const headTop = (f: string[]) => f.findIndex((r) => r.slice(7, 15) === ".oooooo.");

describe("sprite-pipeline: generation invariants", () => {
  it("every pixel of every frame of every clip, for every role, is a PALETTE key on a 32x32 canvas", () => {
    for (const role of ROLES)
      for (const c of CLIPS)
        for (const blink of [false, true])
          CLIP_MS[c].forEach((_, i) => {
            const f = spriteFrame(role, c, i, blink);
            expect(f.length, `${role}/${c}#${i}`).toBe(SPRITE_SIZE);
            for (const row of f) {
              expect(row.length).toBe(SPRITE_SIZE);
              for (const ch of row) expect(Object.hasOwn(PALETTE, ch), `${role}/${c}#${i} '${ch}'`).toBe(true);
            }
          });
  });

  it("transparent background: the corners of the canvas stay '.' in every clip", () => {
    for (const c of CLIPS) for (const f of frames(null, c)) for (const [x, y] of [[31, 0], [0, 31], [31, 31], [15, 31]]) expect(f[y][x], `${c} ${x},${y}`).toBe(".");
  });

  it("no anchor drift: the desk is pixel-identical in every frame of every clip, per role (rows 23..31 exactly; row 22 only gains skin where a hand presses the edge)", () => {
    for (const role of ROLES) {
      const ref = spriteFrame(role, "idle", 0);
      for (const c of CLIPS)
        frames(role, c).forEach((f, i) => {
          expect(f.slice(DESK_TOP + 1), `${role}/${c}#${i}`).toEqual(ref.slice(DESK_TOP + 1));
          // typing/reading hands are 2x2 at y 20..21 or 21..22: the 2nd row lands on the desk outline (design, frames.ts typeHands)
          [...f[DESK_TOP]].forEach((ch, x) => ch !== ref[DESK_TOP][x] && expect(ch === "s" && x >= 13 && x <= 18, `${role}/${c}#${i} row 22 x${x}`).toBe(true));
        });
    }
  });

  it("no anchor drift: the person's contact row is the desk top - 1 (row 21) in every frame of every seated clip", () => {
    const lowest = (f: string[]) => f.slice(0, DESK_TOP).map((r, y) => ({ y, hit: /[hsc]/.test(r.slice(6, 16)) })).filter((r) => r.hit).pop()?.y;
    for (const role of ROLES) for (const c of PERSON_CLIPS) frames(role, c).forEach((f, i) => expect(lowest(f), `${role}/${c}#${i}`).toBe(DESK_TOP - 1));
  });

  it("no scale drift: the head is the same stamp in every person frame (same hair pixel count, only y moves)", () => {
    const count = (f: string[], ch: string) => f.join("").split(ch).length - 1;
    const ref = spriteFrame(null, "idle", 0);
    for (const c of PERSON_CLIPS)
      frames(null, c).forEach((f, i) => {
        expect(count(f, "h"), `${c}#${i} hair`).toBe(count(ref, "h"));
        expect(headTop(f), `${c}#${i} head found`).toBeGreaterThanOrEqual(0);
      });
  });
});

describe("sprite-pipeline: idle and transition frames connect", () => {
  it("stand starts and sit ends one breath-pixel from idle (no visible jump into/out of the seated pose)", () => {
    const idle0 = sil(spriteFrame(null, "idle", 0));
    const idle1 = sil(spriteFrame(null, "idle", 1));
    const near = (f: string[]) => Math.min(diff(sil(f), idle0), diff(sil(f), idle1));
    expect(ONE_PX_STEP).toBe(24); // measured: head+torso row shift of the breath
    expect(near(spriteFrame(null, "stand", 0))).toBeLessThanOrEqual(ONE_PX_STEP);
    expect(near(spriteFrame(null, "sit", 2))).toBeLessThanOrEqual(ONE_PX_STEP);
    expect(headTop(spriteFrame(null, "stand", 0))).toBe(headTop(spriteFrame(null, "idle", 0)) - 1);
  });

  it("consecutive frames inside stand / sit move the head exactly one px per step", () => {
    for (const c of ["stand", "sit"] as const) {
      const f = frames(null, c);
      for (let i = 1; i < f.length; i++) expect(Math.abs(headTop(f[i]) - headTop(f[i - 1])), `${c}#${i}`).toBe(1);
    }
  });

  it("handover: clips connect without a visible jump at any phase (skill gate: idle and transition frames connect)", () => {
    // render.ts resumes the next clip at a seed-dependent phase (and a direct switch too), so EVERY
    // frame of `next` must connect: a work clip starts exactly where "stand" ends (0 px), a seated
    // clip within one breath + 1 px of where "sit" ends, and a direct switch within 2 px.
    const STATES = PERSON_CLIPS.filter((c) => c !== "stand" && c !== "sit");
    const head = (c: Clip) => frames(null, c).map(headTop);
    const end = { stand: headTop(spriteFrame(null, "stand", 2)), sit: headTop(spriteFrame(null, "sit", 2)) };
    const start = { stand: headTop(spriteFrame(null, "stand", 0)), sit: headTop(spriteFrame(null, "sit", 0)) };
    for (const c of STATES)
      for (const n of STATES) {
        const via = transitionFor(c, n);
        if (via === "stand" || via === "sit") {
          for (const h of head(c)) expect(Math.abs(h - start[via]), `${c}->${via}`).toBeLessThanOrEqual(2);
          for (const h of head(n)) expect(Math.abs(h - end[via]), `${via}->${n}`).toBeLessThanOrEqual(via === "stand" ? 0 : 2);
        } else for (const a of head(c)) for (const b of head(n)) expect(Math.abs(a - b), `${c}->${n} direct`).toBeLessThanOrEqual(2);
      }
    // the chair back and torso top also carry over from stand#2 into every work frame
    const up = spriteFrame(null, "stand", 2);
    for (const w of ["typing", "running", "reading", "meeting", "waiting"] as const)
      for (const f of frames(null, w)) {
        expect(f[18][5], w).toBe(up[18][5]);
        expect(f[13].slice(6, 16), w).toBe(up[13].slice(6, 16));
      }
  });

  it("transitionFor() answers every ordered pair of clips with null or a one-shot clip that exists in CLIPS", () => {
    for (const from of CLIPS)
      for (const to of CLIPS) {
        const via = transitionFor(from, to);
        if (via === null) continue;
        expect(CLIPS as readonly string[], `${from}->${to}`).toContain(via);
        expect(ONE_SHOT.has(via), `${from}->${to}`).toBe(true);
      }
    for (const a of SPRITE_STATES) for (const b of SPRITE_STATES) expect(["stand", "sit", null]).toContain(transitionFor(a, b));
  });

  it("no ping-pong: a transition is never requested between a clip and itself", () => {
    for (const c of CLIPS) expect(transitionFor(c, c), c).toBeNull();
  });
});

describe("sprite-pipeline: manifest, preload and runtime names agree", () => {
  it("CLIP_MS has exactly the CLIPS keys; ONE_SHOT and BLINKS only name real clips", () => {
    expect(Object.keys(CLIP_MS).sort()).toEqual([...CLIPS].sort());
    for (const c of [...ONE_SHOT, ...BLINKS]) expect(CLIPS as readonly string[]).toContain(c);
    for (const s of SPRITE_STATES) expect(CLIPS as readonly string[]).toContain(s);
    expect(new Set(CLIPS).size).toBe(CLIPS.length);
  });
  it("one-shots are exactly done, stand, sit; the transitions never blink", () => {
    expect([...ONE_SHOT].sort()).toEqual(["done", "sit", "stand"]);
    for (const c of ["stand", "sit"] as const) expect(BLINKS.has(c), c).toBe(false);
  });
});

describe("sprite-pipeline: timing matches the gameplay event", () => {
  it("every frame lasts a finite positive integer of ms, under 1.5 s", () => {
    for (const c of CLIPS) for (const ms of CLIP_MS[c]) expect(Number.isInteger(ms) && ms > 0 && ms < 1500, `${c}`).toBe(true);
  });
  it("working loops cycle in <= 2 s; the slow breathing seat loops (rest, away) in <= 2.5 s", () => {
    // rest/away are 1400+1100 = 2500 ms by design (a slow breath of an empty seat), so they get their own ceiling.
    for (const c of CLIPS) {
      if (ONE_SHOT.has(c)) continue;
      const slow = c === "rest" || c === "away";
      expect(totalMs(CLIP_MS[c]), c).toBeLessThanOrEqual(slow ? 2500 : 2000);
    }
  });
  it("typing/running cycle fast enough to read as work (<= 600 ms); stalled is slower", () => {
    expect(totalMs(CLIP_MS.typing)).toBeLessThanOrEqual(600);
    expect(totalMs(CLIP_MS.running)).toBeLessThanOrEqual(600);
    expect(totalMs(CLIP_MS.stalled)).toBeGreaterThan(totalMs(CLIP_MS.typing));
  });
  it("transitions last <= 500 ms (the work clip must start promptly); done plays once in <= 1.2 s", () => {
    expect(totalMs(CLIP_MS.stand)).toBeLessThanOrEqual(500);
    expect(totalMs(CLIP_MS.sit)).toBeLessThanOrEqual(500);
    expect(totalMs(CLIP_MS.done)).toBeLessThanOrEqual(1200);
  });
});

describe("sprite-pipeline: walker anchors, mirror and timing (beyond office.test.ts)", () => {
  const lastInk = (f: string[]) => f.map((r) => /[^.]/.test(r)).lastIndexOf(true);
  const every = [...WALKER_FRAMES, ...WALKER_CARRY, WALKER_STAND, WALKER_CARRY_STAND, ...WALKER_DUST, ...WALKER_CARRY_DUST];

  it("every frame incl. dust is 18x12 of palette chars with one ground row (shoes on row 16; the last row is a 1 px margin)", () => {
    expect(new Set(every.map(lastInk)).size).toBe(1);
    expect(lastInk(WALKER_STAND)).toBe(WALKER_H - 2);
    for (const f of every) {
      expect(f.length).toBe(WALKER_H);
      expect(f[WALKER_H - 1]).toBe(".".repeat(WALKER_W));
      for (const r of f) {
        expect(r.length).toBe(WALKER_W);
        for (const ch of r) expect(Object.hasOwn(WALKER_PALETTE, ch)).toBe(true);
      }
    }
  });
  it("dust differs from the stand frame only by dust pixels", () => {
    for (const [stand, dust] of [[WALKER_STAND, WALKER_DUST], [WALKER_CARRY_STAND, WALKER_CARRY_DUST]] as const)
      for (const d of dust) d.forEach((row, y) => [...row].forEach((ch, x) => ch !== stand[y][x] && expect("uv", `${x},${y}`).toContain(ch)));
  });
  it("mirror() preserves size and is an involution for every walker frame incl. carry and dust", () => {
    for (const f of every) {
      const m = mirror(f);
      expect(m.length).toBe(f.length);
      expect(m.every((r) => r.length === WALKER_W)).toBe(true);
      expect(mirror(m)).toEqual(f);
      expect(lastInk(m)).toBe(lastInk(f));
    }
  });
  it("timing: WALK_MS / DUST_MS match their frame counts and are positive; dust <= 500 ms", () => {
    expect(WALK_MS.length).toBe(WALKER_CLIPS.walk.length);
    expect(WALK_MS.length).toBe(WALKER_CLIPS.carry.length);
    expect(DUST_MS.length).toBe(WALKER_DUST.length);
    expect(DUST_MS.length).toBe(WALKER_CARRY_DUST.length);
    for (const ms of [...WALK_MS, ...DUST_MS]) expect(ms).toBeGreaterThan(0);
    expect(totalMs(DUST_MS)).toBeLessThanOrEqual(500);
    expect(WALKER_CLIPS.stand[0]).toBe(WALKER_FRAMES[2]);
  });
});
