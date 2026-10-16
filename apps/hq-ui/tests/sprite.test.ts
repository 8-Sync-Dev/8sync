import { describe, expect, it } from "vitest";
import { PALETTE, SHIRTS, SPRITES, SPRITE_SIZE, SPRITE_STATES, shirtFor } from "@/lib/sprite/frames";

describe("sprite data", () => {
  it("every state has frames", () => {
    for (const s of SPRITE_STATES) expect(SPRITES[s].length, s).toBeGreaterThanOrEqual(1);
    expect(SPRITES.idle.length).toBe(2);
    expect(SPRITES.typing.length).toBe(4);
    expect(SPRITES.running.length).toBe(3);
    expect(SPRITES.done.length).toBe(3);
  });
  it("every frame is 32 rows of 32 palette chars", () => {
    for (const s of SPRITE_STATES) {
      SPRITES[s].forEach((f, i) => {
        expect(f.length, `${s}#${i} rows`).toBe(SPRITE_SIZE);
        f.forEach((row, y) => {
          expect(row.length, `${s}#${i} row ${y}`).toBe(SPRITE_SIZE);
          for (const ch of row) expect(Object.hasOwn(PALETTE, ch), `${s}#${i} char ${ch}`).toBe(true);
        });
      });
    }
  });
  it("frames of a state differ (animation exists)", () => {
    for (const s of SPRITE_STATES) {
      if (SPRITES[s].length > 1) expect(new Set(SPRITES[s].map((f) => f.join())).size, s).toBeGreaterThan(1);
    }
  });
  it("shirt colors are stable, from the fixed set, and include 8 Sync lime", () => {
    expect(shirtFor("hq-a")).toBe(shirtFor("hq-a"));
    expect(SHIRTS).toContain("oklch(0.8 0.2 134)");
    expect(SHIRTS).toContain(shirtFor("anything"));
  });
});

import { HANDOFF_MS } from "@/lib/floor";
describe("handoff transient", () => {
  it("is an overlay with a ~4 s lifetime, not a sprite state", () => {
    expect(HANDOFF_MS).toBe(4000);
    expect(SPRITE_STATES as readonly string[]).not.toContain("handoff");
  });
});

import { SEATS } from "@/lib/office";
import { BLINK_MS, blinker, frameAt, hashSeed, memo, phaseOf, rng } from "@/lib/sprite/anim";
import { BLINKS, CLIPS, CLIP_MS, ONE_SHOT, PROPS, ROLE_SHIRT, spriteFrame, shirtOf } from "@/lib/sprite/frames";

describe("role sprites", () => {
  it("every seat has a prop, a role colour and a picture in every clip that differs from the bare sprite", () => {
    for (const { key } of SEATS) {
      expect(PROPS[key], key).toBeDefined();
      expect(PROPS[key].desk ?? PROPS[key].head, key).toBeTruthy();
      expect(SHIRTS as readonly string[], key).toContain(ROLE_SHIRT[key]);
      for (const c of CLIPS) {
        const f = spriteFrame(key, c, 0);
        expect(sameRows(f), `${key}/${c}`).toBe(true);
        expect(f.join(), `${key}/${c}`).not.toBe(spriteFrame(null, c, 0).join());
      }
    }
  });
  it("roles are told apart by their props", () => {
    const pics = SEATS.map(({ key }) => spriteFrame(key, "rest", 0).join());
    expect(new Set(pics).size).toBe(SEATS.length);
  });
  it("specialists wear the role colour; the lead wears the session's colour", () => {
    expect(shirtOf("rd", "room-a")).toBe(shirtOf("rd", "room-b"));
    expect(shirtOf("lead", "room-a")).toBe(shirtFor("room-a"));
  });
  it("away: the chair is empty (no skin, no shirt) but the role's desk prop and the chair back stay", () => {
    const f = spriteFrame("dev", "away", 0);
    expect(f.join()).not.toMatch(/[sc]/);
    expect(f[16].slice(6, 17)).toBe("nnnnnnnnnnn"); // chair back (x 5 is under dev's desk prop)
    expect(f.join()).not.toBe(spriteFrame(null, "away", 0).join()); // dev's desk prop is there
    expect(f.slice(10, 17).map((r) => r.slice(22, 29)).join()).not.toMatch(/g/); // screen off
    for (const { key } of SEATS) expect(spriteFrame(key, "away", 1).join(), key).not.toMatch(/[sc]/);
  });
  it("an empty seat rests with the screen off (no glow lines)", () => {
    const f = spriteFrame("dev", "rest", 0);
    expect(f.slice(10, 17).map((r) => r.slice(22, 29)).join()).not.toMatch(/g/);
  });
});

