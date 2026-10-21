import { beforeAll, describe, expect, it, vi } from "vitest";

/** A live room's repo (a real temp dir, set in beforeAll): the only root the route accepts. */
const room = vi.hoisted(() => ({ cwd: "" }));
const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => (room.cwd ? [{ name: "s1", cwd: room.cwd, status: "running" }] : []),
  run,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET, POST } from "@/app/api/auto/loop/route";
import { getToken } from "@/lib/server/auth";
import { ORIGIN, req, tempHome } from "./helpers";

const STATUS = (loops: unknown) => ({ ok: true, stdout: JSON.stringify({ on: true, paused: false, ship_loops: loops }), stderr: "" });

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-loop-root-"));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  room.cwd = path.resolve(dir);
});

const post = (body: unknown, t: string | null = token) => POST(req("/api/auto/loop", { method: "POST", token: t, origin: ORIGIN, body }));
/** The `8sync ccc auto loop …` calls (status refreshes filtered out). */
const loopCalls = () => run.mock.calls.filter((c) => c[1][2] === "loop");

describe("POST /api/auto/loop", () => {
  it("401 without the token, 422 on a bad body, 409 for a project HQ does not show; runs nothing", async () => {
    run.mockReset();
    expect((await post({ root: room.cwd, on: true }, null)).status).toBe(401);
    expect((await post({ root: room.cwd })).status).toBe(422);
    expect((await post({ root: room.cwd, on: true, focus: 7 })).status).toBe(422);
    expect((await post({ root: room.cwd, on: true, focus: "a\u0007b" })).status).toBe(422);
    expect((await post({ root: room.cwd, on: true, focus: "x".repeat(301) })).status).toBe(422);
    expect((await post({ root: path.join(os.tmpdir(), "not-a-hq-project"), on: true })).status).toBe(409);
    expect(run).not.toHaveBeenCalled();
  });

  it("on: `8sync ccc auto loop on --json -- <focus>` in the project, the focus as one argv word", async () => {
    run.mockReset();
    run.mockImplementation(async (_b: string, argv: string[]) => (argv[2] === "loop" ? { ok: true, stdout: "{}", stderr: "" } : STATUS({})));
    const res = await post({ root: room.cwd, on: true, focus: "  hiệu năng; rm -rf / " });
    expect(res.status).toBe(200);
    expect((await res.json()).line).toContain("Auto-ship: BẬT");
    expect(loopCalls()).toEqual([["8sync", ["ccc", "auto", "loop", "on", "--json", "--", "hiệu năng; rm -rf /"], expect.any(Number), room.cwd]]);
    // The status cache was refreshed, so the chip sees the loop at once.
    expect(run.mock.calls.some((c) => c[1].join(" ") === "ccc auto status --json")).toBe(true);
  });

  it("off (no focus word); a failing CLI is a 502 carrying its message", async () => {
    run.mockReset();
    run.mockImplementation(async (_b: string, argv: string[]) => (argv[2] === "loop" ? { ok: true, stdout: "{}", stderr: "" } : STATUS({})));
    expect((await post({ root: room.cwd, on: false, focus: "ignored" })).status).toBe(200);
    expect(loopCalls()[0][1]).toEqual(["ccc", "auto", "loop", "off", "--json"]);
    run.mockImplementation(async (_b: string, argv: string[]) => (argv[2] === "loop" ? { ok: false, stdout: "", stderr: "Error: auto loop: chỉ owner bật/tắt được" } : STATUS({})));
    const res = await post({ root: room.cwd, on: true });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("auto loop: chỉ owner bật/tắt được");
  });
});

describe("GET /api/auto/loop", () => {
  it("401 without the token; the loops from the auto status", async () => {
    expect((await GET(req("/api/auto/loop"))).status).toBe(401);
    run.mockReset();
    run.mockResolvedValue(STATUS({ [room.cwd]: { round: 4, focus: "sec", since: 1, last: 2, next_reason: "usage" } }));
    // POST refreshed the cache last time; refresh it with this status.
    await post({ root: room.cwd, on: false });
    const res = await GET(req("/api/auto/loop", { token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ loops: [{ root: room.cwd, round: 4, focus: "sec", since: 1, next: "usage" }] });
  });
});
