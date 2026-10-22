import { describe, expect, it } from "vitest";
import { lessonParts, parseKnow } from "@/lib/know";

describe("knowledge tree (8sync ccc know ls --json)", () => {
  it("splits a lesson line into day, room and text", () => {
    expect(lessonParts("- 2026-10-22 [dev] gitleaks full history eats 4 GB")).toEqual({ day: "2026-10-22", room: "dev", text: "gitleaks full history eats 4 GB" });
    expect(lessonParts("- 2026-10-22 no room here")).toEqual({ day: "2026-10-22", room: null, text: "no room here" });
    expect(lessonParts("- plain")).toEqual({ day: null, room: null, text: "plain" });
  });
  it("parses the CLI JSON and degrades junk to an empty tree", () => {
    const k = parseKnow({ own: { root: "C:/code/app", lines: ["- 2026-10-22 [qa] a"] }, others: [{ root: "/srv/zus", lines: ["- 2026-10-22 b", 7] }, null], dir: "/h/know" });
    expect(k.own?.root).toBe("C:/code/app");
    expect(k.own?.lessons[0]).toEqual({ day: "2026-10-22", room: "qa", text: "a" });
    expect(k.others).toHaveLength(1);
    expect(k.others[0].lessons).toHaveLength(1);
    expect(k.dir).toBe("/h/know");
    expect(parseKnow({ own: null, others: [] })).toEqual({ shared: null, own: null, others: [], dir: null });
    expect(parseKnow("junk")).toEqual({ shared: null, own: null, others: [], dir: null });
    expect(parseKnow({ shared: { root: "Công ty", lines: ["- 2026-10-22 [lead] s"] }, own: null, others: [] }).shared?.lessons[0].text).toBe("s");
  });
});