describe("clips and timing", () => {
  it("every clip has >=2 frames with one duration per frame; typing >=2, walk >=4", () => {
    for (const c of CLIPS) {
      expect(CLIP_MS[c].length, c).toBeGreaterThanOrEqual(2);
      expect(CLIP_MS[c].every((ms) => ms > 0), c).toBe(true);
      for (let i = 0; i < CLIP_MS[c].length; i++) expect(sameRows(spriteFrame(null, c, i)), `${c}#${i}`).toBe(true);
    }
    for (const s of SPRITE_STATES) expect(CLIP_MS[s].length, s).toBe(SPRITES[s].length);
    expect(CLIP_MS.typing.length).toBeGreaterThanOrEqual(2);
    expect(new Set(CLIP_MS.typing).size).toBeGreaterThan(1); // per-frame, not one global fps
  });
  it("idle breathes: the two idle frames differ by a 1 px head drop", () => {
    const [a, b] = [spriteFrame(null, "idle", 0), spriteFrame(null, "idle", 1)];
    expect(a.join()).not.toBe(b.join());
    expect(a[8].slice(7, 15)).toBe(b[9].slice(7, 15));
  });
  it("blink closes the eyes of the same frame; done plays once with a 2-frame flash", () => {
    expect(spriteFrame("qa", "idle", 0, true).join()).not.toBe(spriteFrame("qa", "idle", 0).join());
    expect(BLINKS.has("idle") && BLINKS.has("rest") && !BLINKS.has("stalled")).toBe(true);
    expect(ONE_SHOT.has("done")).toBe(true);
    const flash = (i: number) => spriteFrame(null, "done", i).slice(10, 17).map((r) => r.slice(22, 29)).join();
    expect(flash(0)).toMatch(/^[w,]+$/);
    expect(flash(1)).not.toBe(flash(0));
  });
  it("frameAt follows per-frame durations, wraps loops and ends one-shots", () => {
    const ms = [100, 50, 200];
    expect([0, 99, 100, 149, 150, 349, 350].map((t) => frameAt(ms, t))).toEqual([0, 0, 1, 1, 2, 2, 0]);
    expect(frameAt(ms, 349, { loop: false })).toBe(2);
    expect(frameAt(ms, 350, { loop: false })).toBe(-1);
  });
  it("reduced motion always gives the static frame 0", () => {
    for (const t of [0, 120, 999, 12345]) expect(frameAt(CLIP_MS.typing, t, { reduced: true })).toBe(0);
    expect(frameAt(CLIP_MS.done, 1e9, { loop: false, reduced: true })).toBe(0);
  });
  it("seeded phase: stable per sprite, different across seats", () => {
    expect(phaseOf("r:dev", CLIP_MS.idle)).toBe(phaseOf("r:dev", CLIP_MS.idle));
    const phases = new Set(SEATS.map((s) => phaseOf(`room:${s.key}`, CLIP_MS.idle)));
    expect(phases.size).toBeGreaterThan(4);
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    const r = rng(1);
    const xs = [r(), r(), r()];
    expect(xs.every((x) => x >= 0 && x < 1) && new Set(xs).size === 3).toBe(true);
  });
  it("blinks are short and come back every few seconds", () => {
    const shut = blinker("room:qa", 0);
    let closed = 0;
    let runs = 0;
    let prev = false;
    for (let t = 0; t < 30_000; t += 10) {
      const b = shut(t);
      if (b) closed += 10;
      if (b && !prev) runs++;
      prev = b;
    }
    expect(runs).toBeGreaterThanOrEqual(5);
    expect(runs).toBeLessThanOrEqual(14);
    expect(closed / runs).toBeLessThanOrEqual(BLINK_MS + 10);
  });
  it("the frame cache builds once per key and returns the same object", () => {
    let builds = 0;
    const c = memo((k) => ({ k, n: ++builds }));
    const a = c.get("dev|idle|0|0|lime");
    expect(c.get("dev|idle|0|0|lime")).toBe(a);
    expect(c.get("dev|idle|1|0|lime")).not.toBe(a);
    expect([builds, c.size]).toEqual([2, 2]);
    expect(spriteFrame("rd", "typing", 1)).toBe(spriteFrame("rd", "typing", 1));
  });
});

import { transitionFor } from "@/lib/sprite/render";

