import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", () => ({ run }));

import { autoSet, autoStatus } from "@/lib/server/auto";

beforeEach(() => run.mockReset());

describe("lib/server/auto", () => {
  it("status runs fixed argv with a 5 s timeout and parses JSON", async () => {
    run.mockResolvedValueOnce({ ok: true, stdout: '{"schema":1,"on":true,"paused":false,"after_s":60}', stderr: "" });
    expect(await autoStatus()).toMatchObject({ on: true, paused: false, after_s: 60 });
    expect(run).toHaveBeenCalledWith("8sync", ["ccc", "auto", "status", "--json"], 5000);
  });
  it("degrades to an error status when 8sync fails or prints junk", async () => {
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "spawn 8sync ENOENT" });
    expect(await autoStatus()).toEqual({ on: false, paused: false, error: "spawn 8sync ENOENT" });
    run.mockResolvedValueOnce({ ok: true, stdout: "nope", stderr: "" });
    expect((await autoStatus()).error).toMatch(/không hợp lệ/);
  });
  it("set runs `ccc auto <action>` then reads status", async () => {
    run.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "" });
    run.mockResolvedValueOnce({ ok: true, stdout: '{"on":false,"paused":true}', stderr: "" });
    expect(await autoSet("pause")).toMatchObject({ on: false, paused: true });
    expect(run.mock.calls[0]).toEqual(["8sync", ["ccc", "auto", "pause"], 5000]);
  });
  it("a project's `on` is `auto on --here` in its root, then revive", async () => {
    run.mockResolvedValue({ ok: true, stdout: '{"on":true,"paused":false}', stderr: "" });
    await autoSet("on", "C:/w/game");
    expect(run.mock.calls[0]).toEqual(["8sync", ["ccc", "auto", "on", "--here"], 30_000, "C:/w/game"]);
    expect(run.mock.calls[1]).toEqual(["8sync", ["ccc", "auto", "revive"], 120_000]);
    run.mockReset();
    run.mockResolvedValue({ ok: true, stdout: '{"on":true,"paused":false}', stderr: "" });
    await autoSet("on");
    expect(run.mock.calls[0]).toEqual(["8sync", ["ccc", "auto", "on"], 5000]);
  });
  it("Đội omp switch runs `ccc auto omp on|off`; its failure goes to omp_error only", async () => {
    run.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "" });
    run.mockResolvedValueOnce({ ok: true, stdout: '{"on":true,"paused":false,"teams":["ccc","omp"],"omp_blocked":null}', stderr: "" });
    expect(await autoSet("omp-on")).toMatchObject({ on: true, teams: ["ccc", "omp"] });
    expect(run.mock.calls[0]).toEqual(["8sync", ["ccc", "auto", "omp", "on"], 5000]);
    run.mockReset();
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "omp dùng provider anthropic" });
    run.mockResolvedValueOnce({ ok: true, stdout: '{"on":true,"paused":false,"teams":["ccc"],"omp_blocked":"anthropic"}', stderr: "" });
    const st = await autoSet("omp-on");
    expect(st).toMatchObject({ omp_blocked: "anthropic", omp_error: "omp dùng provider anthropic" });
    expect(st.error).toBeUndefined();
    run.mockReset();
    run.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "" });
    run.mockResolvedValueOnce({ ok: true, stdout: '{"on":true,"paused":false,"teams":["ccc"]}', stderr: "" });
    await autoSet("omp-off");
    expect(run.mock.calls[0]).toEqual(["8sync", ["ccc", "auto", "omp", "off"], 5000]);
  });
});
