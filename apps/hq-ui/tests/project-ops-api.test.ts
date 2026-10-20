import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Proc from "@/lib/server/proc";

const merged = vi.hoisted(() => vi.fn());
/** `8sync` calls (argv, cwd) and the answer each gets; git runs for real. */
const eight = vi.hoisted(() => ({ calls: [] as { args: string[]; cwd?: string; ms: number }[], answer: { ok: true, stdout: "", stderr: "" } as { ok: boolean; stdout: string; stderr: string; killed?: boolean } }));
vi.mock("@/lib/server/proc", async (orig) => {
  const real = await orig<typeof Proc>();
  return {
    ...real,
    mergedSessions: merged,
    run: async (cmd: string, args: string[], ms?: number, cwd?: string) => {
      if (cmd !== "8sync") return real.run(cmd, args, ms, cwd);
      eight.calls.push({ args, cwd, ms: ms ?? 0 });
      return eight.answer;
    },
  };
});
vi.mock("@/lib/server/floor", async (orig) => ({ ...(await orig<typeof import("@/lib/server/floor")>()), loadFloor: async () => [] }));

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as sidebarGET, POST as sidebarPOST } from "@/app/api/projects/sidebar/route";
import { GET as checkGET, POST as removePOST } from "@/app/api/projects/worktree/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { groupKey } from "@/lib/sidebar";
import { ORIGIN, req, tempHome } from "./helpers";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let token = "";
let base = "";
let main = "";
/** `git worktree add ../card-113-dev`: a worktree that is its own sidebar project. */
let wt = "";
/** A worktree made from inside `wt` (Claude Code's `.claude/worktrees` under a worktree). */
let nested = "";
/** Another `git worktree add ../card-200`, for the dirty / unmerged / remove cases. */
let solo = "";

beforeAll(() => {
  tempHome();
  token = getToken();
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-wt-")));
  main = path.join(base, "game");
  fs.mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(main, "a.txt"), "a\n");
  git(main, "add", "a.txt");
  git(main, "commit", "-q", "-m", "first");
  wt = path.join(base, "card-113-dev");
  git(main, "worktree", "add", "-q", "-b", "card-113-dev", wt);
  nested = path.join(wt, ".claude", "worktrees", "card-147-fix");
  git(wt, "worktree", "add", "-q", "-b", "card-147-fix", nested);
  solo = path.join(base, "card-200");
  git(main, "worktree", "add", "-q", "-b", "card-200", solo);
});

const room = (label: string, cwd: string, status = "idle") => ({ name: label, label, cwd, status });

beforeEach(() => {
  merged.mockReset();
  // The rooms ran there and are closed now: HQ still knows their projects.
  merged.mockResolvedValue([room("dev", nested, "ended"), room("core", main, "ended"), room("qa", solo, "ended")]);
  getDb().exec("DELETE FROM hidden_projects");
  eight.calls = [];
  eight.answer = { ok: true, stdout: "", stderr: "" };
});

/** What `8sync ccc auto close --json` prints for `root`. */
const plan = (root: string, dry: boolean, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    root,
    dry_run: dry,
    rooms: [{ label: "lead", pid: 11, kind: "background", own: false, pids: [] }],
    claude: [],
    omp: [{ label: "core", pid: 12, kind: "process", own: true, pids: [12] }],
    omp_rooms: [],
    procs: [{ label: "vite preview :4120", pid: 13, kind: "process", own: false, pids: [13, 14] }],
    skipped: [],
    counts: { rooms: 1, claude: 0, omp: 1, procs: 1 },
    auto: dry ? null : "left",
    ok: true,
    ...extra,
  });

const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown, t: string | null = token, origin: string | null = ORIGIN) =>
  fn(req(url, { method: "POST", token: t, origin, body }));
const check = async (root: string) => {
  const res = await checkGET(req(`/api/projects/worktree?root=${encodeURIComponent(root)}`, { token }));
  return { status: res.status, body: await res.json() };
};

