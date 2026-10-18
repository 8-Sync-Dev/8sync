import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPick, filterEntries, mentionAt } from "@/lib/mention";
import { expandMentions, listDir, resolveDir } from "@/lib/server/fs-list";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tree = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hq-mention-"));
  tmps.push(d);
  fs.mkdirSync(path.join(d, "repo", "src", "ui"), { recursive: true });
  fs.mkdirSync(path.join(d, "repo", ".git"));
  fs.writeFileSync(path.join(d, "repo", "src", "app.ts"), "x");
  fs.writeFileSync(path.join(d, "repo", "README.md"), "x");
  fs.mkdirSync(path.join(d, "shared"));
  fs.writeFileSync(path.join(d, "shared", "spec.md"), "x");
  return { root: path.join(d, "repo"), outer: d };
};

describe("@path picker (owner 2026-10-18: import refs, walk out with ../)", () => {
  it("finds the @token under the caret: start of text or after a space, never inside an e-mail", () => {
    expect(mentionAt("fix @src/ap", 11)).toEqual({ start: 4, end: 11, dir: "src/", prefix: "ap" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, dir: "", prefix: "" });
    expect(mentionAt("xem @../../shared/sp", 20)).toMatchObject({ dir: "../../shared/", prefix: "sp" });
    expect(mentionAt("mail a@b.com", 12)).toBeNull();
    expect(mentionAt("@src done", 9)).toBeNull();
  });

  it("lists `..` first, then names starting with what was typed, then names containing it", () => {
    const es = [
      { name: "src", dir: true },
      { name: "README.md", dir: false },
      { name: "test-src", dir: true },
    ];
    expect(filterEntries(es, "").map((e) => e.name)).toEqual(["..", "src", "README.md", "test-src"]);
    expect(filterEntries(es, "src").map((e) => e.name)).toEqual(["src", "test-src"]);
    expect(filterEntries(es, ".").map((e) => e.name)).toEqual(["..", "README.md"]);
    expect(filterEntries(es, "x").map((e) => e.name)).toEqual([]);
  });

  it("a folder keeps the list open one level down; a file closes it with a space", () => {
    const m = mentionAt("xem @sr", 7)!;
    expect(applyPick("xem @sr", m, { name: "src", dir: true })).toEqual({ text: "xem @src/", caret: 9, open: true });
    const m2 = mentionAt("xem @src/a rồi sửa", 10)!;
    expect(applyPick("xem @src/a rồi sửa", m2, { name: "app.ts", dir: false })).toEqual({ text: "xem @src/app.ts rồi sửa", caret: 15, open: false });
    const up = mentionAt("@", 1)!;
    expect(applyPick("@", up, { name: "..", dir: true }).text).toBe("@../");
  });

  it("lists a folder (folders first, .git hidden) and walks out of the project with ../", () => {
    const { root } = tree();
    expect(listDir(resolveDir(root, "")!)).toEqual([
      { name: "src", dir: true },
      { name: "README.md", dir: false },
    ]);
    expect(listDir(resolveDir(root, "../shared/")!)).toEqual([{ name: "spec.md", dir: false }]);
    expect(resolveDir(root, "missing/")).toBeNull();
    expect(resolveDir("relative/base", "")).toBeNull();
  });

  it("the send turns each existing @path into an absolute one; unknown, e-mail and absolute stay", () => {
    const { root, outer } = tree();
    const fwd = (p: string) => p.replace(/\\/g, "/");
    const out = expandMentions("sửa @src/app.ts, đọc @../shared/spec.md và @nope.md, mail a@b.com", root);
    expect(out).toBe(`sửa @${fwd(path.join(root, "src", "app.ts"))}, đọc @${fwd(path.join(outer, "shared", "spec.md"))} và @nope.md, mail a@b.com`);
    expect(expandMentions("@src/app.ts", null)).toBe("@src/app.ts");
  });
});
