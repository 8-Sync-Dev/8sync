import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTO_IDLE_MS, autoCandidates, findings, GB, keptText, MB, PRUNE_IDLE_MS, sendable, withoutDirs, type Finding, type ProjectDisk } from "@/lib/disk";
import { cleanIdleBuild, names, parseWorktrees, pruneWorktrees, purgeTrash, trashDir } from "@/lib/server/disk-clean";

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

describe("autoCandidates: a card worktree's flagged target/.next, at any depth", () => {
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
    expect(autoCandidates(p).map((b) => b.path)).toEqual([".claude/worktrees/card-15/target", ".claude/worktrees/card-2/.next", ".claude/worktrees/card-5/apps/web/.next"]);
  });

  it("the cleanup mail leaves out the build dirs HQ kept as in use", () => {
    const f = (path: string): Finding => ({ id: `dir:${path}`, severity: "high", path, bytes: 49 * GB, why: "x" });
    const p = { findings: [f(".claude/worktrees/card-15/target"), f(".git")], inUse: [".claude/worktrees/card-15/target"] };
    expect(sendable(p).map((x) => x.path)).toEqual([".git"]);
    expect(sendable({ findings: p.findings }).map((x) => x.path)).toHaveLength(2);
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

  it("the worktrees finding says why HQ kept what it did not prune", () => {
    const p = disk({ worktrees: { n: 21, bytes: GB }, wtKept: { n: 21, busy: 5, recent: 0, open: 14, dirty: 2, failed: 0 } });
    expect(findings(p, 0).find((f) => f.id === "worktrees")?.why).toBe("21 worktree (ngưỡng 10) · HQ giữ 21: 5 đang dùng, 14 chưa merge/đóng, 2 chưa commit");
    expect(keptText({ n: 3, busy: 0, recent: 0, open: 0, dirty: 0, failed: 0 })).toBe("");
  });
});