describe("/api/projects/sidebar", () => {
  it("lists the known roots that are git worktrees, never the main repo", async () => {
    const res = await sidebarGET(req("/api/projects/sidebar", { token }));
    expect(res.status).toBe(200);
    const { worktrees } = await res.json();
    expect(worktrees).toContain(groupKey(wt));
    expect(worktrees).not.toContain(groupKey(main));
  });

  it("needs the token and the Origin; 422 for bad bodies; 409 for a root HQ does not know", async () => {
    expect((await post(sidebarPOST, "/api/projects/sidebar", { root: wt, hidden: true }, null)).status).toBe(401);
    expect((await post(sidebarPOST, "/api/projects/sidebar", { root: wt, hidden: true }, token, "https://evil.example")).status).toBe(403);
    for (const b of [{}, { root: wt }, { root: wt, hidden: "yes" }, { root: 1, hidden: true }, { root: "x".repeat(4097), hidden: true }]) {
      expect((await post(sidebarPOST, "/api/projects/sidebar", b)).status, JSON.stringify(b).slice(0, 60)).toBe(422);
    }
    expect((await post(sidebarPOST, "/api/projects/sidebar", { root: base, hidden: true })).status).toBe(409);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM hidden_projects").get()).toEqual({ n: 0 });
  });

  it("closes a known project under HQ's own spelling of its root, and shows it again", async () => {
    const res = await post(sidebarPOST, "/api/projects/sidebar", { root: wt.toUpperCase(), hidden: true });
    expect(res.status).toBe(200);
    const { hidden } = await res.json();
    expect(hidden).toMatchObject({ key: groupKey(wt), root: wt, name: "card-113-dev" });
    expect(getDb().prepare("SELECT root FROM hidden_projects").all()).toEqual([{ root: wt }]);
    const shown = await post(sidebarPOST, "/api/projects/sidebar", { root: wt, hidden: false });
    expect(await shown.json()).toEqual({ ok: true, shown: true });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM hidden_projects").get()).toEqual({ n: 0 });
  });

  it("kill: the same token + Origin gate, a fixed argv, nothing runs for a bad or unknown request", async () => {
    expect((await post(sidebarPOST, "/api/projects/sidebar", { root: wt, hidden: true, kill: true }, null)).status).toBe(401);
    expect((await post(sidebarPOST, "/api/projects/sidebar", { root: wt, hidden: true, kill: true }, token, "https://evil.example")).status).toBe(403);
    for (const b of [{ root: wt, hidden: true, kill: "yes" }, { root: wt, hidden: false, kill: true }, { root: wt, kill: true }]) {
      expect((await post(sidebarPOST, "/api/projects/sidebar", b)).status, JSON.stringify(b)).toBe(422);
    }
    expect((await post(sidebarPOST, "/api/projects/sidebar", { root: base, hidden: true, kill: true })).status).toBe(409);
    expect((await sidebarGET(req(`/api/projects/sidebar?root=${encodeURIComponent(wt)}`, { token: null }))).status).toBe(401);
    expect((await sidebarGET(req(`/api/projects/sidebar?root=${encodeURIComponent(base)}`, { token }))).status).toBe(409);
    expect((await sidebarGET(req("/api/projects/sidebar?root=", { token }))).status).toBe(422);
    expect(eight.calls).toEqual([]);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM hidden_projects").get()).toEqual({ n: 0 });
  });

  it("?root= lists what the close would stop: a dry run in the root HQ knows", async () => {
    eight.answer = { ok: true, stdout: plan(wt, true), stderr: "" };
    const res = await sidebarGET(req(`/api/projects/sidebar?root=${encodeURIComponent(wt.toUpperCase())}`, { token }));
    expect(res.status).toBe(200);
    const { plan: got } = await res.json();
    expect(got).toMatchObject({ dry_run: true, counts: { rooms: 1, claude: 0, omp: 1, procs: 1 } });
    expect(eight.calls).toEqual([{ args: ["ccc", "auto", "close", "--dry-run", "--json"], cwd: wt, ms: 60_000 }]);
    // An 8sync without `auto close` answers no plan: an error, never an empty list.
    eight.answer = { ok: false, stdout: "", stderr: "error: không rõ `close`" };
    const old = await sidebarGET(req(`/api/projects/sidebar?root=${encodeURIComponent(wt)}`, { token }));
    expect(old.status).toBe(502);
    expect((await old.json()).error).toContain("không rõ `close`");
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM hidden_projects").get()).toEqual({ n: 0 });
  });

  it("kill: runs `auto close` in the root, then hides it with what stopped", async () => {
    eight.answer = { ok: true, stdout: plan(wt, false), stderr: "" };
    const res = await post(sidebarPOST, "/api/projects/sidebar", { root: wt, hidden: true, kill: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hidden).toMatchObject({ key: groupKey(wt), root: wt });
    expect(body.close).toMatchObject({ dry_run: false, auto: "left", counts: { procs: 1 } });
    expect(eight.calls).toEqual([{ args: ["ccc", "auto", "close", "--json"], cwd: wt, ms: 120_000 }]);
    expect(getDb().prepare("SELECT root FROM hidden_projects").all()).toEqual([{ root: wt }]);
  });

  it("kill: a close that fails hides nothing and says what did not stop", async () => {
    eight.answer = { ok: false, stdout: plan(wt, false, { ok: false }), stderr: "Error: không dừng được: core (pid 12)\n" };
    const res = await post(sidebarPOST, "/api/projects/sidebar", { root: wt, hidden: true, kill: true });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("không dừng được: core (pid 12)");
    expect(body.close).toMatchObject({ ok: false });
    eight.answer = { ok: false, stdout: "", stderr: "", killed: true };
    const slow = await post(sidebarPOST, "/api/projects/sidebar", { root: wt, hidden: true, kill: true });
    expect((await slow.json()).error).toContain("120 giây");
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM hidden_projects").get()).toEqual({ n: 0 });
  });
});

describe("/api/projects/worktree", () => {
  it("never deletes the main repo", async () => {
    const r = await check(main);
    expect(r.status).toBe(200);
    expect(r.body.verdict.ok).toBe(false);
    expect(r.body.verdict.reasons[0]).toContain("repo chính");
    const res = await post(removePOST, "/api/projects/worktree", { root: main });
    expect(res.status).toBe(409);
    expect(fs.existsSync(path.join(main, ".git"))).toBe(true);
  });

  it("refuses a root HQ does not know, and a request without auth", async () => {
    expect((await check(base)).status).toBe(409);
    expect((await post(removePOST, "/api/projects/worktree", { root: wt }, null)).status).toBe(401);
    expect((await post(removePOST, "/api/projects/worktree", { root: wt }, token, "https://evil.example")).status).toBe(403);
    expect((await post(removePOST, "/api/projects/worktree", {})).status).toBe(422);
  });

  it("refuses while a room runs inside or another worktree sits inside", async () => {
    merged.mockResolvedValue([room("dev", nested, "idle")]);
    const r = await check(wt);
    expect(r.body.facts).toMatchObject({ linked: true, branch: "card-113-dev", mainBranch: "main", rooms: ["dev"] });
    // The nested worktree is also untracked content of `wt`.
    expect(r.body.verdict.reasons).toEqual(
      expect.arrayContaining(["Còn 1 phòng chạy trong worktree (dev): đóng phòng trước.", "Có worktree khác nằm bên trong (card-147-fix): xóa worktree đó trước."]),
    );
    const res = await post(removePOST, "/api/projects/worktree", { root: wt });
    expect(res.status).toBe(409);
    expect((await res.json()).verdict.ok).toBe(false);
    expect(fs.existsSync(wt)).toBe(true);
  });

  it("refuses a dirty worktree and one with unmerged commits", async () => {
    fs.writeFileSync(path.join(solo, "b.txt"), "b\n");
    let r = await check(solo);
    expect(r.body.verdict.reasons).toEqual(["Còn 1 file chưa commit."]);
    git(solo, "add", "b.txt");
    git(solo, "commit", "-q", "-m", "work");
    r = await check(solo);
    expect(r.body.verdict.reasons).toEqual(["Có 1 commit chưa merge vào main."]);
    expect((await post(removePOST, "/api/projects/worktree", { root: solo })).status).toBe(409);
    expect(fs.existsSync(path.join(solo, "b.txt"))).toBe(true);
    // Merged into main: nothing left to lose (no remote, so nothing to push).
    git(main, "merge", "-q", "--ff-only", "card-200");
  });

  it("removes a clean, merged worktree with `git worktree remove`, keeps its branch, clears its closed row", async () => {
    await post(sidebarPOST, "/api/projects/sidebar", { root: solo, hidden: true });
    const r = await check(solo);
    expect(r.body.verdict).toEqual({ ok: true, reasons: [] });
    const res = await post(removePOST, "/api/projects/worktree", { root: solo });
    expect(res.status).toBe(200);
    expect(fs.existsSync(solo)).toBe(false);
    expect(git(main, "worktree", "list", "--porcelain")).not.toContain("card-200");
    expect(git(main, "branch", "--list", "card-200")).toContain("card-200");
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM hidden_projects").get()).toEqual({ n: 0 });
  });
});
