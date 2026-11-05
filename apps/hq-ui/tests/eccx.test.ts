import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eccxExample, eccxFlags, eccxLine, eccxMessage, eccxReaches } from "@/lib/eccx";
import { listEccx, parseEccxHead } from "@/lib/server/eccx";
import { tempHome } from "./helpers";

// The real generated files (scripts/eccx-gen.py): Claude Code's under assets/claude/commands, omp's under assets/eccx.
const REPO = path.resolve(__dirname, "..", "..", "..");
const CC = path.join(REPO, "assets", "claude", "commands");
const OMP = path.join(REPO, "assets", "eccx");

function install(home: string, files: { cc?: string[]; omp?: string[] }) {
  const cc = path.join(home, ".claude", "commands");
  const omp = path.join(home, ".omp", "agent", "commands");
  fs.mkdirSync(cc, { recursive: true });
  fs.mkdirSync(omp, { recursive: true });
  for (const f of files.cc ?? []) fs.copyFileSync(path.join(CC, f), path.join(cc, f));
  for (const f of files.omp ?? []) fs.copyFileSync(path.join(OMP, f), path.join(omp, f));
  fs.writeFileSync(path.join(cc, "ship.md"), "---\ndescription: not eccx\n---\n");
}

describe("eccx commands on the Vòng lặp tab", () => {
  it("parses the generated heads: hint, title, scope", () => {
    const loop = parseEccxHead(fs.readFileSync(path.join(CC, "eccx-loop-frontend.md"), "utf8"));
    expect(loop).toEqual({ hint: "<goal> [--max-iter 8] [--max-min 90] [--no-release] [--dry-run]", title: "Frontend", scope: null });
    const plan = parseEccxHead(fs.readFileSync(path.join(CC, "eccx-ads.md"), "utf8"));
    expect(plan.title).toBe("Ads & Marketing");
    expect(plan.scope).toBe("campaigns, ads, social, SEO, brand, content distribution, lead gen");
    // A note sentence after the scope (backend's Rust note) is not part of it; ".NET" stays whole.
    expect(parseEccxHead(fs.readFileSync(path.join(CC, "eccx-backend.md"), "utf8")).scope).toBe("APIs, databases, infra, deploy, Node/.NET/PHP, Encore/Eino, Rust");
  });

  it("lists loops first, merges engines, a loop takes its category's scope; other commands are left out", () => {
    const home = tempHome();
    install(home, {
      cc: ["eccx-loop-frontend.md", "eccx-loop-ads.md", "eccx-frontend.md", "eccx-ads.md", "eccx-clear.md"],
      omp: ["eccx-frontend.md", "eccx-clear.md"],
    });
    const list = listEccx(home);
    expect(list.map((c) => [c.name, c.kind, c.engines.join("+")])).toEqual([
      ["eccx-loop-ads", "loop", "claude"],
      ["eccx-loop-frontend", "loop", "claude"],
      ["eccx-ads", "plan", "claude"],
      ["eccx-frontend", "plan", "claude+omp"],
      ["eccx-clear", "util", "claude+omp"],
    ]);
    const loop = list[1];
    expect(loop).toMatchObject({ cat: "frontend", title: "Frontend", scope: "UI, design systems, React/Vue/Next, a11y, motion, web quality" });
    expect(loop.description).toMatch(/^Loop \/eccx-frontend on a goal/);
    expect(listEccx(path.join(home, "none"))).toEqual([]);
  });

  it("example line, flags and the Vietnamese one-liner", () => {
    const home = tempHome();
    install(home, { cc: ["eccx-loop-frontend.md", "eccx-frontend.md", "eccx-clear.md"] });
    const [loop, plan, clear] = listEccx(home);
    expect(eccxExample(loop)).toBe("/eccx-loop-frontend <mục tiêu>");
    expect(eccxFlags(loop.hint)).toBe("[--max-iter 8] [--max-min 90] [--no-release] [--dry-run]");
    expect(eccxExample(plan)).toBe("/eccx-frontend <mục tiêu>");
    expect(eccxExample(clear)).toBe("/eccx-clear <slug>|all");
    expect(eccxLine(loop)).toContain("Lặp /eccx-frontend tới khi mọi tiêu chí xanh");
    expect(eccxLine(plan)).toContain("kế hoạch Frontend");
  });

  it("who can run it, and the text sent: a slash typed into a terminal, a pointer to the file through the inbox", () => {
    expect(eccxReaches({ engines: ["claude"] }, "ccc")).toBe(true);
    expect(eccxReaches({ engines: ["claude"] }, "omp")).toBe(false);
    expect(eccxReaches({ engines: ["claude", "omp"] }, "omp")).toBe(true);
    expect(eccxMessage("eccx-loop-frontend", "  trang giá\n chạy mượt ", { delivery: "terminal", engine: "ccc" })).toBe("/eccx-loop-frontend trang giá chạy mượt");
    expect(eccxMessage("eccx-loop-frontend", "trang giá", { delivery: "inbox", engine: "ccc" })).toBe(
      '/eccx-loop-frontend trang giá\n(Lệnh slash tới qua inbox nên không tự chạy: đọc ~/.claude/commands/eccx-loop-frontend.md và làm theo, $ARGUMENTS = "trang giá".)',
    );
    expect(eccxMessage("eccx-frontend", "x", { delivery: "inbox", engine: "omp" })).toContain("~/.omp/agent/commands/eccx-frontend.md");
  });
});
