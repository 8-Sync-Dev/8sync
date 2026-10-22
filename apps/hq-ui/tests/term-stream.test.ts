import { describe, expect, it } from "vitest";
import { afterStream } from "@/lib/term-stream";

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
