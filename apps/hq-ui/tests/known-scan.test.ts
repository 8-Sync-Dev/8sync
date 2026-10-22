import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanBases, scanRepos } from "@/lib/server/known-projects";

describe("Dự án trên máy: repos found on disk", () => {
  it("finds repo roots, nested ones too, skipping dependencies and hidden folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-scan-"));
    try {
      const mk = (...p: string[]) => fs.mkdirSync(path.join(root, ...p), { recursive: true });
      mk("a", ".git");
      mk("a", "sub", "inner", ".git");
      mk("group", "b", ".git");
      mk("node_modules", "dep", ".git");
      mk(".hidden", "c", ".git");
      mk("deep", "1", "2", "3", "4", "5", ".git");
      fs.writeFileSync(path.join(root, "group", "wt"), "");
      mk("group", "wt2");
      fs.writeFileSync(path.join(root, "group", "wt2", ".git"), "gitdir: x");
      const found = scanRepos([root, path.join(root, "group")], 4).map((p) => path.relative(root, p).replace(/\\/g, "/")).sort();
      expect(found).toEqual(["a", "a/sub/inner", "group/b", "group/wt2"]);
      expect(scanRepos([root], 4, 2)).toHaveLength(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("scans the parents of known repos, never a drive root or the home folder", () => {
    const home = "C:/Users/Admin";
    expect(scanBases(["C:/Users/Projects/su-code", "C:/Users/Projects/tools/x", "C:/repo", "C:/Users/Admin/code-a"], home)).toEqual(["C:/Users/Projects", "C:/Users/Projects/tools"]);
    expect(scanBases(["/home/me/x"], "/home/me")).toEqual([]);
  });
});
