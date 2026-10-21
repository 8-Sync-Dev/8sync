import { describe, expect, it } from "vitest";
import { applySlash, loopFor, loopWait, parseSlash, PRESETS, shipLoops, slashAt, slashMenu, slashSend, type SlashRoom } from "@/lib/slash";

const rooms: SlashRoom[] = [
  { key: "k-lead", name: "a1830544-0719-4d6f-aaa3-644783ddb0b5", label: "lead" },
  { key: "k-dev2", name: "hq-ide-dev2", label: "dev2" },
  { key: "k-qa", name: "b2830544-0719-4d6f-aaa3-644783ddb0b5", label: "qa" },
];
const ALL = { kind: "all", root: "/r/ide" } as const;

describe("parseSlash", () => {
  it("`/all x`, `/dev2 x`, presets with and without focus", () => {
    expect(parseSlash("/all sửa lỗi login", rooms)).toEqual({ kind: "all", body: "sửa lỗi login" });
    expect(parseSlash("/dev2   chạy lại test\ndòng 2", rooms)).toEqual({ kind: "room", room: rooms[1], body: "chạy lại test\ndòng 2" });
    expect(parseSlash("/hq-auto-ship hiệu năng mobile", rooms)).toMatchObject({ kind: "preset", preset: { cmd: "hq-auto-ship", loop: "on" }, focus: "hiệu năng mobile" });
    expect(parseSlash("/hq-sec", rooms)).toMatchObject({ kind: "preset", preset: { cmd: "hq-sec" }, focus: null });
    // A room by its session name too.
    expect(parseSlash("/hq-ide-dev2 x", rooms)).toMatchObject({ kind: "room", room: { key: "k-dev2" } });
  });

  it("case-insensitive commands and rooms", () => {
    expect(parseSlash("/DEV2 x", rooms)).toMatchObject({ kind: "room", room: { key: "k-dev2" } });
    expect(parseSlash("/All x", rooms)).toMatchObject({ kind: "all" });
    expect(parseSlash("/HQ-Stop", rooms)).toMatchObject({ kind: "preset", preset: { cmd: "hq-stop", loop: "off" } });
  });

  it("unknown command or room, and a room command without text, are errors (nothing is sent)", () => {
    const e = parseSlash("/dev9 x", rooms);
    expect(e.kind).toBe("error");
    expect(e.kind === "error" && e.error).toContain("/dev9");
    expect(parseSlash("/qa", rooms)).toMatchObject({ kind: "error" });
    expect(parseSlash("/all", rooms)).toMatchObject({ kind: "error" });
  });

  it("not a command: `/` mid-text, a path, `//` escape, plain text", () => {
    expect(parseSlash("xem /dev2 giúp", rooms)).toEqual({ kind: "none", text: "xem /dev2 giúp" });
    expect(parseSlash("/home/me/app lỗi 500", rooms)).toEqual({ kind: "none", text: "/home/me/app lỗi 500" });
    expect(parseSlash("//compact", rooms)).toEqual({ kind: "none", text: "/compact" });
    expect(parseSlash("  hello  ", rooms)).toEqual({ kind: "none", text: "hello" });
  });
});

describe("presets expand in HQ", () => {
  it("every brief starts with its [HQ /…] header, never a leading `/`, and carries the focus", () => {
    for (const p of PRESETS) {
      const b = p.brief("UX mobile");
      expect(b.startsWith(`[HQ /${p.cmd}]`), p.cmd).toBe(true);
      expect(b.startsWith("/")).toBe(false);
      expect(b).toContain("trọng tâm: UX mobile");
      expect(p.brief(null)).not.toContain("trọng tâm");
    }
    const ship = PRESETS.find((p) => p.cmd === "hq-auto-ship")!.brief(null);
    for (const w of ["R&D", "Optimize", "Nâng cấp", "Cải tiến", "Check sec", "Check thiếu", "auto add", "--check", "bằng chứng", "guard", "/hq-stop"]) expect(ship, w).toContain(w);
    expect(PRESETS.map((p) => p.cmd)).toEqual(["hq-auto-ship", "hq-rnd", "hq-optimize", "hq-upgrade", "hq-improve", "hq-sec", "hq-gaps", "hq-stop"]);
  });
});

