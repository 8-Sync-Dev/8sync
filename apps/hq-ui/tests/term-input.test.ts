import { describe, expect, it } from "vitest";
import { lineBytes } from "@/lib/term-input";

describe("lineBytes", () => {
  it("sends one line, or an empty box, followed by Enter", () => {
    expect(lineBytes("git status", true)).toBe("git status\r");
    expect(lineBytes("", false)).toBe("\r");
    expect(lineBytes("2\n\n", true)).toBe("2\r");
  });

  it("wraps several lines in one bracketed paste when the terminal asked for it", () => {
    expect(lineBytes("first\r\nsecond\nthird", true)).toBe("\x1b[200~first\rsecond\rthird\x1b[201~\r");
  });

  it("keeps a typed paste-end marker from closing the paste early", () => {
    expect(lineBytes("a\n\x1b[201~rm -rf x", true)).toBe("\x1b[200~a\rrm -rf x\x1b[201~\r");
  });

  it("sends each line with its own Enter when bracketed paste is off, like a plain paste", () => {
    expect(lineBytes("cd x\r\nls\n", false)).toBe("cd x\rls\r");
  });
});
