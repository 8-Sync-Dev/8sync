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

import { GET, POST } from "@/app/api/auto/route";
import { getToken } from "@/lib/server/auth";
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
    expect(await res.json()).toEqual({ ...s, tick: { ticked: [] } });
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenLastCalledWith(s);
  });
  it("200 with error when 8sync lacks the command", async () => {
    status.mockResolvedValueOnce({ on: false, paused: false, error: "unknown verb" });
    const res = await GET(req("/api/auto", { token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ on: false, paused: false, error: "unknown verb", tick: { ticked: [] } });
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
  it("422 for any other action or body, nothing runs", async () => {
    set.mockClear();
    for (const b of [{ action: "off" }, { action: "on; reboot" }, { action: 1 }, {}, { action: ["on"] }]) {
      expect((await post(b)).status, JSON.stringify(b)).toBe(422);
    }
    expect(set).not.toHaveBeenCalled();
  });
});
