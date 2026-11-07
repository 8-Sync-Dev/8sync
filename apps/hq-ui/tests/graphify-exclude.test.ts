import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { excludeGraphifyOut } from "@/lib/server/graphify";

const dirs: string[] = [];
const temp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hq-gfx-"));
  dirs.push(d);
  return d;
};
const repo = () => {
  const d = temp();
  execFileSync("git", ["init", "-q", d], { windowsHide: true });
  return d;
};
const exclude = (d: string) => path.join(d, ".git", "info", "exclude");
const lines = (d: string) => fs.readFileSync(exclude(d), "utf8").split(/\r?\n/).filter((l) => l === "graphify-out/").length;

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("excludeGraphifyOut", () => {
  it("not ignored → one graphify-out/ line in info/exclude, and a second call adds nothing", async () => {
    const d = repo();
    const before = fs.existsSync(exclude(d)) ? fs.readFileSync(exclude(d), "utf8") : "";
    expect(await excludeGraphifyOut(d)).toBe(true);
    const after = fs.readFileSync(exclude(d), "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after.endsWith("graphify-out/\n")).toBe(true);
    expect(lines(d)).toBe(1);
    expect(await excludeGraphifyOut(d)).toBe(false);
    expect(lines(d)).toBe(1);
    expect(execFileSync("git", ["-C", d, "status", "--porcelain"], { windowsHide: true }).toString()).toBe("");
  });

  it("creates info/ when missing and keeps CRLF content", async () => {
    const d = repo();
    fs.rmSync(path.join(d, ".git", "info"), { recursive: true, force: true });
    expect(await excludeGraphifyOut(d)).toBe(true);
    expect(fs.readFileSync(exclude(d), "utf8")).toBe("graphify-out/\n");
    const e = repo();
    fs.writeFileSync(exclude(e), "# mine\r\n*.log");
    expect(await excludeGraphifyOut(e)).toBe(true);
    expect(fs.readFileSync(exclude(e), "utf8")).toBe("# mine\r\n*.log\r\ngraphify-out/\r\n");
  });

  it(".gitignore already has graphify-out/ → exclude unchanged", async () => {
    const d = repo();
    fs.writeFileSync(path.join(d, ".gitignore"), "graphify-out/\n");
    const before = fs.existsSync(exclude(d)) ? fs.readFileSync(exclude(d), "utf8") : null;
    expect(await excludeGraphifyOut(d)).toBe(false);
    expect(fs.existsSync(exclude(d)) ? fs.readFileSync(exclude(d), "utf8") : null).toBe(before);
  });

  it("not a git repo → no throw, nothing written", async () => {
    const d = temp();
    expect(await excludeGraphifyOut(d)).toBe(false);
    expect(fs.readdirSync(d)).toEqual([]);
  });
});