describe("meeting state and the stand / sit transitions", () => {
  it("meeting is a looping state with a wall board instead of the monitor, 2-3 frames ~600 ms, and blinks", () => {
    expect(SPRITE_STATES).toContain("meeting");
    expect(CLIPS).toEqual([...SPRITE_STATES, "rest", "away", "stand", "sit"]);
    expect(ONE_SHOT.has("meeting")).toBe(false);
    expect(BLINKS.has("meeting")).toBe(true);
    expect(CLIP_MS.meeting.length).toBeGreaterThanOrEqual(2);
    expect(CLIP_MS.meeting.length).toBeLessThanOrEqual(3);
    for (const ms of CLIP_MS.meeting) expect(ms).toBeGreaterThanOrEqual(500);
    expect(SPRITES.meeting.length).toBe(CLIP_MS.meeting.length);
    const f = spriteFrame(null, "meeting", 0);
    expect(sameRows(f)).toBe(true);
    // no monitor glow / screen-off pixels where the monitor used to be; a white board + cards instead
    const wall = f.slice(6, 18).map((r) => r.slice(20, 31)).join();
    expect(wall).not.toMatch(/[kg]/);
    expect(wall).toMatch(/w/);
    expect(wall).toMatch(/y/);
    expect(wall).toMatch(/b/);
    expect(wall).toMatch(/t/);
    // eyes turned to the board (shift), speech dots build up frame by frame
    expect(f[9][10]).toBe("o");
    expect(f[9][13]).toBe("o");
    const dotsOf = (i: number) => [...spriteFrame(null, "meeting", i)[2].slice(1, 10)].filter((c) => c === "o").length;
    expect([dotsOf(0), dotsOf(1), dotsOf(2)]).toEqual([1, 2, 3]);
    expect(new Set(SPRITES.meeting.map((x) => x.join())).size).toBe(SPRITES.meeting.length);
  });
  it("stand and sit are one-shot, >= 3 frames, the head rises 3 px and the hands leave the keyboard", () => {
    for (const c of ["stand", "sit"] as const) {
      expect(ONE_SHOT.has(c), c).toBe(true);
      expect(CLIP_MS[c].length, c).toBeGreaterThanOrEqual(3);
      for (const ms of CLIP_MS[c]) expect(ms).toBeGreaterThanOrEqual(120);
      for (let i = 0; i < CLIP_MS[c].length; i++) expect(sameRows(spriteFrame(null, c, i)), `${c}#${i}`).toBe(true);
    }
    const idle = spriteFrame(null, "idle", 0);
    const up = spriteFrame(null, "stand", 2);
    const headTop = (f: string[]) => f.findIndex((r) => r.slice(7, 15) === ".oooooo.");
    expect(headTop(idle)).toBe(8);
    expect(headTop(up)).toBe(5);
    // hands off the keyboard (row 20 at x 13..14 is torso/outline now, not skin)
    expect(idle[20].slice(13, 15)).toBe("ss");
    expect(up[20].slice(13, 15)).not.toBe("ss");
    // the chair back shows beside the torso
    expect(up[18][5]).toBe("n");
    expect(up[18][16]).toBe("n");
    // sit is the reverse of stand
    expect(spriteFrame(null, "sit", 0).join()).toBe(spriteFrame(null, "stand", 2).join());
    expect(spriteFrame(null, "sit", 2).join()).toBe(spriteFrame(null, "stand", 0).join());
  });
  it("transitions: seated -> work via stand, work -> idle via sit, everything else direct", () => {
    expect(transitionFor("idle", "typing")).toBe("stand");
    expect(transitionFor("rest", "meeting")).toBe("stand");
    expect(transitionFor("done", "running")).toBe("stand");
    expect(transitionFor("typing", "idle")).toBe("sit");
    expect(transitionFor("meeting", "idle")).toBe("sit");
    expect(transitionFor("typing", "reading")).toBeNull();
    expect(transitionFor("idle", "stalled")).toBeNull();
    expect(transitionFor("idle", "done")).toBeNull();
    expect(transitionFor("typing", "rest")).toBe("sit"); // sit down before dozing
    expect(transitionFor("typing", "stalled")).toBe("sit");
    expect(transitionFor("stalled", "typing")).toBe("stand");
  });
});

function sameRows(f: string[]) {
  return f.length === SPRITE_SIZE && f.every((r) => r.length === SPRITE_SIZE && [...r].every((ch) => Object.hasOwn(PALETTE, ch)));
}
