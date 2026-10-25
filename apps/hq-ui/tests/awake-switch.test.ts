import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({ ...(await orig<typeof import("@/lib/server/proc")>()), run }));

import { POST } from "@/app/api/machine/awake/route";
import { awake, parseAwake } from "@/lib/server/awake";
import { holdLine } from "@/components/hq/machine-chip";
import { getToken } from "@/lib/server/auth";
import { ORIGIN, req, tempHome } from "./helpers";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});
beforeEach(() => run.mockReset());

const post = (body: unknown, t: string | null = token) => POST(req("/api/machine/awake", { method: "POST", token: t, origin: ORIGIN, body }));

/** `8sync ccc awake status --json` as serde writes it (crates/cli/src/verbs/ccc/awake.rs Status). */
const status = (ours: string) =>
  `{"schema":1,"held":true,"display_required":false,"display":"off","idle_s":7113,"boot_s":51284,"slept_s":0,"modern_standby":false,"ours":${ours}}`;

describe("parseAwake: the switch reads ours, never held", () => {
  it("our hold", () => {
    expect(parseAwake(status(`{"pid":37876,"until":1792442725,"while_rooms":true}`))?.ours).toEqual({ pid: 37876, until: 1792442725, while_rooms: true });
  });
  it("held by someone else (omp.exe on Windows) is not ours", () => {
    const v = parseAwake(status("null"));
    expect(v?.held).toBe(true);
    expect(v?.ours).toBeNull();
  });
  it("an older 8sync without the field, or a broken one, is off", () => {
    expect(parseAwake(`{"schema":1,"held":true}`)?.ours).toBeNull();
    expect(parseAwake(status(`{"pid":0,"until":5}`))?.ours).toBeNull();
    expect(parseAwake(status(`"yes"`))?.ours).toBeNull();
  });
});

describe("holdLine: the switch says when our hold lets go", () => {
  it("until 0 is held until the owner switches it off", () => {
    expect(parseAwake(status(`{"pid":9,"until":0,"while_rooms":false}`))?.ours).toEqual({ pid: 9, until: 0, while_rooms: false });
    expect(holdLine({ pid: 9, until: 0, while_rooms: false })).toBe("Đang giữ tới khi anh tắt");
    expect(holdLine({ pid: 9, until: 0, while_rooms: true })).toBe("Đang giữ: tự nhả khi hết phòng");
  });
  it("a deadline is named", () => {
    expect(holdLine({ pid: 9, until: 1_792_442_725, while_rooms: false })).toMatch(/^Đang giữ tới khi anh tắt, chậm nhất /);
    expect(holdLine({ pid: 9, until: 1_792_442_725, while_rooms: true })).toMatch(/^Đang giữ: tự nhả khi hết phòng, chậm nhất /);
  });
});

describe("POST /api/machine/awake", () => {
  it("on runs `8sync ccc awake on` and passes its line on", async () => {
    run.mockResolvedValue({ ok: true, stdout: "đã bật giữ máy thức (pid 4242): tự nhả khi không còn phòng nào chạy\n", stderr: "" });
    const r = await post({ on: true });
    expect(r.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0].slice(0, 2)).toEqual(["8sync", ["ccc", "awake", "on"]]);
    expect(await r.json()).toEqual({ ok: true, message: "đã bật giữ máy thức (pid 4242): tự nhả khi không còn phòng nào chạy" });
  });

  it("off runs `8sync ccc awake off`", async () => {
    run.mockResolvedValue({ ok: true, stdout: "không có giữ thức nào của 8sync đang chạy.\n", stderr: "" });
    expect((await post({ on: false })).status).toBe(200);
    expect(run.mock.calls[0][1]).toEqual(["ccc", "awake", "off"]);
  });

  it("a refusal comes back as 409 with 8sync's reason, Error: prefix dropped", async () => {
    run.mockResolvedValue({ ok: false, stdout: "", stderr: "Error: không có phòng Claude Code nào đang chạy nên chưa cần giữ máy thức\n" });
    const r = await post({ on: true });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("không có phòng Claude Code nào đang chạy nên chưa cần giữ máy thức");
  });

  it("refuses a body that is not {on: boolean}, and needs the token", async () => {
    for (const b of [{}, { on: "true" }, { on: 1 }, null]) expect((await post(b)).status).toBe(400);
    expect((await post({ on: true }, null)).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("one flip at a time: a second request while `on` runs is refused, not a second hold", async () => {
    const { promise, resolve } = Promise.withResolvers<{ ok: boolean; stdout: string; stderr: string }>();
    run.mockReturnValueOnce(promise);
    const first = post({ on: true });
    const second = await post({ on: true });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Đang đổi giữ máy thức, thử lại sau vài giây");
    expect(run).toHaveBeenCalledTimes(1);
    resolve({ ok: true, stdout: "đã bật\n", stderr: "" });
    expect((await first).status).toBe(200);
    run.mockResolvedValueOnce({ ok: true, stdout: "đã tắt\n", stderr: "" });
    expect((await post({ on: false })).status).toBe(200); // free again once it returned
  });

  it("a flip makes the next status read fresh (no 30 s stale switch)", async () => {
    run.mockResolvedValue({ ok: true, stdout: status("null"), stderr: "" });
    const t = 1_000_000;
    expect((await awake(t))?.ours).toBeNull();
    run.mockClear();
    expect((await awake(t + 1000))?.ours).toBeNull();
    expect(run).not.toHaveBeenCalled(); // cached
    run.mockResolvedValueOnce({ ok: true, stdout: "đã bật\n", stderr: "" });
    await post({ on: true });
    run.mockResolvedValue({ ok: true, stdout: status(`{"pid":9,"until":2000000000,"while_rooms":true}`), stderr: "" });
    expect((await awake(t + 2000))?.ours?.pid).toBe(9);
  });
});
