import { describe, expect, it } from "vitest";
import { feedProjects, filterFeed, lessonFeed, parseKnow } from "@/lib/know";

const know = parseKnow({
  shared: { root: "Công ty", lines: ["- 2026-10-20 [lead] ship từng card nhỏ"] },
  own: { root: "C:/w/platform", lines: ["- 2026-10-21 [dev] gitleaks chỉ quét nhánh", "- 2026-10-22 [qa] chạy test Windows"] },
  others: [{ root: "C:/w/ide", lines: ["- 2026-10-22 [dev] tauri build chỉ trên CI", "ghi chú không ngày"] }],
});

describe("Tri thức: one feed for every project", () => {
  it("merges every book newest first, each lesson tagged with its project", () => {
    const f = lessonFeed(know);
    expect(f.map((x) => [x.day, x.project])).toEqual([
      ["2026-10-22", "ide"],
      ["2026-10-22", "platform"],
      ["2026-10-21", "platform"],
      ["2026-10-20", "Công ty"],
      [null, "ide"],
    ]);
    expect(f[3].kind).toBe("shared");
  });
  it("filters by project and by words; lists projects with counts, company first", () => {
    const f = lessonFeed(know);
    expect(filterFeed(f, "ide", "").map((x) => x.text)).toEqual(["tauri build chỉ trên CI", "ghi chú không ngày"]);
    expect(filterFeed(f, null, "windows").map((x) => x.project)).toEqual(["platform"]);
    expect(filterFeed(f, null, "DEV ci").map((x) => x.project)).toEqual(["ide"]);
    expect(feedProjects(f)).toEqual([{ project: "Công ty", n: 1 }, { project: "ide", n: 2 }, { project: "platform", n: 2 }]);
  });
});
