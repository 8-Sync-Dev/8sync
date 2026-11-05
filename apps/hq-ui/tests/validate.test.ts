import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clampText, isTmuxName, toTmuxName, validateProjectPath } from "@/lib/server/validate";

describe("tmux name validation", () => {
  it("accepts bare and prefixed names", () => {
    expect(toTmuxName("api")).toEqual({ ok: true, value: "hq-api" });
    expect(toTmuxName("hq-be-2")).toEqual({ ok: true, value: "hq-be-2" });
  });
  it.each(["", "API", "a b", "a;rm -rf /", "$(id)", "a".repeat(33), "hq-", "x:y", "../x", "-t"])(
    "rejects %j",
    (n) => expect(toTmuxName(n).ok).toBe(false),
  );
  it("rejects non-strings", () => {
    expect(toTmuxName(42).ok).toBe(false);
    expect(isTmuxName(null)).toBe(false);
  });
  it("isTmuxName needs the hq- prefix", () => {
    expect(isTmuxName("hq-a")).toBe(true);
    expect(isTmuxName("a")).toBe(false);
    expect(isTmuxName("hq-a;b")).toBe(false);
  });
});

describe("project path validation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-path-"));
  const file = path.join(dir, "f.txt");
  fs.writeFileSync(file, "x");

  it("accepts an existing absolute directory, canonicalised", () => {
    expect(validateProjectPath(dir)).toEqual({ ok: true, value: fs.realpathSync(dir) });
  });
  it.each([
    ["", "required"],
    ["relative/dir", "absolute"],
    [`${dir}/../x`, ".."],
    [path.join(dir, "nope"), "does not exist"],
    [file, "not a directory"],
    ["/tmp/\0x", "invalid"],
  ])("rejects %j", (p, msg) => {
    const r = validateProjectPath(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });
  it("rejects non-strings", () => expect(validateProjectPath({}).ok).toBe(false));

  it.each(["\\\\server\\share\\repo", "//server/share/repo", "\\\\?\\C:\\repo", "\\\\.\\pipe\\x", "\\\\?\\UNC\\server\\share"])("refuses the network or device path %j before touching it", (p) => {
    const spy = vi.spyOn(fs, "realpathSync");
    const r = validateProjectPath(p);
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses a filesystem root, the home folder itself and a link to either; takes a folder inside home", () => {
    const savedHome = process.env.HOME;
    const savedProfile = process.env.USERPROFILE;
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-home-")));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      const root = path.parse(process.cwd()).root;
      expect(validateProjectPath(root).ok).toBe(false);
      if (process.platform === "win32") expect(validateProjectPath(root.replace(/\\$/, "")).ok).toBe(false);
      expect(validateProjectPath(home).ok).toBe(false);
      expect(validateProjectPath(`${home}${path.sep}`).ok).toBe(false);
      if (process.platform === "win32") expect(validateProjectPath(home.toUpperCase()).ok).toBe(false);
      fs.mkdirSync(path.join(home, "repo"));
      expect(validateProjectPath(path.join(home, "repo"))).toEqual({ ok: true, value: path.join(home, "repo") });
      const links = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-links-")));
      fs.symlinkSync(home, path.join(links, "to-home"), "junction");
      fs.symlinkSync(root, path.join(links, "to-root"), "junction");
      expect(validateProjectPath(path.join(links, "to-home")).ok).toBe(false);
      expect(validateProjectPath(path.join(links, "to-root")).ok).toBe(false);
    } finally {
      for (const [k, v] of [["HOME", savedHome], ["USERPROFILE", savedProfile]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("clampText", () => {
  it("trims, rejects empty, caps on a char boundary", () => {
    expect(clampText("  hi ")).toEqual({ ok: true, value: "hi" });
    expect(clampText("   ").ok).toBe(false);
    const r = clampText("😀".repeat(10), 3);
    expect(r).toEqual({ ok: true, value: "😀😀😀" });
  });
});
