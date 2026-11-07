import { describe, expect, it } from "vitest";
import { deriveFloor, type FloorRow } from "@/lib/floor";
import { normWatch, OBSERVE_SKIP_MAX, WATCH_DEFAULT, watchStatus, watchTick, type WatchDeps } from "@/lib/server/machine-watch";
import { SessionWaiting } from "@/lib/server/channel";
import { nudgeText, OBSERVE_DEFAULT, observeStep, observeZero, pageText, type ObserveScope, type ObserveState } from "@/lib/server/observer";

const MIN = 60_000;
const A = "omp-00000000000000aa";
const B = "omp-00000000000000bb";
const WATCH = "omp-0000000000000ccc";
const T0 = 1_800_000_000_000;
const SCOPE: ObserveScope = { skip: [], watchRoom: WATCH };

/** A live room whose transcript last moved `quietMin` minutes before `now`. */
const row = (id: string, over: Partial<FloorRow> = {}, quietMin = 0, now = T0): FloorRow => ({
  id: `omp::${id}`,
  name: id,
  title: `room ${id.slice(-2)}`,
  last_active: Math.floor((now - quietMin * MIN) / 1000),
  hq: false,
  inbox_id: id,
  live: true,
  state: "typing",
  label: "đang gõ code",
  caption: "Edit: a.ts",
  progress: null,
  ...over,
});

const step = (st: ObserveState, rows: FloorRow[], now: number, scope = SCOPE) => observeStep(st, rows, now, OBSERVE_DEFAULT, scope);

