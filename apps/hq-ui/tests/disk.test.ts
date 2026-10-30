import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bytes, cleanupRoom, cleanupText, diskKey, findings, fingerprint, GB, LIMITS, MB, type ProjectDisk } from "@/lib/disk";
import { diskState, parseLsTree, reclaim, resetDisk, scanDisk, startScan } from "@/lib/server/disk";

const NOW = 1_800_000_000_000;

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
  at: NOW,
  ms: 10,
  ...o,
});

describe("findings: named thresholds", () => {
  it("nothing over a limit is nothing", () => {
    expect(findings(disk({ git: 900 * MB, evidence: [{ path: "qa/evidence", bytes: 20 * MB }], worktrees: { n: 10, bytes: 2 * GB }, tracked: [{ path: "a.png", bytes: 5 * MB }] }), NOW)).toEqual([]);
  });

  it("each rule, with its severity and why", () => {
    const fs = findings(
      disk({
        tracked: [{ path: "assets/hero.psd", bytes: 60 * MB }, { path: "docs/a.png", bytes: 6 * MB }],
        evidence: [{ path: "qa/evidence", bytes: 45 * MB }],
        worktrees: { n: 11, bytes: 1 * GB },
        git: 12 * GB,
        nodeModules: [{ path: "apps/web/node_modules", bytes: 1.5 * GB }],
        build: [{ path: "target", bytes: 30 * GB }],
        uploads: { n: 2, bytes: 3 * MB, oldest: NOW - LIMITS.uploadsAgeMs - 1 },
      }),
      NOW,
    );
    const by = Object.fromEntries(fs.map((f) => [f.id, f]));
    expect(by["tracked:assets/hero.psd"]).toMatchObject({ severity: "high", why: "file đã commit lớn hơn 50 MB" });
    expect(by["tracked:docs/a.png"]).toMatchObject({ severity: "warn", why: "file đã commit lớn hơn 5 MB" });
    expect(by["evidence:qa/evidence"]).toMatchObject({ severity: "warn", why: "ảnh bằng chứng hơn 20 MB" });
    expect(by.worktrees).toMatchObject({ severity: "warn", why: "11 worktree (ngưỡng 10)" });
    expect(by["dir:.git"]).toMatchObject({ severity: "high", why: "thư mục hơn 10 GB" });
    expect(by["dir:apps/web/node_modules"]).toMatchObject({ severity: "warn" });
    expect(by["dir:target"]).toMatchObject({ severity: "high" });
    expect(by.uploads).toMatchObject({ severity: "warn", path: ".claude/hq-uploads" });
    // High first, then biggest.
    expect(fs.map((f) => f.severity)).toEqual([...fs.filter((f) => f.severity === "high"), ...fs.filter((f) => f.severity === "warn")].map((f) => f.severity));
    expect(fs[0].id).toBe("dir:target");
  });

  it("fresh uploads are no leftover; worktrees over 2 GB count too", () => {
    expect(findings(disk({ uploads: { n: 1, bytes: MB, oldest: NOW - 60_000 } }), NOW)).toEqual([]);
    expect(findings(disk({ worktrees: { n: 3, bytes: 5 * GB } }), NOW)[0]).toMatchObject({ id: "worktrees", severity: "high", why: "chiếm hơn 2.0 GB" });
  });

  it("a top-level folder is flagged only when nothing inside it explains its size", () => {
    const explained = findings(disk({ entries: [{ path: "target", bytes: 30 * GB, dir: true }], build: [{ path: "target", bytes: 30 * GB }] }), NOW);
    expect(explained.map((f) => f.id)).toEqual(["dir:target"]);
    const own = findings(disk({ entries: [{ path: "models", bytes: 3 * GB, dir: true }, { path: "big.bin", bytes: 3 * GB, dir: false }] }), NOW);
    expect(own.map((f) => f.id)).toEqual(["dir:models"]);
  });

  it("the fingerprint ignores order and size, not the set", () => {
    const a = findings(disk({ git: 2 * GB, tracked: [{ path: "a.png", bytes: 6 * MB }] }), NOW);
    const b = findings(disk({ git: 3 * GB, tracked: [{ path: "a.png", bytes: 7 * MB }] }), NOW);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint([...a].reverse())).toBe(fingerprint(a));
    expect(fingerprint(findings(disk({ git: 2 * GB }), NOW))).not.toBe(fingerprint(a));
  });
});

