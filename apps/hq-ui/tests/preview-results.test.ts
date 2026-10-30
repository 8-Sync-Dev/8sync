import { describe, expect, it } from "vitest";
import { isVideo } from "@/lib/preview";

describe("Preview shows results", () => {
  it("knows a video", () => {
    expect(isVideo("qa/evidence/card-12-demo.mp4")).toBe(true);
    expect(isVideo("qa/evidence/card-12.WEBM")).toBe(true);
    expect(isVideo("qa/evidence/card-12.png")).toBe(false);
  });
});
