import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const merged = vi.hoisted(() => vi.fn());
const agents = vi.hoisted(() => vi.fn());
const stopTmux = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: merged,
  listClaudeAgents: agents,
  stopTmux,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "@/app/api/sessions/[name]/end/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ORIGIN, req, tempHome } from "./helpers";

const SID = "04d7c8d5-7473-44e7-bab9-0606b4db5a01";
/** A repo on disk (projectOf only looks for `.git` + HEAD). */
let CWD = "";
/** A Claude Code worktree of it: `claude rm` deletes this folder in the tests that need it. */
let WT = "";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
  CWD = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-room-end-"))), "game");
  fs.mkdirSync(path.join(CWD, ".git"), { recursive: true });
  fs.writeFileSync(path.join(CWD, ".git", "HEAD"), "ref: refs/heads/main\n");
});

beforeEach(() => {
  WT = path.join(CWD, ".claude", "worktrees", "card-147-fix");
  fs.mkdirSync(WT, { recursive: true });
  fs.writeFileSync(path.join(WT, ".git"), `gitdir: ${path.join(CWD, ".git", "worktrees", "card-147-fix")}\n`);
});

const session = (over: Record<string, unknown> = {}) => ({
  name: SID,
  label: "dev",
  session_id: SID,
  project_id: null,
  status: "idle",
  started_at: 1,
  cwd: CWD,
  tmux: false,
  source: "claude",
  detail: null,
  inbox_live: false,
  ...over,
});
const ok = (stdout = "") => ({ ok: true, stdout, stderr: "" });

beforeEach(() => {
  for (const m of [run, merged, agents, stopTmux]) m.mockReset();
  merged.mockResolvedValue([session()]);
  agents.mockResolvedValue([{ sessionId: SID, kind: "background", status: "idle", name: "dev", cwd: CWD }]);
  run.mockResolvedValue(ok());
});

const post = (name: string, body: unknown, init: { token?: string | null; origin?: string | null } = {}) =>
  POST(req(`/api/sessions/${name}/end`, { method: "POST", token: init.token === undefined ? token : init.token, origin: init.origin === undefined ? ORIGIN : init.origin, body }), {
    params: Promise.resolve({ name }),
  });

