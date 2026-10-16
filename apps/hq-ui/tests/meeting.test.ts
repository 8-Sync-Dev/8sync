import { describe, expect, it } from "vitest";
import { attendeesNow, MEETING_MS, meetingLabel, parseStandupDay, walkPhase, WALK_PHASE_MS } from "@/lib/meeting";

const DAY = "2026-10-16";
const md = [
  "# Họp sprint 2026-10-16",
  "",
  "| Giờ | Phòng | Done | Doing | Blocked |",
  "|---|---|---|---|---|",
  "| 09:00 | alpha | a done | a doing | - |",
  "| 09:05 | beta | b done | b doing | needs key |",
  "| 9:07 | bad | x | y | z |",
  "| 25:99 | bad | x | y | z |",
  "| 09:10 | short | x |",
  "random text",
].join("\n");
const t = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00Z`);

describe("parseStandupDay", () => {
  it("reads rows with UTC times, skips header, separator and junk", () => {
    expect(parseStandupDay(md, DAY)).toEqual([
      { room: "alpha", at: t("09:00"), done: "a done", doing: "a doing", blocked: "-" },
      { room: "beta", at: t("09:05"), done: "b done", doing: "b doing", blocked: "needs key" },
    ]);
  });
  it("caps rows at 200 and cells at 160 chars; bad date gives nothing", () => {
    const many = Array.from({ length: 300 }, (_, i) => `| 10:00 | r${i} | ${"d".repeat(400)} | x | y |`).join("\n");
    const rows = parseStandupDay(many, DAY);
    expect(rows.length).toBe(200);
    expect(rows[0].done.length).toBe(160);
    expect(parseStandupDay(md, "yesterday")).toEqual([]);
  });
});

describe("attendeesNow / walkPhase / label", () => {
  const rows = parseStandupDay(md + "\n| 09:20 | alpha | again | more | - |", DAY);
  it("keeps rooms that spoke within MEETING_MS, one row per room", () => {
    expect(attendeesNow(rows, t("09:30")).map((a) => [a.room, a.doing])).toEqual([
      ["beta", "b doing"],
      ["alpha", "more"],
    ]);
    expect(attendeesNow(rows, t("09:36")).map((a) => a.room)).toEqual(["alpha"]);
    expect(attendeesNow(rows, t("09:50"))).toEqual([]);
    expect(attendeesNow(rows, t("08:00"))).toEqual([]);
  });
  it("walk phases: out, table, back, then null", () => {
    const at = t("09:00");
    expect(walkPhase(at, at)).toBe("out");
    expect(walkPhase(at, at + WALK_PHASE_MS - 1)).toBe("out");
    expect(walkPhase(at, at + WALK_PHASE_MS)).toBe("table");
    expect(walkPhase(at, at + MEETING_MS - WALK_PHASE_MS - 1)).toBe("table");
    expect(walkPhase(at, at + MEETING_MS - WALK_PHASE_MS)).toBe("back");
    expect(walkPhase(at, at + MEETING_MS - 1)).toBe("back");
    expect(walkPhase(at, at + MEETING_MS)).toBeNull();
    expect(walkPhase(at, at - 1)).toBeNull();
  });
  it("label in Vietnamese with minutes left", () => {
    const until = t("09:30");
    expect(meetingLabel(2, until, until - 27 * 60_000 + 1000)).toBe("Họp sprint · 2 phòng · còn 27 phút");
    expect(meetingLabel(1, until, until)).toBe("Họp sprint · 1 phòng · sắp xong");
  });
});