describe("observer rules", () => {
  it("stalled fires at stallMin, not a minute before; background jobs and hq-only rows never stall", () => {
    expect(step(observeZero(), [row(A, {}, 19)], T0).actions).toEqual([]);
    const r = step(observeZero(), [row(A, {}, 20)], T0);
    expect(r.actions).toEqual([expect.objectContaining({ room: A, signal: "stalled", level: "note", why: "đứng 20 phút" })]);
    // deriveFloor's own "quiet with open work" stall counts as a stall, its API-error stall as an error,
    // and its background-jobs row never stalls: the captions come from deriveFloor itself, so a reword
    // there cannot silently swap the signals.
    const quiet = deriveFloor({ status: "running", last_active: Math.floor(T0 / 1000) - 25 * 60, current_task: "x" } as Parameters<typeof deriveFloor>[0], null, T0);
    expect(quiet.state).toBe("stalled");
    expect(step(observeZero(), [row(A, quiet, 25)], T0).actions.map((a) => a.signal)).toEqual(["stalled"]);
    const err = deriveFloor({ status: "running", stalled_error: "usage limit" } as Parameters<typeof deriveFloor>[0], null, T0);
    expect(step(observeZero(), [row(A, err, 0)], T0).actions.map((a) => a.signal)).toEqual(["error"]);
    const bg = deriveFloor({ status: "running", last_active: Math.floor(T0 / 1000) - 60 * 60, bg_jobs: ["j"] } as Parameters<typeof deriveFloor>[0], null, T0);
    expect(step(observeZero(), [row(A, bg, 60)], T0).actions).toEqual([]);
    expect(step(observeZero(), [row(A, { unmatched: true }, 60)], T0).actions).toEqual([]);
    expect(step(observeZero(), [row(A, { state: "idle" }, 600)], T0).actions).toEqual([]);
  });

  it("waiting fires at waitMin; an API error / usage limit fires at once", () => {
    const w = { state: "waiting" as const, label: "chờ anh", caption: "Cho phép chạy lệnh?" };
    expect(step(observeZero(), [row(A, w, 14)], T0).actions).toEqual([]);
    expect(step(observeZero(), [row(A, w, 15)], T0).actions.map((a) => a.signal)).toEqual(["waiting"]);
    const e = step(observeZero(), [row(A, { state: "stalled", caption: "usage limit — cần anh xử lý" }, 0)], T0);
    expect(e.actions.map((a) => [a.signal, a.level])).toEqual([["error", "note"]]);
  });

  it("looping needs the same step for loopMin (1-min ticks) while the transcript keeps moving", () => {
    let st = observeZero();
    const at = (i: number) => T0 + i * MIN;
    const tick = (i: number, over: Partial<FloorRow> = {}) => {
      const r = step(st, [row(A, over, 0, at(i))], at(i));
      st = r.next;
      return r.actions.map((a) => a.signal);
    };
    for (let i = 0; i < 20; i++) expect(tick(i)).toEqual([]);
    expect(tick(20)).toEqual(["looping"]);
    // A different step starts the clock again.
    expect(tick(21, { caption: "Bash: pnpm test" })).toEqual([]);
    expect(st.seen[A].since).toBe(at(21));
    expect(st.steps).toEqual({});
    // Same step but a transcript that does not move is not a loop: it is the stall rule's case.
    st = observeZero();
    const still = row(A, {}, 0, T0);
    let signals: string[] = [];
    for (let i = 0; i <= 25; i++) {
      const r = step(st, [still], at(i));
      st = r.next;
      signals = [...signals, ...r.actions.map((a) => a.signal)];
    }
    expect(signals).toEqual(["stalled"]);
  });

  it("climbs note → nudge → page one rung per cooldown, then stays quiet; clears back to note", () => {
    let st = observeZero();
    const at = (m: number) => T0 + m * MIN;
    const run = (m: number) => {
      const r = step(st, [row(A, {}, 20 + m, at(m))], at(m));
      st = r.next;
      return r.actions.map((a) => a.level);
    };
    expect(run(0)).toEqual(["note"]);
    expect(run(29)).toEqual([]);
    expect(run(30)).toEqual(["nudge"]);
    expect(run(59)).toEqual([]);
    expect(run(60)).toEqual(["page"]);
    expect(run(200)).toEqual([]);
    // The room moves on to another step: the signal clears and its rung is dropped.
    st = step(st, [row(A, { caption: "Bash: pnpm test" }, 0, at(201))], at(201)).next;
    expect(st.steps).toEqual({});
    expect(step(st, [row(A, {}, 20, at(230))], at(230)).actions.map((a) => a.level)).toEqual(["note"]);
  });

  it("without a Canh máy room nothing climbs past nudge (waiting / error stop at note)", () => {
    const scope = { skip: [], watchRoom: null };
    let st = observeZero();
    const levels: string[] = [];
    for (const m of [0, 30, 60, 90, 120]) {
      const now = T0 + m * MIN;
      const r = step(st, [row(A, {}, 20 + m, now), row(B, { state: "waiting", caption: "?" }, 15 + m, now)], now, scope);
      st = r.next;
      levels.push(...r.actions.map((a) => `${a.signal}:${a.level}`));
    }
    expect(levels).toEqual(["stalled:note", "waiting:note", "stalled:nudge"]);
  });

  it("never nudges a room waiting on the owner or stopped on an error", () => {
    let st = observeZero();
    const levels: string[] = [];
    for (const m of [0, 30, 60, 90]) {
      const r = step(st, [row(A, { state: "waiting", caption: "?" }, 15 + m, T0 + m * MIN)], T0 + m * MIN);
      st = r.next;
      levels.push(...r.actions.map((a) => a.level));
    }
    expect(levels).toEqual(["note", "page"]);
  });

  it("skips the owner's list entirely and only notes the Canh máy room about itself", () => {
    const rows = [row(A, {}, 30), row(B, {}, 30), row(WATCH, {}, 30)];
    const r = step(observeZero(), rows, T0, { skip: [B], watchRoom: WATCH });
    expect(r.actions.map((a) => a.room)).toEqual([A, WATCH]);
    expect(r.next.seen[B]).toBeUndefined();
    let st = r.next;
    const later = step(st, [row(WATCH, {}, 60, T0 + 30 * MIN)], T0 + 30 * MIN);
    st = later.next;
    expect(later.actions).toEqual([]);
    expect(st.steps[`${WATCH}|stalled`].level).toBe("note");
  });

  it("writes short Vietnamese texts naming the room and the rule", () => {
    const a = { room: A, title: "room aa", signal: "stalled" as const, level: "nudge" as const, at: T0, why: "đứng 20 phút" };
    expect(nudgeText(a)).toBe("[Canh máy] Phòng này đứng 20 phút: kiểm lại bước hiện tại, đổi hướng nếu cần, hoặc báo blocker cho owner.");
    expect(pageText({ ...a, level: "page" })).toContain(`Phòng "room aa" (${A}) đứng: đứng 20 phút.`);
    expect(pageText({ ...a, level: "page" })).toContain("Đừng kill");
  });
});

