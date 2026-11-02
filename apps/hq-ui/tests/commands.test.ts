import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyCommand, filterCommands, slashAt, type SlashCommand } from "@/lib/mention";
import { commandDescription, listCommands } from "@/lib/server/commands";
import { tempHome } from "./helpers";

describe("slash commands (GET /api/commands)", () => {
  it("description: frontmatter first (quotes dropped), else the first prose line", () => {
    expect(commandDescription('---\nname: x\ndescription: "Ship it"\n---\n# Title\n')).toBe("Ship it");
    expect(commandDescription("---\r\ndescription: Plan work\r\n---\r\nbody")).toBe("Plan work");
    expect(commandDescription("---\nallowed-tools: Bash\n---\n\n# Review the diff\nmore")).toBe("Review the diff");
    expect(commandDescription("\uFEFFJust text\n")).toBe("Just text");
    expect(commandDescription("")).toBe("");
    expect(commandDescription(`---\ndescription: ${"x".repeat(400)}\n---\n`)).toHaveLength(160);
  });

  it("reads ~/.omp/agent/commands and ~/.claude/commands, name = file name, omp first", () => {
    const home = tempHome();
    const omp = path.join(home, ".omp", "agent", "commands");
    const claude = path.join(home, ".claude", "commands");
    fs.mkdirSync(omp, { recursive: true });
    fs.mkdirSync(path.join(claude, "nested"), { recursive: true });
    fs.writeFileSync(path.join(omp, "ship.md"), "---\ndescription: Ship\n---\n");
    fs.writeFileSync(path.join(omp, "notes.txt"), "x");
    fs.writeFileSync(path.join(claude, "review.md"), "# Review\n");
    fs.writeFileSync(path.join(claude, "bad name.md"), "x");
    expect(listCommands(home)).toEqual([
      { name: "ship", description: "Ship", source: "omp" },
      { name: "review", description: "Review", source: "claude" },
    ]);
    expect(listCommands(path.join(home, "none"))).toEqual([]);
  });
});

describe("composer '/' autocomplete", () => {
  const cmds: SlashCommand[] = [
    { name: "review", description: "", source: "claude" },
    { name: "plan", description: "", source: "omp" },
    { name: "code-review", description: "", source: "claude" },
  ];

  it("a '/' at the start of a line, up to the caret, with no space", () => {
    expect(slashAt("/rev", 4)).toEqual({ start: 0, end: 4, prefix: "rev" });
    expect(slashAt("hi\n/", 4)).toEqual({ start: 3, end: 4, prefix: "" });
    expect(slashAt("a /rev", 6)).toBeNull();
    expect(slashAt("/rev x", 6)).toBeNull();
    expect(slashAt("path/to", 7)).toBeNull();
  });

  it("matches name prefix first, then substring, case-insensitive", () => {
    expect(filterCommands(cmds, "rev").map((c) => c.name)).toEqual(["review", "code-review"]);
    expect(filterCommands(cmds, "").map((c) => c.name)).toEqual(["review", "plan", "code-review"]);
    expect(filterCommands(cmds, "PL").map((c) => c.name)).toEqual(["plan"]);
    expect(filterCommands(cmds, "zzz")).toEqual([]);
  });

  it("puts '/name ' in place of the token", () => {
    expect(applyCommand("/rev", { start: 0, end: 4, prefix: "rev" }, cmds[0])).toEqual({ text: "/review ", caret: 8 });
    expect(applyCommand("x\n/p tail", { start: 2, end: 4, prefix: "p" }, cmds[1])).toEqual({ text: "x\n/plan tail", caret: 7 });
  });
});