describe("cleanupText", () => {
  it("names each finding and every safety rule, no em dash", () => {
    const p = disk({ git: 12 * GB, tracked: [{ path: "assets/hero.psd", bytes: 60 * MB }] });
    const t = cleanupText(p, findings(p, NOW));
    expect(t).toContain("Dọn dung lượng dự án shop (C:/p/shop)");
    expect(t).toContain("- [cao] .git 12 GB: thư mục hơn 10 GB");
    expect(t).toContain("- [cao] assets/hero.psd 60 MB: file đã commit lớn hơn 50 MB");
    expect(t).toMatch(/chưa commit hoặc chưa push/);
    expect(t).toMatch(/AskUserQuestion/);
    expect(t).toMatch(/git rm .*qua PR/);
    expect(t).not.toContain("—");
    expect(t.length).toBeLessThan(4000); // clampText's limit on /api/messages
  });

  it("a cut walk says ≥; a long list is capped", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.bin`, bytes: 6 * MB }));
    const p = disk({ truncated: true, tracked: many });
    const t = cleanupText(p, findings(p, NOW));
    expect(t).toContain("≥ 6 MB");
    expect(t.split("\n").filter((l) => l.startsWith("- [")).length).toBe(10);
  });
});

describe("cleanupRoom: a dev room, else any room of the project", () => {
  const room = (key: string, label: string, root = "C:/p/shop", role: string | null = null) => ({
    key,
    name: key,
    label,
    cwd: root,
    project: { root, name: path.basename(root), branch: "main" },
    delivery: "terminal" as const,
    role,
    tokens: null,
  });
  it("picks by role within the project only", () => {
    const rooms = [room("hq-qa", "qa"), room("hq-dev", "dev"), room("hq-lead", "lead"), room("hq-x", "lead", "C:/p/other")];
    expect(cleanupRoom(rooms, "C:/p/shop")?.key).toBe("hq-dev");
    expect(cleanupRoom([room("hq-qa", "qa")], "C:/p/shop")?.key).toBe("hq-qa");
    expect(cleanupRoom(rooms, "C:/p/none")).toBeNull();
  });
  it("a worktree with its own rooms is its own project (sidebar grouping), slashes and case aside", () => {
    const wt = "C:/p/shop/.claude/worktrees/card-91";
    const rooms = [room("hq-lead", "lead"), room("hq-dev", "dev", `${wt}/.claude/worktrees/card-113`)];
    expect(cleanupRoom(rooms, "C:\\P\\Shop\\")?.key).toBe("hq-lead");
    expect(cleanupRoom(rooms, wt)?.key).toBe("hq-dev");
    expect(diskKey("\\\\?\\C:\\P\\Shop\\")).toBe(diskKey("c:/p/shop"));
    expect(diskKey(wt)).not.toBe(diskKey("C:/p/shop"));
  });
});

describe("cache across scans", () => {
  const mk = (name: string, n: number) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `hq-disk-${name}-`));
    fs.writeFileSync(path.join(root, "f.bin"), Buffer.alloc(n));
    return { root, name, branch: null };
  };

  it("a scan of some projects (the loop) keeps every other project's result and its time", async () => {
    resetDisk();
    vi.useFakeTimers({ toFake: ["Date"] }); // only the clock: the walk's real fs promises still run
    try {
      const a = mk("a", 10);
      const b = mk("b", 20);
      vi.setSystemTime(NOW);
      await startScan([a, b]);
      const first = diskState([a, b]);
      expect(first.projects.map((p) => p.total).sort()).toEqual([10, 20]);
      fs.writeFileSync(path.join(a.root, "g.bin"), Buffer.alloc(5));
      vi.setSystemTime(NOW + 60_000);
      await startScan([a]);
      const after = diskState([a, b]);
      expect(after.projects.find((p) => p.name === "a")).toMatchObject({ total: 15, at: NOW + 60_000 });
      expect(after.projects.find((p) => p.name === "b")).toMatchObject({ total: 20, at: NOW });
      expect(after.at).toBe(NOW); // the oldest result, not the time of the partial scan
      expect(after.stale).toBe(false);
      expect(diskState([a]).at).toBe(NOW + 60_000);
      expect(diskState([a, b], NOW + 7 * 3600_000).stale).toBe(true); // b is over 6 h old by then
      expect(diskState([a, b, mk("c", 1)]).stale).toBe(true); // a project never measured
    } finally {
      vi.useRealTimers();
    }
  });

  it("two scans asked at once both run: the second waits, nothing is measured twice", async () => {
    resetDisk();
    const a = mk("a", 1);
    const b = mk("b", 2);
    const one = startScan([a]);
    const two = startScan([a, b]);
    expect(diskState([a, b]).scanning).toBe(true);
    await Promise.all([one, two]);
    const st = diskState([a, b]);
    expect(st.projects).toHaveLength(2);
    expect(st.scanning).toBe(false);
  });
});

describe("scan", () => {
  it("parses ls-tree -l -z, keeps blobs over the limit", () => {
    const out = ["100644 blob aaa 7340032\tassets/a b.png", "100644 blob bbb 100\tsmall.txt", "160000 commit ccc       -\tvendor/sub", "100644 blob ddd 62914560\tbig.psd", ""].join("\0");
    expect(parseLsTree(out)).toEqual([{ path: "big.psd", bytes: 62914560 }, { path: "assets/a b.png", bytes: 7340032 }]);
  });

  it("walks one project: worktrees counted, another repo and symlinks left out", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-disk-"));
    const put = (rel: string, n: number) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), Buffer.alloc(n));
    };
    put(".git/objects/pack/p.pack", 3000);
    put("src/main.rs", 100);
    put("target/debug/build/x/out.o", 5000); // `build` inside target: not a second build dir
    put("apps/web/node_modules/a/index.js", 700);
    put("apps/web/node_modules/a/node_modules/b/i.js", 300);
    put("qa/evidence/card-1.png", 400);
    put(".claude/worktrees/wt1/.git", 40);
    put(".claude/worktrees/wt1/file.txt", 60);
    put(".claude/worktrees/wt2/.git", 40);
    put(".claude/hq-uploads/0123/x.png", 50);
    put("vendor/other/.git/HEAD", 20); // a nested repo: not this project's bytes
    put("vendor/other/huge.bin", 99_999);
    put("README.md", 10);
    let linked = true;
    try {
      fs.symlinkSync(path.join(root, "target"), path.join(root, "link"), "junction");
    } catch {
      linked = false;
    }
    const d = await scanDisk({ root, name: "shop" }, NOW);
    expect(d.error).toBeNull();
    expect(d.git).toBe(3000);
    expect(d.worktrees).toEqual({ n: 2, bytes: 140 });
    expect(d.build).toEqual([{ path: "target", bytes: 5000 }]);
    expect(d.nodeModules).toEqual([{ path: "apps/web/node_modules", bytes: 1000 }]);
    expect(d.evidence).toEqual([{ path: "qa/evidence", bytes: 400 }]);
    expect(d.uploads).toMatchObject({ n: 1, bytes: 50 });
    expect(d.entries.find((e) => e.path === "vendor")).toBeUndefined();
    expect(d.entries.find((e) => e.path === "README.md")).toEqual({ path: "README.md", bytes: 10, dir: false });
    if (linked) expect(d.entries.find((e) => e.path === "link")).toBeUndefined();
    expect(d.total).toBe(3000 + 100 + 5000 + 1000 + 400 + 140 + 50 + 10);
    expect(d.truncated).toBe(false);
    expect(d.tracked).toEqual([]); // not a real git repo
  });

  it("hard links count what deleting frees: pnpm store links 0, links inside target their share", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-disk-links-"));
    const put = (rel: string, n: number) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), Buffer.alloc(n));
    };
    const link = (from: string, to: string) => {
      fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
      fs.linkSync(path.join(root, from), path.join(root, to));
    };
    put("store/blob", 9000);
    link("store/blob", "web/node_modules/.pnpm/a@1/node_modules/a/i.js");
    link("store/blob", "web/node_modules/b/x.js");
    put("web/node_modules/c/own.js", 600);
    put("target/debug/deps/app-1a2b", 4000);
    link("target/debug/deps/app-1a2b", "target/debug/app");
    const d = await scanDisk({ root, name: "linked" }, NOW);
    expect(d.nodeModules).toEqual([{ path: "web/node_modules", bytes: 600 }]);
    expect(d.build).toEqual([{ path: "target", bytes: 4000 }]);
    expect(d.total).toBe(3000 + 600 + 4000);
    expect([reclaim(10, 1, true), reclaim(10, 2, true), reclaim(10, 2, false)]).toEqual([10, 0, 5]);
  });

  it("a missing root is an error, not a throw", async () => {
    const d = await scanDisk({ root: path.join(os.tmpdir(), "hq-disk-missing-xyz"), name: "x" }, NOW);
    expect(d.error).toBe("không đọc được thư mục");
  });
});

describe("bytes", () => {
  it("reads like the rest of the Máy tab", () => {
    expect(bytes(512 * 1024)).toBe("512 KB");
    expect(bytes(10)).toBe("dưới 1 KB");
    expect(bytes(0)).toBe("dưới 1 KB");
    expect(bytes(12 * MB)).toBe("12 MB");
    expect(bytes(3.2 * GB)).toBe("3.2 GB");
    expect(bytes(30 * GB)).toBe("30 GB");
  });
});
