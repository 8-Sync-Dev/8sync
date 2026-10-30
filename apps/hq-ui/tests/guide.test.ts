import { describe, expect, it } from "vitest";
import { GUIDE_LEGEND, GUIDE_STEPS, GUIDE_TIPS } from "@/components/hq/guide";

const text = GUIDE_STEPS.map((s) => `${s.title} ${s.body}`).join("\n");

describe("guide", () => {
  it("has 6 steps with titles and bodies", () => {
    expect(GUIDE_STEPS).toHaveLength(6);
    for (const s of GUIDE_STEPS) expect(s.title && s.body).toBeTruthy();
  });
  it("rooms are the owner's own sessions: HQ opens none, no board or team", () => {
    for (const s of ["HQ không tự mở phòng nào", "8sync hq ui [--public]", "Nhật ký"]) expect(text).toContain(s);
    expect(text).not.toMatch(/ccc auto|Board|card|Mở team|Giao việc|critic|Sấm Sét/);
  });
  it("has the 3-status legend and tips", () => {
    expect(GUIDE_LEGEND.map((l) => l.label)).toEqual(["Đang làm", "Cần bạn", "Rảnh"]);
    expect(GUIDE_TIPS.join(" ")).toMatch(/\/do.*\/ship-loop.*Haiku/);
  });
});
