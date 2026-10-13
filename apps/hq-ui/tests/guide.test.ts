import { describe, expect, it } from "vitest";
import { GUIDE_LEGEND, GUIDE_STEPS, GUIDE_TIPS } from "@/components/hq/guide";

const text = GUIDE_STEPS.map((s) => `${s.title} ${s.body}`).join("\n");

describe("guide", () => {
  it("has 5 steps with titles and bodies", () => {
    expect(GUIDE_STEPS).toHaveLength(5);
    for (const s of GUIDE_STEPS) expect(s.title && s.body).toBeTruthy();
  });
  it("names every model", () => {
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) expect(text).toContain(m);
  });
  it("contains Giao việc", () => {
    expect(text).toContain("Giao việc");
  });
  it("has the 5-status legend and tips", () => {
    expect(GUIDE_LEGEND.map((l) => l.label)).toEqual(["Đang làm", "Cần bạn", "Chờ review", "Xong", "Rảnh"]);
    expect(GUIDE_TIPS.join(" ")).toMatch(/\/do.*\/ship-loop.*Haiku/);
  });
});
