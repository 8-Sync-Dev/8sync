import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/machine/restart/route";
import { __setNonceForTest, getToken, PUB_COOKIE, sessionCookie } from "@/lib/server/auth";
import { heavy, parseHeavy, restartApp, restartPid, type Heavy, type Run8 } from "@/lib/server/machine";
import { publicPath } from "@/lib/server/paths";
import { ORIGIN, req, tempHome } from "./helpers";

const HOST = "calm-river-42.trycloudflare.com";
const KEY = "e".repeat(64);
let token = "";

const CLAUDE: Heavy = { pid: 46364, rootPid: 46360, app: "Claude Desktop", image: "claude", mb: 11_366, restartable: true };
const EDGE: Heavy = { pid: 501, rootPid: 500, app: "Microsoft Edge", image: "msedge", mb: 5_000, restartable: false };

beforeAll(() => {
  tempHome();
  token = getToken();
  const nonce = "f".repeat(64);
  __setNonceForTest(nonce);
  fs.mkdirSync(path.dirname(publicPath()), { recursive: true });
  fs.writeFileSync(publicPath(), JSON.stringify({ v: 1, host: HOST, key: KEY, since: Date.now(), nonce }));
});
afterAll(() => {
  fs.rmSync(publicPath(), { force: true });
  __setNonceForTest("");
});

describe("heavy renderers", () => {
  it("parseHeavy keeps well-formed rows; null for an 8sync without `eco heavy`", () => {
    expect(parseHeavy(JSON.stringify({ heavy: [CLAUDE, { pid: "x" }, EDGE] }))).toEqual([CLAUDE, EDGE]);
    expect(parseHeavy(JSON.stringify({ heavy: [] }))).toEqual([]);
    expect(parseHeavy("usage: 8sync ccc eco …")).toBeNull();
    expect(parseHeavy(JSON.stringify({ ram: {} }))).toBeNull();
  });

  it("read once per 30 s; past that the last read comes at once while a fresh one runs", async () => {
    const calls: [string[], number][] = [];
    let rows: Heavy[] = [CLAUDE];
    const run: Run8 = async (a, t) => (calls.push([a, t]), { ok: true, stdout: JSON.stringify({ heavy: rows }), stderr: "" });
    const t0 = 1_000_000_000_000;
    expect(await heavy(run, t0)).toEqual([CLAUDE]);
    expect(calls).toEqual([[["ccc", "eco", "heavy", "--json"], 10_000]]);
    expect(await heavy(run, t0 + 29_000)).toEqual([CLAUDE]);
    expect(calls.length).toBe(1);
    rows = [EDGE];
    expect(await heavy(run, t0 + 31_000)).toEqual([CLAUDE]); // stale, refreshing
    expect(calls.length).toBe(2);
    await new Promise((r) => setTimeout(r, 0)); // the refresh lands
    expect(await heavy(run, t0 + 32_000)).toEqual([EDGE]);
  });
});

describe("restart", () => {
  it("rootPid: a positive 32-bit integer only", () => {
    expect(restartPid({ rootPid: 46360 })).toBe(46360);
    for (const bad of [0, -1, 1.5, "46360", null, 2 ** 32, Number.NaN]) expect(restartPid({ rootPid: bad })).toBeNull();
    expect(restartPid(null)).toBeNull();
  });

  it("runs `8sync ccc eco restart <pid> --json`, passes its result, its refusal as text, one at a time", async () => {
    const seen: [string[], number][] = [];
    let finish: (v: { ok: boolean; stdout: string; stderr: string }) => void = () => {};
    const run: Run8 = (a, t) => (seen.push([a, t]), new Promise((r) => (finish = r)));
    const a = restartApp(46360, run);
    expect(await restartApp(46360, run)).toEqual({ ok: false, error: "Đang khởi động lại một app, chờ xong rồi thử lại" });
    finish({ ok: true, stdout: JSON.stringify({ ok: true, app: "Claude Desktop", freedMb: 11_800, relaunched: true }), stderr: "" });
    expect(await a).toEqual({ ok: true, v: { ok: true, app: "Claude Desktop", freedMb: 11_800, relaunched: true } });
    expect(seen).toEqual([[["ccc", "eco", "restart", "46360", "--json"], 60_000]]);
    const no = restartApp(500, run);
    finish({ ok: false, stdout: "", stderr: "Error: Microsoft Edge không được khởi động lại từ 8sync (có thể đang giữ việc của anh): đóng bớt tab/cửa sổ\n" });
    expect(await no).toEqual({ ok: false, error: "Microsoft Edge không được khởi động lại từ 8sync (có thể đang giữ việc của anh): đóng bớt tab/cửa sổ" });
  });

  it("the route: never through the --public quick tunnel; a bad rootPid is 422", async () => {
    const headers = new Headers({
      host: HOST,
      "x-hq-token": token,
      cookie: `${PUB_COOKIE}=${sessionCookie(KEY, Date.now())}`,
      "cf-ray": "8f00000000000000-SIN",
      origin: `https://${HOST}`,
      "content-type": "application/json",
    });
    const viaTunnel = new Request(`https://${HOST}/api/machine/restart`, { method: "POST", headers, body: JSON.stringify({ rootPid: 46360 }) });
    expect((await POST(viaTunnel)).status).toBe(403);
    const local = (body: unknown) => req("/api/machine/restart", { method: "POST", token, origin: ORIGIN, body });
    expect((await POST(local({ rootPid: "46360" }))).status).toBe(422);
    expect((await POST(local({}))).status).toBe(422);
    expect((await POST(req("/api/machine/restart", { method: "POST", origin: ORIGIN, body: { rootPid: 1 } }))).status).toBe(401);
  });
});
