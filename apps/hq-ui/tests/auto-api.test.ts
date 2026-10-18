import { beforeAll, describe, expect, it, vi } from "vitest";

const status = vi.hoisted(() => vi.fn());
const set = vi.hoisted(() => vi.fn());
const tick = vi.hoisted(() => vi.fn(async () => ({ ticked: [] })));
vi.mock("@/lib/server/auto-tick", () => ({ runAutoTick: tick }));
vi.mock("@/lib/server/auto", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/auto")>()),
  autoStatus: status,
  autoSet: set,
}));

import fs from "node:fs";
import path from "node:path";
import { GET, POST } from "@/app/api/auto/route";
import { getToken } from "@/lib/server/auth";
import { publicPath } from "@/lib/server/paths";
import { ORIGIN, req, tempHome } from "./helpers";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

describe("GET /api/auto", () => {
  it("401 without the token, runs nothing", async () => {
    status.mockClear();
    expect((await GET(req("/api/auto"))).status).toBe(401);
    expect(status).not.toHaveBeenCalled();
  });
  it("returns the 8sync status JSON plus the auto-tick result, run on that status", async () => {
    const s = { schema: 1, on: true, paused: false, lease_until: 1 };
    status.mockResolvedValueOnce(s);
    tick.mockClear();
    const res = await GET(req("/api/auto", { token }));
    expect(res.status).toBe(200);
    const { versions, ...body } = await res.json();
    expect(body).toEqual({ ...s, tick: { ticked: [] }, remote: { host: null } });
    // GET also reports the running UI / installed binary versions (stale-UI notice).
    expect(Object.keys(versions).sort()).toEqual(["binary", "ui"]);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenLastCalledWith(s);
  });
  it("200 with error when 8sync lacks the command", async () => {
    status.mockResolvedValueOnce({ on: false, paused: false, error: "unknown verb" });
    const res = await GET(req("/api/auto", { token }));
    expect(res.status).toBe(200);
    const { versions, ...body } = await res.json();
    expect(body).toEqual({ on: false, paused: false, error: "unknown verb", tick: { ticked: [] }, remote: { host: null } });
    expect(Object.keys(versions).sort()).toEqual(["binary", "ui"]);
  });
  it("names the public tunnel host while the remote link runs, never its key", async () => {
    fs.mkdirSync(path.dirname(publicPath()), { recursive: true });
    const key = "e".repeat(64);
    fs.writeFileSync(publicPath(), JSON.stringify({ v: 1, host: "calm-river-42.trycloudflare.com", key, since: 1 }));
    status.mockResolvedValueOnce({ on: true, paused: false });
    const text = await (await GET(req("/api/auto", { token }))).text();
    expect(JSON.parse(text).remote).toEqual({ host: "calm-river-42.trycloudflare.com" });
    expect(text).not.toContain(key);
    fs.rmSync(publicPath());
  });
});

describe("POST /api/auto", () => {
  const post = (body: unknown, t: string | null = token) => POST(req("/api/auto", { method: "POST", token: t, origin: ORIGIN, body }));
  it("401 without the token", async () => {
    set.mockClear();
    expect((await post({ action: "on" }, null)).status).toBe(401);
    expect(set).not.toHaveBeenCalled();
  });
  it("on / pause call the fixed action and return fresh status", async () => {
    set.mockResolvedValueOnce({ on: true, paused: false });
    expect(await (await post({ action: "on" })).json()).toEqual({ on: true, paused: false });
    expect(set).toHaveBeenLastCalledWith("on");
    set.mockResolvedValueOnce({ on: false, paused: true });
    expect(await (await post({ action: "pause" })).json()).toEqual({ on: false, paused: true });
    expect(set).toHaveBeenLastCalledWith("pause");
  });
  it("omp-on / omp-off reach autoSet as the fixed action words", async () => {
    set.mockResolvedValue({ on: true, paused: false, teams: ["ccc", "omp"] });
    expect((await post({ action: "omp-on" })).status).toBe(200);
    expect(set).toHaveBeenLastCalledWith("omp-on");
    expect((await post({ action: "omp-off" })).status).toBe(200);
    expect(set).toHaveBeenLastCalledWith("omp-off");
    set.mockReset();
  });
  it("422 for any other action or body, nothing runs", async () => {
    set.mockClear();
    for (const b of [{ action: "off" }, { action: "on; reboot" }, { action: 1 }, {}, { action: ["on"] }]) {
      expect((await post(b)).status, JSON.stringify(b)).toBe(422);
    }
    expect(set).not.toHaveBeenCalled();
  });
});
