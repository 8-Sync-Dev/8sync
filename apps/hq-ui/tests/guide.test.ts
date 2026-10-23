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
  it("walks the team flow as it is: open team, cards, priority, critic answers at once, Ship stays with the owner, update", () => {
    for (const s of ["Mở team", "Team đầy đủ", "Board", "P0", "critic (Opus) chọn ngay", "Ship", "Dọn & mở lại", "Dừng team", "Nhật ký"]) expect(text).toContain(s);
    expect(text).not.toContain("60 giây");
    expect(text).not.toContain("tạo nhân viên");
  });
  it("names the team sizes as they are: 3 Claude Code rooms by default, omp only by its switch, 5 for Sấm Sét, no 13-room team", () => {
    for (const s of ["3 phòng (lead, dev, qa)", "5 phòng (lead, dev, dev2, qa, review)", "Đội mặc định là Claude Code", "chỉ chạy khi anh bật công tắc Đội omp", "Tắt Sấm Sét dừng dev2, review"]) expect(text).toContain(s);
    expect(text).not.toMatch(/13 phòng|7 builder|Đội mặc định là omp/);
  });
  it("Ship tốc độ cao: 30 minutes by default, picked from 30 phút to 4 giờ; Sấm Sét starts the 30-minute sprint", () => {
    for (const s of ["chọn 30 phút / 1 giờ / 2 giờ / 4 giờ (mặc định 30 phút)", "kèm Ship tốc độ cao 30 phút, lease 2 giờ"]) expect(text).toContain(s);
    expect(text).not.toContain("2 giờ cả team");
  });
  it("has the 5-status legend and tips", () => {
    expect(GUIDE_LEGEND.map((l) => l.label)).toEqual(["Đang làm", "Cần bạn", "Chờ review", "Xong", "Rảnh"]);
    expect(GUIDE_TIPS.join(" ")).toMatch(/\/do.*\/ship-loop.*Haiku/);
  });
});
