import { describe, expect, it } from "vitest";
import { JOURNAL_KEEP_MS, splitSessions, staleJournal } from "@/lib/sessions-list";

const NOW = Date.parse("2026-10-22T07:00:00Z");

describe("session junk", () => {
  it("deletes only gone, untouched journal rows, and never when the live list is unknown", () => {
    const old = { updated_at: NOW - JOURNAL_KEEP_MS - 1, started_at: NOW - JOURNAL_KEEP_MS - 5 };
    expect(staleJournal(old, false, true, NOW)).toBe(true);
    expect(staleJournal(old, true, true, NOW)).toBe(false);
    expect(staleJournal(old, false, false, NOW)).toBe(false);
    expect(staleJournal({ updated_at: NOW - 1000, started_at: null }, false, true, NOW)).toBe(false);
    expect(staleJournal({ updated_at: null, started_at: null }, false, true, NOW)).toBe(true);
  });
  it("lists live sessions apart from ended ones", () => {
    const s = [{ name: "a", status: "running" }, { name: "b", status: "ended" }, { name: "c", status: "idle" }];
    const r = splitSessions(s);
    expect(r.live.map((x) => x.name)).toEqual(["a", "c"]);
    expect(r.ended.map((x) => x.name)).toEqual(["b"]);
  });
});
