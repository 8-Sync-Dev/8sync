import { describe, expect, it } from "vitest";
import { GUIDE_LEGEND, GUIDE_STEPS, GUIDE_TIPS } from "@/components/hq/guide";

const text = GUIDE_STEPS.map((s) => `${s.title} ${s.body}`).join("\n");

describe("guide", () => {
  it("has 6 steps with titles and bodies", () => {
    expect(GUIDE_STEPS).toHaveLength(6);
    for (const s of GUIDE_STEPS) expect(s.title && s.body).toBeTruthy();
  });
  it("says the CLI only switches things on and off", () => {
    for (const s of ["8sync ccc auto on [--omp]", "8sync hq ui [--public]", "Đội omp"]) expect(text).toContain(s);
  });
  it("names every model", () => {
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) expect(text).toContain(m);
  });
  it("contains Giao việc", () => {
    expect(text).toContain("Giao việc");
  });
  it("walks the team flow as it is: open team, cards, priority, 60 s rule, Ship stays with the owner, update", () => {
    for (const s of ["Mở team", "Team đầy đủ", "Board", "P0", "5 giây", "Ship", "Dọn & mở lại", "Dừng team", "Nhật ký"]) expect(text).toContain(s);
    expect(text).not.toContain("tạo nhân viên");
  });
  it("has the 5-status legend and tips", () => {
    expect(GUIDE_LEGEND.map((l) => l.label)).toEqual(["Đang làm", "Cần bạn", "Chờ review", "Xong", "Rảnh"]);
    expect(GUIDE_TIPS.join(" ")).toMatch(/\/do.*\/ship-loop.*Haiku/);
  });
});
