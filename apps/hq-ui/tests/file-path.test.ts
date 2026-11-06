import { describe, expect, it } from "vitest";
import { absFilePath, splitFilePath } from "@/lib/file-path";

describe("absFilePath", () => {
  it("takes Windows, POSIX and home paths to a file", () => {
    const docx = "C:\\Users\\Projects\\startup\\8sync-startup\\outputs\\student-task1-20261106\\Task1_Website_Architecture_and_Content_Planning.docx";
    expect(absFilePath(docx)).toBe(docx);
    expect(absFilePath("C:/Users/x/report.pdf")).toBe("C:/Users/x/report.pdf");
    expect(absFilePath("d:\\a.png")).toBe("d:\\a.png");
    expect(absFilePath("/home/me/app/src/main.ts")).toBe("/home/me/app/src/main.ts");
    expect(absFilePath("~/notes/plan.md")).toBe("~/notes/plan.md");
    expect(absFilePath("C:\\x\\.eslintrc.json")).toBe("C:\\x\\.eslintrc.json");
  });

  it("keeps spaces inside one code span, drops wrapping quotes, trailing punctuation and :line", () => {
    expect(absFilePath("C:\\My Docs\\Bản nháp 1.docx")).toBe("C:\\My Docs\\Bản nháp 1.docx");
    expect(absFilePath('  "C:\\x\\a.pdf"  ')).toBe("C:\\x\\a.pdf");
    expect(absFilePath("`/x/a.md`")).toBe("/x/a.md");
    expect(absFilePath("C:\\x\\a.pdf.")).toBe("C:\\x\\a.pdf");
    expect(absFilePath("C:\\x\\a.pdf),")).toBe("C:\\x\\a.pdf");
    expect(absFilePath("/x/a.ts:12:3")).toBe("/x/a.ts");
    expect(absFilePath("/x/a.ts:40;")).toBe("/x/a.ts");
  });

  it("leaves folders, routes, URLs, globs and prose as plain code", () => {
    for (const s of [
      "C:\\Users\\Projects",
      "C:\\Users\\Projects\\",
      "/api/files",
      "/api/files/raw",
      "/v1.2",
      "/usr/lib/libfoo.so.1",
      "https://8syncdev.com/a.pdf",
      "file:///C:/x/a.pdf",
      "\\\\server\\share\\a.pdf",
      "//cdn/a.js",
      "C:\\x\\*.md",
      "src/lib/a.ts",
      "./a.ts",
      "a.ts",
      "/x/.env",
      "cd C:\\x\\a.ts",
      "C:\\x\\a.pdf và C:\\x\\b",
      "C:\\x\\a.pdf\nC:\\x\\b.pdf",
      "",
      `C:\\${"a".repeat(1100)}.md`,
    ])
      expect(absFilePath(s), s).toBeNull();
  });
});

describe("splitFilePath", () => {
  it("splits into the folder and the file name, keeping a drive or root separator", () => {
    expect(splitFilePath("C:\\a\\b c.pdf")).toEqual({ dir: "C:\\a", name: "b c.pdf" });
    expect(splitFilePath("C:/a/b.pdf")).toEqual({ dir: "C:/a", name: "b.pdf" });
    expect(splitFilePath("C:\\b.pdf")).toEqual({ dir: "C:\\", name: "b.pdf" });
    expect(splitFilePath("/b.pdf")).toEqual({ dir: "/", name: "b.pdf" });
    expect(splitFilePath("~/b.md")).toEqual({ dir: "~/", name: "b.md" });
    expect(splitFilePath("/x/y/b.md")).toEqual({ dir: "/x/y", name: "b.md" });
  });
});
