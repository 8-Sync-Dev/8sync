import { describe, expect, it } from "vitest";
import { demoLinks, isVideo, viewableRow } from "@/lib/preview";

describe("Preview shows results", () => {
  it("finds real demo links in a card's notes, not GitHub, each once", () => {
    expect(
      demoLinks([
        "dev: deploy xong https://zus-landing.vercel.app/pricing.",
        "review: PR https://github.com/8-Sync-Dev/zus/pull/12 ok",
        "qa: UAT trên https://zus-landing.vercel.app/pricing, ảnh ở qa/evidence",
        null,
        "xem (http://127.0.0.1:3000/demo)",
      ]),
    ).toEqual(["https://zus-landing.vercel.app/pricing", "http://127.0.0.1:3000/demo"]);
    expect(demoLinks(["không có link"])).toEqual([]);
  });
  it("knows a video, and hides rows with nothing to look at", () => {
    expect(isVideo("qa/evidence/card-12-demo.mp4")).toBe(true);
    expect(isVideo("qa/evidence/card-12.WEBM")).toBe(true);
    expect(isVideo("qa/evidence/card-12.png")).toBe(false);
    expect(viewableRow([], [])).toBe(false);
    expect(viewableRow([], ["https://x.dev"])).toBe(true);
  });
});