describe("POST /api/sessions/[name]/end", () => {
  it("needs the token and the UI's own Origin, runs nothing otherwise", async () => {
    expect((await post(SID, { action: "close" }, { token: null })).status).toBe(401);
    expect((await post(SID, { action: "close" }, { origin: "https://evil.example" })).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("422 for a bad action or a name that is not a room id, runs nothing", async () => {
    for (const body of [{}, { action: "kill" }, { action: ["close"] }, null]) expect((await post(SID, body)).status, JSON.stringify(body)).toBe(422);
    for (const name of ["--force", "a b", "../x", "-x"]) expect((await post(encodeURIComponent(name), { action: "close" })).status, name).toBe(422);
    expect(run).not.toHaveBeenCalled();
  });

  it("404 for a room HQ does not list; 409 for omp, a terminal the owner opened, or a room HQ has no process for", async () => {
    expect((await post("0000aaaa-0000-4000-8000-000000000000", { action: "close" })).status).toBe(404);
    expect((await post("omp-0123456789abcdef", { action: "delete" })).status).toBe(409);
    agents.mockResolvedValue([{ sessionId: SID, kind: "interactive" }]);
    const res = await post(SID, { action: "close" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("terminal");
    merged.mockResolvedValue([session({ source: "journal", status: "idle" })]);
    expect((await post(SID, { action: "delete" })).status).toBe(409);
    expect(run).not.toHaveBeenCalled();
  });

  it("close: `claude stop <short id>` only; the conversation is kept and HQ marks the room ended", async () => {
    const res = await post(SID, { action: "close" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "close", registry: null, warning: null });
    expect(run.mock.calls).toEqual([["claude", ["stop", "04d7c8d5"], 30_000]]);
    const row = getDb().prepare("SELECT status, cwd FROM sessions WHERE name = ?").get(SID) as { status: string; cwd: string };
    expect(row).toEqual({ status: "ended", cwd: CWD });
  });

  it("close: reports claude's own error", async () => {
    run.mockResolvedValue({ ok: false, stdout: "", stderr: "no such session\n" });
    const res = await post(SID, { action: "close" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("no such session");
  });

  const ls = (rows: unknown[]) => ok(JSON.stringify(rows));
  const isLs = (cmd: string, args: string[]) => cmd === "8sync" && args.includes("ls");

  it("delete: looks the registry entry up first, then stop, `claude rm`, `ccc . rm` for that entry only", async () => {
    run.mockImplementation(async (cmd: string, args: string[]) => (isLs(cmd, args) ? ls([{ name: "qa", id: "11111111-1111-4111-8111-111111111111" }, { name: "dev", id: SID }]) : ok()));
    const res = await post(SID, { action: "delete" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "delete", registry: "dev", warning: null });
    expect(run.mock.calls).toEqual([
      ["8sync", ["ccc", ".", "ls", "--json"], 10_000, CWD],
      ["claude", ["stop", "04d7c8d5"], 30_000],
      ["claude", ["rm", "04d7c8d5"], 30_000],
      ["8sync", ["ccc", ".", "rm", "dev"], 10_000, CWD],
    ]);
  });

  it("delete: a worktree room whose `claude rm` deletes its folder is still dropped from the repo's registry", async () => {
    merged.mockResolvedValue([session({ cwd: WT })]);
    run.mockImplementation(async (cmd: string, args: string[], _t: number, cwd?: string) => {
      // A real spawn in a folder that is gone fails (the bug: the lookup used to run after `claude rm`).
      if (cwd && !fs.existsSync(cwd)) return { ok: false, stdout: "", stderr: "ENOENT" };
      if (isLs(cmd, args)) return cwd === CWD ? ls([{ name: "dev", id: SID }]) : ok("[]");
      if (cmd === "claude" && args[0] === "rm") fs.rmSync(WT, { recursive: true, force: true });
      return ok();
    });
    const res = await post(SID, { action: "delete" });
    expect(await res.json()).toEqual({ ok: true, action: "delete", registry: "dev", warning: null });
    expect(fs.existsSync(WT)).toBe(false);
    expect(run.mock.calls.at(-1)).toEqual(["8sync", ["ccc", ".", "rm", "dev"], 10_000, CWD]);
  });

  it("delete: an entry only the worktree's registry holds, and the worktree is gone: a warning, never a rm elsewhere", async () => {
    merged.mockResolvedValue([session({ cwd: WT })]);
    run.mockImplementation(async (cmd: string, args: string[], _t: number, cwd?: string) => {
      if (cwd && !fs.existsSync(cwd)) return { ok: false, stdout: "", stderr: "ENOENT" };
      if (isLs(cmd, args)) return cwd === WT ? ls([{ name: "dev", id: SID }]) : ls([{ name: "dev", id: "22222222-2222-4222-8222-222222222222" }]);
      if (cmd === "claude" && args[0] === "rm") fs.rmSync(WT, { recursive: true, force: true });
      return ok();
    });
    const body = await (await post(SID, { action: "delete" })).json();
    expect(body).toMatchObject({ ok: true, registry: null });
    expect(body.warning).toContain("còn trong sổ phòng");
    // The repo's own "dev" is another room: its transcript must never be the one deleted.
    expect(run.mock.calls.some((c) => c[0] === "8sync" && c[1].includes("rm"))).toBe(false);
  });

  it("delete: no registry entry, or `ccc . rm` failing, comes back as a warning, not a clean success", async () => {
    run.mockImplementation(async (cmd: string, args: string[]) => (isLs(cmd, args) ? ok("[]") : ok()));
    let body = await (await post(SID, { action: "delete" })).json();
    expect(body).toMatchObject({ ok: true, registry: null });
    expect(body.warning).toContain("chưa bị xóa");
    run.mockImplementation(async (cmd: string, args: string[]) => (isLs(cmd, args) ? ls([{ name: "dev", id: SID }]) : cmd === "8sync" ? { ok: false, stdout: "", stderr: "locked" } : ok()));
    body = await (await post(SID, { action: "delete" })).json();
    expect(body).toMatchObject({ ok: true, registry: null });
    expect(body.warning).toContain("locked");
  });

  it("delete: stops when `claude rm` refuses (a worktree with unpushed commits) and never removes the registry entry", async () => {
    run.mockImplementation(async (cmd: string, args: string[]) => (isLs(cmd, args) ? ls([{ name: "dev", id: SID }]) : args[0] === "rm" ? { ok: false, stdout: "", stderr: "worktree has 2 unpushed commits" } : ok()));
    const res = await post(SID, { action: "delete" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("unpushed");
    expect(run.mock.calls.some((c) => c[0] === "8sync" && c[1].includes("rm"))).toBe(false);
  });

  it("delete: a registry name that reads as a flag is never passed on", async () => {
    run.mockImplementation(async (cmd: string, args: string[]) => (isLs(cmd, args) ? ls([{ name: "--all", id: SID }]) : ok()));
    const body = await (await post(SID, { action: "delete" })).json();
    expect(body).toMatchObject({ ok: true, registry: null });
    expect(body.warning).toBeTruthy();
    expect(run.mock.calls.some((c) => c[1].includes("rm") && c[0] === "8sync")).toBe(false);
  });

  it("hq-* rooms: tmux stop; close keeps HQ's row as ended, delete drops it", async () => {
    merged.mockResolvedValue([session({ name: "hq-api", session_id: null, source: "tmux", tmux: true })]);
    stopTmux.mockResolvedValue(ok());
    expect((await post("hq-api", { action: "close" })).status).toBe(200);
    expect(stopTmux).toHaveBeenCalledWith("hq-api");
    expect((getDb().prepare("SELECT status FROM sessions WHERE name = 'hq-api'").get() as { status: string }).status).toBe("ended");
    expect((await post("hq-api", { action: "delete" })).status).toBe(200);
    expect(getDb().prepare("SELECT 1 FROM sessions WHERE name = 'hq-api'").get()).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
});
