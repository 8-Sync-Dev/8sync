import { describe, expect, it } from "vitest";
import { MIN_ROWS, POLL_GIVE_UP_MS, afterStream, giveUp, keyboardOpen, retryDelay, termRows } from "@/lib/term-stream";

const base = { remote: true, aborted: false, refused: false, ended: false, threw: false };

describe("room terminal: when the stream stops", () => {
  it("remote: a drop mid-stream or a silent close falls back to polling", () => {
    expect(afterStream({ ...base, threw: true })).toBe("poll");
    expect(afterStream(base)).toBe("poll");
  });
  it("a refusal shows at once, an ended room or the user's close stops", () => {
    expect(afterStream({ ...base, refused: true, threw: true })).toBe("fail");
    expect(afterStream({ ...base, ended: true })).toBe("done");
    expect(afterStream({ ...base, aborted: true, threw: true })).toBe("done");
  });
  it("loopback keeps the old behaviour: an error shows, a clean close stops", () => {
    expect(afterStream({ ...base, remote: false, threw: true })).toBe("fail");
    expect(afterStream({ ...base, remote: false })).toBe("done");
  });
});

describe("room terminal over a flaky tunnel", () => {
  it("retries with backoff for a minute before giving up", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([600, 1200, 2400, 4800, 5000, 5000]);
    expect(giveUp(0, POLL_GIVE_UP_MS - 1)).toBe(false);
    expect(giveUp(0, POLL_GIVE_UP_MS)).toBe(true);
  });
  it("never asks for so few rows that a 5-option question is cut, and does not shrink under a phone keyboard", () => {
    expect(termRows(9, null, false)).toBe(MIN_ROWS);
    expect(termRows(40, null, false)).toBe(40);
    expect(termRows(12, 40, true)).toBe(40);
    expect(termRows(30, 40, false)).toBe(30);
    expect(keyboardOpen(300, 800)).toBe(true);
    expect(keyboardOpen(780, 800)).toBe(false);
    expect(keyboardOpen(null, 800)).toBe(false);
  });
});
