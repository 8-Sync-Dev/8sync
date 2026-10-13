import { describe, expect, it } from "vitest";
import { isStale, messageTargets, sessionLabel, splitStale } from "@/lib/labels";

const UUID = "3f2b8c1e-9d4a-4e7b-8a21-5c6d7e8f9a0b";
const base = { label: "", name: "", session_id: null as string | null };

describe("sessionLabel", () => {
  it("prefers label, strips hq-", () => {
    expect(sessionLabel({ ...base, label: "Fix login bug", name: "x" })).toBe("Fix login bug");
    expect(sessionLabel({ ...base, label: "hq-api", name: "hq-api" })).toBe("api");
  });
  it("falls back to name when label is a uuid", () => {
    expect(sessionLabel({ ...base, label: UUID, name: "hq-web" })).toBe("web");
  });
  it("never returns a full uuid", () => {
    expect(sessionLabel({ ...base, label: UUID, name: UUID })).toBe("3f2b8c1e");
    expect(sessionLabel({ ...base, session_id: UUID })).toBe("3f2b8c1e");
    expect(sessionLabel(base)).toBe("unknown");
  });
});

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
describe("collapse rules", () => {
  it("idle > 1 day is stale", () => {
    expect(isStale({ status: "idle", started_at: NOW - 2 * DAY, waiting: null }, NOW)).toBe(true);
    expect(isStale({ status: "idle", started_at: NOW - DAY / 2, waiting: null }, NOW)).toBe(false);
  });
  it("running, needs_input and waiting never collapse", () => {
    expect(isStale({ status: "running", started_at: NOW - 9 * DAY, waiting: null }, NOW)).toBe(false);
    expect(isStale({ status: "needs_input", started_at: NOW - 9 * DAY, waiting: null }, NOW)).toBe(false);
    expect(isStale({ status: "ended", started_at: NOW, waiting: "Trust folder?" }, NOW)).toBe(false);
  });
  it("ended collapses; idle with unknown start does not", () => {
    expect(isStale({ status: "ended", started_at: null, waiting: null }, NOW)).toBe(true);
    expect(isStale({ status: "idle", started_at: null, waiting: null }, NOW)).toBe(false);
  });
  it("splitStale partitions", () => {
    const a = { status: "idle" as const, started_at: NOW - 3 * DAY, waiting: null };
    const b = { status: "running" as const, started_at: NOW, waiting: null };
    expect(splitStale([a, b], NOW)).toEqual({ fresh: [b], stale: [a] });
  });
});

describe("messageTargets", () => {
  it("needs tmux and not ended", () => {
    const l = [
      { tmux: true, status: "running" as const },
      { tmux: false, status: "running" as const },
      { tmux: true, status: "ended" as const },
    ];
    expect(messageTargets(l)).toEqual([l[0]]);
  });
});
