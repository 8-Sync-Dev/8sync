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
});
