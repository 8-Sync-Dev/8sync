import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, HOST, nextArgs, port } from "../scripts/next.mjs";

describe("scripts/next.mjs: dev/start without a POSIX shell", () => {
  it("PORT, else HQ_UI_PORT, else 8740; empty counts as unset", () => {
    expect(port({})).toBe(DEFAULT_PORT);
    expect(port({ HQ_UI_PORT: "9000" })).toBe(9000);
    expect(port({ PORT: "8741", HQ_UI_PORT: "9000" })).toBe(8741);
    expect(port({ PORT: "", HQ_UI_PORT: "9000" })).toBe(9000);
    expect(port({ PORT: "  ", HQ_UI_PORT: "" })).toBe(DEFAULT_PORT);
    expect(port({ PORT: " 8742 " })).toBe(8742);
  });

  it("refuses what is not a port instead of falling back", () => {
    for (const bad of ["0", "65536", "80a", "-1", "8.5", "${PORT:-8740}", "123456"]) {
      expect(() => port({ PORT: bad }), bad).toThrow(/PORT=.* is not a port/);
    }
    expect(() => port({ HQ_UI_PORT: "x@evil.com" })).toThrow(/HQ_UI_PORT/);
  });

  it("always binds 127.0.0.1 and only knows dev and start", () => {
    expect(HOST).toBe("127.0.0.1");
    expect(nextArgs("dev", 8791)).toEqual(["dev", "-H", "127.0.0.1", "-p", "8791"]);
    expect(nextArgs("start", 8740)).toEqual(["start", "-H", "127.0.0.1", "-p", "8740"]);
    expect(() => nextArgs("build", 1)).toThrow(/usage/);
    expect(() => nextArgs("", 1)).toThrow(/usage/);
  });

  it("package.json scripts need no shell expansion", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [name, cmd] of Object.entries(pkg.scripts)) expect(cmd, name).not.toMatch(/\$\{|\$[A-Z_]/);
    expect(pkg.scripts.dev).toBe("node scripts/next.mjs dev");
    expect(pkg.scripts.start).toBe("node scripts/next.mjs start");
  });
});
