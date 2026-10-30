import { describe, expect, it } from "vitest";
import { IDLE_FLAG_MS, agoShort, agoVi, deskClip, roomNow, roomRole, roster, rosterSummary, stateChanges, type NowRoom } from "@/lib/now";

const NOW = 1_800_000_000_000;
const ROOT = "C:/work/proj";

const room = (o: Partial<NowRoom> & { label: string }): NowRoom => ({
  status: "idle",
  waiting: null,
  name: o.label,
  cwd: `${ROOT}/sub`,
  role: null,
  model: null,
  doing: null,
  last_active: null,
  ...o,
});

describe("roomRole", () => {
  it("mirrors room.rs: first matching token, trailing digits dropped, ≥4-char keys as prefix", () => {
    expect(roomRole("lead")?.role).toBe("plan");
    expect(roomRole("dev2")).toEqual({ role: "fullstack", seat: "dev" });
    expect(roomRole("qa-su-code")).toEqual({ role: "tester", seat: "qa" });
    expect(roomRole("reviewer")?.seat).toBe("review");
    expect(roomRole("research-x")?.role).toBe("rd");
    expect(roomRole("arch")?.role).toBe("architect");
    expect(roomRole("solution-architect")?.role).toBe("architect");
    expect(roomRole("sale")).toBeNull();
    expect(roomRole("zus")).toBeNull();
    expect(roomRole(null)).toBeNull();
  });
});

describe("roomNow", () => {
  it("needs the owner first, whatever else is true", () => {
    expect(roomNow(room({ label: "dev2", status: "needs_input" }), NOW).state).toBe("needs");
    expect(roomNow(room({ label: "qa", status: "running", waiting: "Trust this folder?" }), NOW).state).toBe("needs");
  });

  it("working while the session runs, idle otherwise", () => {
    expect(roomNow(room({ label: "dev", status: "running" }), NOW).state).toBe("working");
    expect(roomNow(room({ label: "dev" }), NOW).state).toBe("idle");
  });

  it("last = the `8sync ls` line with its time", () => {
    expect(roomNow(room({ label: "dev", doing: "Bash: pnpm test", last_active: NOW - 5_000 }), NOW).last).toEqual({ text: "Bash: pnpm test", at: NOW - 5_000 });
    expect(roomNow(room({ label: "qa" }), NOW).last).toBeNull();
  });

  it("flags only a quiet room past a minute, never a working one or an unknown time", () => {
    const q = (ms: number, status: NowRoom["status"] = "idle") => roomNow(room({ label: "qa", status, last_active: NOW - ms }), NOW);
    expect(q(IDLE_FLAG_MS + 1)).toMatchObject({ flagged: true, quietMs: IDLE_FLAG_MS + 1 });
    expect(q(30_000).flagged).toBe(false);
    expect(q(5 * 60_000, "running")).toMatchObject({ flagged: false, quietMs: null });
    expect(roomNow(room({ label: "qa" }), NOW).quietMs).toBeNull();
  });
});

describe("roster", () => {
  it("sorts by attention, drops ended rooms, and summarises in words", () => {
    const rooms = [
      { ...room({ label: "qa", last_active: NOW - 1000 }), key: "qa" },
      { ...room({ label: "dev", status: "running" }), key: "dev" },
      { ...room({ label: "zus", last_active: NOW - 120_000 }), key: "zus" },
      { ...room({ label: "review", status: "needs_input" }), key: "review" },
      { ...room({ label: "old", status: "ended" }), key: "old" },
    ];
    const r = roster(rooms, NOW);
    expect(r.map((x) => x.key)).toEqual(["review", "dev", "zus", "qa"]);
    expect(rosterSummary(r)).toBe("1 chờ anh · 1 đang làm · 2 rảnh");
  });
});

describe("stateChanges", () => {
  it("only keys present before and after with a different value", () => {
    expect(stateChanges(null, { a: "working" }).size).toBe(0);
    expect([...stateChanges({ a: "working", b: "idle" }, { a: "idle", b: "idle", c: "needs" })]).toEqual(["a"]);
  });
});

describe("deskClip", () => {
  it("the desk pose is the room's real state", () => {
    expect(deskClip({ state: "working" }, "running")).toBe("running");
    expect(deskClip({ state: "working" }, "idle")).toBe("typing");
    expect(deskClip({ state: "needs" }, "typing")).toBe("waiting");
    expect(deskClip({ state: "idle" }, "typing")).toBe("idle");
  });
});

describe("agoVi / agoShort", () => {
  it("formats relative time in Vietnamese and stays empty for an unknown time", () => {
    expect(agoVi(NOW - 3_000, NOW)).toBe("vừa xong");
    expect(agoVi(NOW - 45_000, NOW)).toBe("45 giây trước");
    expect(agoVi(NOW - 4 * 60_000, NOW)).toBe("4 phút trước");
    expect(agoVi(NOW - 3 * 3600_000, NOW)).toBe("3 giờ trước");
    expect(agoVi(null, NOW)).toBe("");
    expect(agoShort(NOW - 41_000, NOW)).toBe("41s");
    expect(agoShort(NOW - 5 * 60_000, NOW)).toBe("5 ph");
    expect(agoShort(0, NOW)).toBe("");
  });
});
