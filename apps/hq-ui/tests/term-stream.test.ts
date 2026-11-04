import { describe, expect, it } from "vitest";
import { HELD_MS, MAX_KEYS, MIN_ROWS, POLL_GIVE_UP_MS, afterStream, giveUp, heldBack, keyQueue, keyboardOpen, pingTime, retryDelay, termRows } from "@/lib/term-stream";

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

describe("room terminal: a stream the tunnel passes in batches", () => {
  it("pings arriving with a steady lag stay on the stream, whatever the clocks say", () => {
    const late = heldBack();
    // The phone's clock is 7 min behind the PC: every lag reads negative, steadily.
    for (let i = 0; i < 10; i++) expect(late(1_000_000 + i * 2000, 1_000_000 - 420_000 + i * 2000 + 80)).toBe(false);
  });
  it("a ping released by the next batch, later than the quickest by more than HELD_MS, means poll", () => {
    const late = heldBack();
    expect(late(0, 900)).toBe(false); // first batch: ping + start of the replay, 0.9 s after it was sent
    expect(late(2000, 2000 + 900 + HELD_MS)).toBe(false); // exactly HELD_MS later: not yet
    expect(late(4000, 4000 + 900 + HELD_MS + 1)).toBe(true);
  });
  it("reads HQ's clock from a ping, and nothing from an old HQ's or a broken one", () => {
    expect(pingTime('{"t":1793754438000}')).toBe(1793754438000);
    expect(pingTime("{}")).toBeNull();
    expect(pingTime('{"t":"1"}')).toBeNull();
    expect(pingTime("{")).toBeNull();
    expect(pingTime("null")).toBeNull();
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

describe("keys typed through the link", () => {
  /** A send whose replies the test releases one by one, like POSTs through a slow tunnel. */
  function slowSend(ok = () => true) {
    const sent: string[] = [];
    const release: (() => void)[] = [];
    const send = (data: string) =>
      new Promise<boolean>((r) => {
        sent.push(data);
        release.push(() => r(ok()));
      });
    const next = async () => {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { send, sent, next };
  }
  it("go in typed order, one request at a time, keys typed meanwhile batched into the next", async () => {
    const s = slowSend();
    const keys = keyQueue(s.send, () => {});
    for (const ch of "the quick") keys(ch);
    expect(s.sent).toEqual(["t"]);
    await s.next();
    expect(s.sent).toEqual(["t", "he quick"]);
    await s.next();
    expect(s.sent.join("")).toBe("the quick");
  });
  it("never sends more than the terminal accepts, nor splits an emoji", async () => {
    const s = slowSend();
    const keys = keyQueue(s.send, () => {});
    keys("a");
    keys("x".repeat(MAX_KEYS - 1) + "😀" + "y");
    await s.next();
    await s.next();
    await s.next();
    expect(s.sent.slice(1).map((d) => d.length)).toEqual([MAX_KEYS - 1, 3]);
    expect(s.sent.join("")).toBe("a" + "x".repeat(MAX_KEYS - 1) + "😀y");
  });
  it("keys the terminal refused are dropped and reported, not retried into a new terminal", async () => {
    let ok = true;
    const s = slowSend(() => ok);
    const fails: number[] = [];
    const keys = keyQueue(s.send, () => fails.push(1));
    keys("a");
    keys("b");
    ok = false;
    await s.next();
    expect(fails).toHaveLength(1);
    expect(s.sent).toEqual(["a"]);
    keys("c");
    expect(s.sent).toEqual(["a", "c"]);
  });
});
