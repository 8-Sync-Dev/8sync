import { describe, expect, it } from "vitest";
import { FILE_LINK, absFilePath, bareFileNamesIn, fileLinkPath, localLinkPath, relFilePath, remarkFileLinks, splitFilePath } from "@/lib/file-path";

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

describe("relFilePath", () => {
  it("takes a path with a folder relative to the room, not a bare name, an absolute path or prose", () => {
    expect(relFilePath("src/lib/a.ts")).toBe("src/lib/a.ts");
    expect(relFilePath("./out/clip.mp4")).toBe("./out/clip.mp4");
    expect(relFilePath("..\\out\\clip.mp4:3")).toBe("..\\out\\clip.mp4");
    for (const s of ["a.ts", "C:\\x\\a.ts", "/x/a.ts", "~/a.md", "src/lib", "npm run out/a.ts", "src/*.ts", "https://x.dev/a.js", "out/.env"]) expect(relFilePath(s), s).toBeNull();
  });
});

describe("localLinkPath", () => {
  it("turns a link to a local file into its path: file:, absolute, relative, a bare name", () => {
    expect(localLinkPath("file:///C:/Users/me/out/a%20b.mp4")).toBe("C:/Users/me/out/a b.mp4");
    expect(localLinkPath("file:///home/me/clip.webm")).toBe("/home/me/clip.webm");
    expect(localLinkPath("C:\\Users\\me\\out\\clip.mp4")).toBe("C:\\Users\\me\\out\\clip.mp4");
    expect(localLinkPath("out/clip.mp4#t=3")).toBe("out/clip.mp4");
    expect(localLinkPath("clip.mp4")).toBe("clip.mp4");
  });

  it("leaves web links, anchors, folders, drive-relative and UNC paths alone", () => {
    for (const s of ["https://8syncdev.com/a.mp4", "mailto:a@b.c", "javascript:alert(1)", "#tai-lieu", "?x=1", "out/", "C:clip.mp4", "\\\\host\\s\\a.mp4", "//cdn/a.js", "file://host/share/a.mp4", "file:///C:/x/%E0%A4%A.mp4", ""])
      expect(localLinkPath(s), s).toBeNull();
  });

  it("rewrites file links in a markdown tree to FILE_LINK and reads them back", () => {
    const file = { type: "link", url: "C:\\out\\a b.mp4", children: [] };
    const web = { type: "link", url: "https://x.dev", children: [] };
    const def = { type: "definition", url: "out/clip.mp4" };
    remarkFileLinks()({ type: "root", children: [{ type: "paragraph", children: [file, web] }, def] });
    expect(file.url.startsWith(FILE_LINK)).toBe(true);
    expect(fileLinkPath(file.url)).toBe("C:\\out\\a b.mp4");
    expect(web.url).toBe("https://x.dev");
    expect(fileLinkPath(def.url)).toBe("out/clip.mp4");
    expect(fileLinkPath("/hq-open-files?p=x")).toBeNull();
  });
});

describe("bareFileNamesIn", () => {
  it("picks file names in code spans once, never paths, versions or prose", () => {
    expect(bareFileNamesIn("Xem `clip.mp4`, `report.pdf` và lại `clip.mp4`; không lấy `out/a.mp4`, `v1.2`, `npm run build`, `.env`.")).toEqual(["clip.mp4", "report.pdf"]);
  });
});
