import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { teamArgs, withTask } from "@/lib/server/team";
import { validateNewProjectPath } from "@/lib/server/validate";

describe("new project from HQ", () => {
  it("accepts a new or empty folder under an existing parent, refuses the rest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-new-"));
    try {
      expect(validateNewProjectPath(path.join(root, "app"))).toMatchObject({ ok: true });
      expect(validateNewProjectPath(path.join(root, "a", "b", "c"))).toMatchObject({ ok: true });
      fs.mkdirSync(path.join(root, "empty"));
      expect(validateNewProjectPath(path.join(root, "empty"))).toMatchObject({ ok: true });
      fs.mkdirSync(path.join(root, "full"));
      fs.writeFileSync(path.join(root, "full", "x"), "");
      expect(validateNewProjectPath(path.join(root, "full"))).toMatchObject({ ok: false });
      fs.writeFileSync(path.join(root, "file"), "");
      expect(validateNewProjectPath(path.join(root, "file"))).toMatchObject({ ok: false });
      expect(validateNewProjectPath("relative/app")).toMatchObject({ ok: false });
      expect(validateNewProjectPath(`${root}/x/../y`)).toMatchObject({ ok: false });
      expect(validateNewProjectPath(path.parse(root).root)).toMatchObject({ ok: false });
      expect(validateNewProjectPath("")).toMatchObject({ ok: false });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("gives the team its first task (the spec) only when it comes up, never as a flag", () => {
    expect(withTask(teamArgs("up"), "up", "Làm landing page")).toEqual(["ccc", "auto", "up", "Làm landing page"]);
    expect(withTask(teamArgs("full"), "full", "  spec  ")).toEqual(["ccc", "auto", "up", "--roles", "full", "spec"]);
    expect(withTask(teamArgs("down"), "down", "x")).toEqual(["ccc", "auto", "down"]);
    expect(withTask(teamArgs("up"), "up", "  ")).toEqual(["ccc", "auto", "up"]);
    expect(withTask(teamArgs("up"), "up", "--roles boost").at(-1)).toBe(" --roles boost");
  });
});
