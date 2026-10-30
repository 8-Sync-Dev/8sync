import { describe, expect, it } from "vitest";
import { LABEL_MAX, roomLabel } from "@/lib/room-label";

const GOAL = "/goal Phòng `qa` (vai QA: chạy check/test/UAT của card trên nhánh PR; ảnh chụp UAT lưu `qa/evidence/card-<id>-<slug>.png`) làm việc liên tục …";

describe("roomLabel", () => {
  it("a room titled after its /goal prompt shows its room name (seen live 2026-10-18)", () => {
    expect(roomLabel(GOAL)).toBe("qa");
    expect(roomLabel("/goal Phòng `review` (vai Review: …")).toBe("review");
  });
  it("plain names stay; long ones are cut; empty falls back", () => {
    expect(roomLabel("lead")).toBe("lead");
    const long = "x".repeat(80);
    expect(roomLabel(long)).toHaveLength(LABEL_MAX);
    expect(roomLabel(long).endsWith("…")).toBe(true);
    expect(roomLabel("", "3698e3a6")).toBe("3698e3a6");
    expect(roomLabel(null, "id")).toBe("id");
  });
});
