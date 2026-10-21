import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTO_IDLE_MS, autoCandidates, findings, GB, MB, withoutDirs, type ProjectDisk } from "@/lib/disk";
import { cleanIdleBuild, names, purgeTrash, trashDir } from "@/lib/server/disk-clean";

const disk = (o: Partial<ProjectDisk> = {}): ProjectDisk => ({
  root: "C:/p/shop",
  name: "shop",
  total: 0,
  entries: [],
  git: null,
  worktrees: null,
  evidence: [],
  nodeModules: [],
  build: [],
  uploads: null,
  tracked: [],
  truncated: false,
  error: null,
  at: 0,
  ms: 10,
  ...o,
});

describe("autoCandidates: only a card worktree's flagged target/.next", () => {
  it("leaves the repo's own build output, other build dirs and small ones to a room", () => {
    const p = disk({
      build: [
        { path: ".claude/worktrees/card-15/target", bytes: 49 * GB },
        { path: ".claude/worktrees/card-2/.next", bytes: 2 * GB },
        { path: ".claude/worktrees/card-3/target", bytes: 900 * MB },
        { path: ".claude/worktrees/card-4/dist", bytes: 5 * GB },
        { path: ".claude/worktrees/card-5/apps/web/.next", bytes: 5 * GB },
        { path: "target", bytes: 30 * GB },
      ],
    });
    expect(autoCandidates(p).map((b) => b.path)).toEqual([".claude/worktrees/card-15/target", ".claude/worktrees/card-2/.next"]);
  });

  it("withoutDirs drops what went from the sizes, so its findings go too", () => {
    const p = disk({
      total: 60 * GB,
      entries: [{ path: ".claude", bytes: 52 * GB, dir: true }, { path: "src", bytes: 8 * GB, dir: true }],
      worktrees: { n: 3, bytes: 52 * GB },
      build: [{ path: ".claude/worktrees/card-15/target", bytes: 49 * GB }, { path: "target", bytes: 2 * GB }],
    });
    const after = withoutDirs(p, autoCandidates(p));
    expect(after.total).toBe(11 * GB);
    expect(after.entries[0].bytes).toBe(3 * GB);
    expect(after.worktrees).toEqual({ n: 3, bytes: 3 * GB });
    expect(findings(after, 0).map((f) => f.path)).not.toContain(".claude/worktrees/card-15/target");
    expect(findings(after, 0).map((f) => f.path)).toContain("target");
  });
});

describe("cleanIdleBuild on a real folder", () => {
  const NOW = Date.now();
  const old = (NOW - 2 * AUTO_IDLE_MS) / 1000;

  /** `<root>/.claude/worktrees/<wt>/target/debug/deps/x`, every folder last written `at` (seconds). */
  function target(root: string, wt: string, at: number): string {
    const t = path.join(root, ".claude", "worktrees", wt, "target");
    const deps = path.join(t, "debug", "deps");
    fs.mkdirSync(deps, { recursive: true });
    fs.writeFileSync(path.join(deps, "libx.rlib"), "x");
    for (const d of [deps, path.dirname(deps), t]) fs.utimesSync(d, at, at);
    return t;
  }

  it("a process naming the worktree keeps it, whatever its slashes or case; card-1 is not card-13", () => {
    const wt = "C:/Users/P/zus/ide/.claude/worktrees/card-1";
    expect(names('"C:\\USERS\\P\\zus\\ide\\.claude\\worktrees\\card-1\\node_modules\\next\\dist\\bin\\next" start', wt)).toBe(true);
    expect(names("c:/users/p/zus/ide/.claude/worktrees/card-1", wt)).toBe(true);
    expect(names("cargo build --manifest-path C:/Users/P/zus/ide/.claude/worktrees/card-13/Cargo.toml", wt)).toBe(false);
    expect(names("rustc --out-dir C:\\Users\\P\\zus\\ide\\.claude\\worktrees\\card-13\\target C:/Users/P/zus/ide/.claude/worktrees/card-1 x", wt)).toBe(true);
  });

  it("removes an idle worktree's target; keeps one built recently and one a room sits in", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-clean-"));
    try {
      const idle = target(root, "card-13", old);
      const recent = target(root, "card-15", old);
      fs.utimesSync(path.join(recent, "debug", "deps"), NOW / 1000, NOW / 1000); // a build just wrote here
      const roomIn = target(root, "card-16", old);
      fs.mkdirSync(path.join(trashDir(root), "123-card-9-target", "debug"), { recursive: true }); // left by a stopped HQ
      const big = (wt: string) => ({ path: `.claude/worktrees/${wt}/target`, bytes: 5 * GB });
      const procIn = target(root, "card-17", old);
      const busy = async () => [path.join(root, ".claude", "worktrees", "card-16", "crates"), `node ${path.join(root, ".claude", "worktrees", "card-17", "node_modules", "vite", "bin", "vite.js")} preview`];
      const r = await cleanIdleBuild({ root, build: [big("card-13"), big("card-15"), big("card-16"), big("card-17")] }, busy, NOW);
      expect(r?.cleaned).toEqual({ at: NOW, bytes: 5 * GB, dirs: [".claude/worktrees/card-13/target"] });
      expect(fs.existsSync(idle)).toBe(false);
      expect(fs.existsSync(recent)).toBe(true);
      expect(fs.existsSync(roomIn)).toBe(true);
      expect(fs.existsSync(procIn)).toBe(true);
      await purgeTrash(root);
      // Deleted, the stopped HQ's leftover too; the trash stays git-ignored.
      expect(fs.readdirSync(trashDir(root))).toEqual([".gitignore"]);
      expect(fs.readFileSync(path.join(trashDir(root), ".gitignore"), "utf8")).toContain("*");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes nothing when the room folders cannot be read", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-clean-"));
    try {
      const idle = target(root, "card-13", old);
      const r = await cleanIdleBuild({ root, build: [{ path: ".claude/worktrees/card-13/target", bytes: 5 * GB }] }, () => Promise.reject(new Error("no office")), NOW);
      expect(r).toBeNull();
      expect(fs.existsSync(idle)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