describe("slashSend: target and text", () => {
  const lead = rooms[0];
  it("a preset goes to the project's lead, else the composer's target; loop presets switch the loop", () => {
    const s = parseSlash("/hq-auto-ship perf", rooms);
    const r = slashSend(s, { target: ALL, root: "/r/ide", lead });
    expect(r).toMatchObject({ ok: true, target: { kind: "room", key: "k-lead" }, loop: { on: true, root: "/r/ide", focus: "perf" } });
    expect(r.ok && r.text.startsWith("[HQ /hq-auto-ship]")).toBe(true);
    expect(slashSend(s, { target: ALL, root: "/r/ide", lead: null })).toMatchObject({ ok: true, target: ALL });
    expect(slashSend(parseSlash("/hq-stop", rooms), { target: ALL, root: "/r/ide", lead })).toMatchObject({ ok: true, loop: { on: false } });
    expect(slashSend(parseSlash("/hq-rnd", rooms), { target: ALL, root: "/r/ide", lead })).toMatchObject({ ok: true, loop: null });
    expect(slashSend(s, { target: { kind: "all", root: "__all__" }, root: null, lead: null })).toMatchObject({ ok: false });
  });

  it("/all and /<room> override the target for this send; plain text keeps it", () => {
    const one = { kind: "room", key: "k-qa" } as const;
    expect(slashSend(parseSlash("/all x", rooms), { target: one, root: "/r/ide", lead })).toEqual({ ok: true, target: ALL, text: "x", loop: null });
    expect(slashSend(parseSlash("/dev2 x", rooms), { target: ALL, root: "/r/ide", lead })).toEqual({ ok: true, target: { kind: "room", key: "k-dev2" }, text: "x", loop: null });
    expect(slashSend(parseSlash("hello", rooms), { target: one, root: "/r/ide", lead })).toEqual({ ok: true, target: one, text: "hello", loop: null });
    expect(slashSend(parseSlash("/dev9 x", rooms), { target: one, root: "/r/ide", lead })).toMatchObject({ ok: false });
  });
});

describe("menu", () => {
  it("opens only while the caret is in the first word after a leading `/`", () => {
    expect(slashAt("/", 1)).toEqual({ prefix: "", end: 1 });
    expect(slashAt("/de", 3)).toEqual({ prefix: "de", end: 3 });
    expect(slashAt("/dev2 x", 7)).toBeNull();
    expect(slashAt("xem /de", 7)).toBeNull();
    expect(slashAt("//x", 2)).toBeNull();
    expect(slashAt("/home/me", 5)).toEqual({ prefix: "home", end: 5 });
  });

  it("rows: /all, the rooms, the presets, filtered by prefix (case-insensitive)", () => {
    expect(slashMenu("", rooms).map((r) => r.cmd)).toEqual(["all", "lead", "dev2", "qa", ...PRESETS.map((p) => p.cmd)]);
    expect(slashMenu("D", rooms).map((r) => r.cmd)).toEqual(["dev2"]);
    expect(slashMenu("hq-s", rooms).map((r) => r.cmd)).toEqual(["hq-sec", "hq-stop"]);
    expect(slashMenu("", []).map((r) => r.kind)).toEqual(PRESETS.map(() => "preset"));
    for (const r of slashMenu("", rooms)) expect(r.desc.length).toBeGreaterThan(5);
  });

  it("picking replaces the typed word and leaves one space", () => {
    expect(applySlash("/de", 3, { cmd: "dev2", desc: "", kind: "room" })).toEqual({ text: "/dev2 ", caret: 6 });
    expect(applySlash("/hq  fix it", 3, { cmd: "hq-gaps", desc: "", kind: "preset" })).toEqual({ text: "/hq-gaps fix it", caret: 9 });
  });
});

describe("ship loops from auto status", () => {
  it("parses `ship_loops` and finds a project's loop across spellings", () => {
    const loops = shipLoops({ "\\\\?\\C:\\Users\\me\\ide": { round: 3, focus: "perf", since: 10, next_reason: "usage" }, "/x": { round: "junk", next_reason: null }, bad: null });
    expect(loops).toEqual([
      { root: "\\\\?\\C:\\Users\\me\\ide", round: 3, focus: "perf", since: 10, next: "usage" },
      { root: "/x", round: 1, focus: null, since: null, next: null },
    ]);
    expect(loopWait("usage")).toBe("chờ usage");
    expect(loopWait("guard")).toBe("chờ máy rảnh");
    expect(loopWait("board")).toBeNull();
    expect(loopWait(null)).toBeNull();
    expect(loopFor(loops, "C:/users/me/ide")?.round).toBe(3);
    expect(loopFor(loops, "/y")).toBeNull();
    expect(shipLoops(undefined)).toEqual([]);
    expect(shipLoops([1])).toEqual([]);
  });
});