describe("observer config and tick", () => {
  it("loads an old file without observe fields, and keeps only valid skip ids (deduped, capped)", () => {
    const old = normWatch({ on: true, room: WATCH, everyMin: 60, cpu: 80, ram: 90, gpu: 95 });
    expect(old).toEqual({ ...WATCH_DEFAULT, on: true, room: WATCH, everyMin: 60, cpu: 80, observe: false, observeSkip: [] });
    const c = normWatch({ observe: true, observeSkip: [A, A, "../x", 5, B] }, old);
    expect(c.observe).toBe(true);
    expect(c.observeSkip).toEqual([A, B]);
    const many = Array.from({ length: 80 }, (_, i) => `omp-${i.toString(16).padStart(16, "0")}`);
    expect(normWatch({ observeSkip: many }).observeSkip).toHaveLength(OBSERVE_SKIP_MAX);
    // Left out: kept; a non-array: kept.
    expect(normWatch({ cpu: 70 }, c).observeSkip).toEqual([A, B]);
    expect(normWatch({ observeSkip: "x" }, c).observeSkip).toEqual([A, B]);
  });

  it("the watch tick nudges the room, pages the Canh máy room, lists both, and does not retry a dialog", async () => {
    const sent: string[] = [];
    let quiet = 20;
    let now = T0;
    let dialog = false;
    const deps: Partial<WatchDeps> = {
      floor: async () => [row(A, {}, quiet, now), row(WATCH, { state: "idle" }, 0, now)],
      live: () => true,
      levels: async () => {
        throw new Error("machine is not read when only observing");
      },
      deliver: (_r, id, text) => {
        if (dialog) throw new SessionWaiting("Allow?");
        sent.push(`${id}|${text.split("\n")[0]}`);
      },
    };
    const cfg = { ...WATCH_DEFAULT, observe: true, room: WATCH };
    // off resets whatever an earlier tick left.
    await watchTick(now, { ...cfg, observe: false }, deps);
    expect(await watchTick(now, cfg, deps)).toBeNull();
    expect(sent).toEqual([]);
    now += 30 * MIN;
    quiet += 30;
    await watchTick(now, cfg, deps);
    expect(sent).toEqual([`${A}|${nudgeText({ room: A, title: "", signal: "stalled", level: "nudge", at: now, why: "đứng 50 phút" })}`]);
    now += 30 * MIN;
    quiet += 30;
    dialog = true;
    await watchTick(now, cfg, deps);
    expect(sent).toHaveLength(1);
    const st = watchStatus(cfg);
    expect(st.observed.map((o) => [o.room, o.level, o.outcome])).toEqual([
      [A, "page", expect.stringContaining("hộp thoại")],
      [A, "nudge", null],
      [A, "note", null],
    ]);
    // Page reached: nothing more until the signal clears.
    dialog = false;
    now += 30 * MIN;
    quiet += 30;
    await watchTick(now, cfg, deps);
    expect(sent).toHaveLength(1);
    // The page goes to the Canh máy room.
    await watchTick(now, { ...cfg, observe: false }, deps);
    now += 1;
    quiet = 20;
    await watchTick(now, cfg, deps);
    await watchTick((now += 30 * MIN), cfg, deps);
    quiet = 80;
    await watchTick((now += 30 * MIN), cfg, deps);
    expect(sent.at(-1)).toBe(`${WATCH}|[Canh máy · quan sát phòng] Phòng "room aa" (${A}) đứng: đứng 80 phút.`);
  });

  it("runs every 1-min tick with the machine watch off and no room: a stall notes at 20 min, nudges, never pages", async () => {
    const sent: string[] = [];
    const start = T0 + 10_000 * MIN;
    let now = start;
    const deps: Partial<WatchDeps> = {
      // The room's transcript stopped at `start`.
      floor: async () => [row(A, {}, (now - start) / MIN, now)],
      live: () => true,
      levels: async () => {
        throw new Error("machine is not read while the watch is off");
      },
      deliver: (_r, id, text) => sent.push(`${id}|${text}`),
    };
    const cfg = { ...WATCH_DEFAULT, on: false, room: null, observe: true };
    await watchTick(now, { ...cfg, observe: false }, deps);
    const notes: number[] = [];
    for (let m = 0; m <= 120; m++) {
      now = start + m * MIN;
      expect(await watchTick(now, cfg, deps)).toBeNull();
      const top = watchStatus(cfg).observed[0];
      if (top?.at === now) notes.push(m);
    }
    expect(notes).toEqual([20, 50]);
    expect(sent).toEqual([`${A}|[Canh máy] Phòng này đứng 50 phút: kiểm lại bước hiện tại, đổi hướng nếu cần, hoặc báo blocker cho owner.`]);
    expect(watchStatus(cfg).observeNote).toContain("Chưa chọn phòng Canh máy để báo anh");
  });

  it("a floor that fails shows a note and leaves the machine watch running", async () => {
    const cfg = { ...WATCH_DEFAULT, observe: true };
    expect(
      await watchTick(T0, cfg, {
        floor: async () => {
          throw new Error("ls");
        },
      }),
    ).toBeNull();
    expect(watchStatus(cfg).observeNote).toBe("Quan sát phòng lỗi: ls");
  });
});