describe("cleanIdleBuild on a real folder", () => {
  const NOW = Date.now();
  const old = (NOW - 2 * AUTO_IDLE_MS) / 1000;

  /** `<root>/.claude/worktrees/<wt>/<sub>/target/debug/deps/x` beside a Cargo.toml, every folder last written `at` (seconds). */
  function target(root: string, wt: string, at: number, sub = "", cargo = true): string {
    const t = path.join(root, ".claude", "worktrees", wt, sub, "target");
    const deps = path.join(t, "debug", "deps");
    fs.mkdirSync(deps, { recursive: true });
    fs.writeFileSync(path.join(deps, "libx.rlib"), "x");
    if (cargo) fs.writeFileSync(path.join(path.dirname(t), "Cargo.toml"), "[package]\n");
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
      expect(r.cleaned).toEqual({ at: NOW, bytes: 5 * GB, dirs: [".claude/worktrees/card-13/target"] });
      expect(r.kept).toEqual([".claude/worktrees/card-15/target", ".claude/worktrees/card-16/target", ".claude/worktrees/card-17/target"]);
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
      expect(r.cleaned).toBeNull();
      expect(r.kept).toEqual([".claude/worktrees/card-13/target"]); // unknown use: not mailed to a room either
      expect(fs.existsSync(idle)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("a nested target (src-tauri) goes; a process at the worktree root keeps it; a source folder named target never goes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-clean-"));
    try {
      const tauri = target(root, "card-3", old, "src-tauri");
      const served = target(root, "card-4", old, "src-tauri");
      const source = target(root, "card-6", old, path.join("src", "compiler"), false);
      const busy = async () => [`node ${path.join(root, ".claude", "worktrees", "card-4", "node_modules", ".bin", "tauri")} dev`];
      const big = (p: string) => ({ path: p, bytes: 5 * GB });
      const r = await cleanIdleBuild(
        { root, build: [big(".claude/worktrees/card-3/src-tauri/target"), big(".claude/worktrees/card-4/src-tauri/target"), big(".claude/worktrees/card-6/src/compiler/target")] },
        busy,
        NOW,
      );
      expect(r.cleaned?.dirs).toEqual([".claude/worktrees/card-3/src-tauri/target"]);
      expect(r.kept).toEqual([".claude/worktrees/card-4/src-tauri/target"]);
      expect(fs.existsSync(tauri)).toBe(false);
      expect(fs.existsSync(served)).toBe(true);
      expect(fs.existsSync(source)).toBe(true);
      await purgeTrash(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("pruneWorktrees on a real repo", () => {
  const NOW = Date.now();
  const old = (NOW - 2 * PRUNE_IDLE_MS) / 1000;
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } }).toString();
  const wtOf = (root: string, name: string) => path.join(root, ".claude", "worktrees", name);

  /** A card worktree on its own branch off main, with `commits` extra commits, every top-level entry last written `at`. */
  function worktree(root: string, name: string, at: number, commits = 0): string {
    const wt = wtOf(root, name);
    sh(root, "worktree", "add", "-b", `${name}-work`, wt, "main");
    for (let i = 0; i < commits; i++) {
      fs.writeFileSync(path.join(wt, `${name}-${i}.txt`), "x");
      sh(wt, "add", "-A");
      sh(wt, "commit", "-q", "-m", `${name} ${i}`);
    }
    for (const e of [wt, ...fs.readdirSync(wt).map((n) => path.join(wt, n))]) fs.utimesSync(e, at, at);
    return wt;
  }

  it("parses `worktree list --porcelain`, branch or detached", () => {
    const out = "worktree C:/p/repo\nHEAD aaa\nbranch refs/heads/main\n\nworktree C:/p/repo/.claude/worktrees/card-1\nHEAD bbb\ndetached\n\nworktree C:/p/repo/.claude/worktrees/card-2\nHEAD ccc\nbranch refs/heads/card-2-x\nprunable gitdir file points to non-existent location\n";
    expect(parseWorktrees(out)).toEqual([
      { path: "C:/p/repo", head: "aaa", branch: "main" },
      { path: "C:/p/repo/.claude/worktrees/card-1", head: "bbb", branch: null },
      { path: "C:/p/repo/.claude/worktrees/card-2", head: "ccc", branch: "card-2-x" },
    ]);
  });

  it("removes a merged, clean, idle, unused worktree (and its branch); keeps dirty, busy, recent and unmerged ones; prunes a missing one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-prune-"));
    try {
      sh(root, "init", "-q", "-b", "main");
      fs.writeFileSync(path.join(root, "README.md"), "x");
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "init");
      const merged = worktree(root, "card-1", old, 1);
      sh(root, "merge", "-q", "--ff-only", "card-1-work");
      fs.mkdirSync(path.join(merged, "su-code", "standup"), { recursive: true }); // 8sync's meet note: not the card's work
      fs.writeFileSync(path.join(merged, "su-code", "standup", "2026-10-21.md"), "- dev: done");
      for (const e of [merged, path.join(merged, "su-code")]) fs.utimesSync(e, old, old);
      const dirty = worktree(root, "card-2", old);
      fs.writeFileSync(path.join(dirty, "scratch.txt"), "wip");
      for (const e of [dirty, path.join(dirty, "scratch.txt")]) fs.utimesSync(e, old, old);
      const busy = worktree(root, "card-3", old);
      const recent = worktree(root, "card-4", old);
      fs.utimesSync(path.join(recent, "README.md"), NOW / 1000, NOW / 1000);
      const missing = worktree(root, "card-5", old);
      fs.rmSync(missing, { recursive: true, force: true });
      const open = worktree(root, "card-6", old, 1);
      // Squash-merged: the branch's commit is no ancestor of main, but main's commit names the card.
      const squashed = worktree(root, "card-7", old, 1);
      fs.writeFileSync(path.join(root, "seven.txt"), "x");
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "feat(x): seven (card #7) (#9)");
      const used = async () => [`node ${path.join(busy, "node_modules", ".bin", "next")} dev`];
      const r = await pruneWorktrees({ root }, used, NOW, async () => new Set<number>());
      expect([r.kept, r.pruned]).toEqual([{ n: 7, busy: 1, recent: 1, open: 1, dirty: 1, failed: 0 }, { at: NOW, n: 3, names: ["card-1", "card-5", "card-7"] }]);
      expect(r.kept).toEqual({ n: 7, busy: 1, recent: 1, open: 1, dirty: 1, failed: 0 });
      expect(fs.existsSync(merged)).toBe(false);
      expect(fs.existsSync(squashed)).toBe(false);
      expect(sh(root, "branch", "--list", "card-7-work").trim()).not.toBe(""); // squash-merged: never -D
      expect(sh(root, "branch", "--list", "card-1-work").trim()).toBe(""); // merged: branch gone
      expect(sh(root, "branch", "--list", "card-5-work").trim()).not.toBe(""); // only the registration went
      for (const wt of [dirty, busy, recent, open]) expect(fs.existsSync(wt)).toBe(true);
      expect(parseWorktrees(sh(root, "worktree", "list", "--porcelain")).map((w) => path.basename(w.path))).toEqual([path.basename(root), "card-2", "card-3", "card-4", "card-6"]);
      // The board closed card-6: its unmerged work goes, the branch stays (never -D).
      const r2 = await pruneWorktrees({ root }, used, NOW, async () => new Set([6]));
      expect(r2.pruned).toEqual({ at: NOW, n: 1, names: ["card-6"] });
      expect(fs.existsSync(open)).toBe(false);
      expect(sh(root, "branch", "--list", "card-6-work").trim()).not.toBe("");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes nothing when the room folders cannot be read, and nothing outside .claude/worktrees", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-prune-"));
    try {
      sh(root, "init", "-q", "-b", "main");
      fs.writeFileSync(path.join(root, "README.md"), "x");
      sh(root, "add", "-A");
      sh(root, "commit", "-q", "-m", "init");
      const wt = worktree(root, "card-1", old);
      const elsewhere = path.join(root, "play-1");
      sh(root, "worktree", "add", "-q", "--detach", elsewhere, "main");
      const r = await pruneWorktrees({ root }, () => Promise.reject(new Error("no office")), NOW, async () => new Set<number>());
      expect(r).toEqual({ pruned: null, kept: null });
      expect(fs.existsSync(wt)).toBe(true);
      const r2 = await pruneWorktrees({ root }, async () => [], NOW, async () => new Set<number>());
      expect(r2.pruned?.names).toEqual(["card-1"]);
      expect(fs.existsSync(elsewhere)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
