import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/machine/route";
import { POST as CLEAN } from "@/app/api/machine/clean/route";
import { level } from "@/components/hq/machine-chip";
import { getToken } from "@/lib/server/auth";
import { clean, cpuPct, machine, parseNvidiaSmi, parsePs, parseTasklist, type Exec, type Machine } from "@/lib/server/machine";
import { ORIGIN, req, tempHome } from "./helpers";

describe("machine probes", () => {
  it("cpuPct: busy share between two samples, null without a gap", () => {
    expect(cpuPct({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBe(75);
    expect(cpuPct({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBeNull();
  });
  it("nvidia-smi csv: one row per GPU, [N/A] temperature kept as null, junk skipped", () => {
    const out = "NVIDIA GeForce RTX 5080, 37, 6120, 16303, 54\r\nTesla T4, 0, 0, 15360, [N/A]\r\n\r\nNo devices were found\n";
    expect(parseNvidiaSmi(out)).toEqual([
      { name: "NVIDIA GeForce RTX 5080", util: 37, memUsed: 6120, memTotal: 16303, temp: 54 },
      { name: "Tesla T4", util: 0, memUsed: 0, memTotal: 15360, temp: null },
    ]);
  });
  it("tasklist csv (any thousands separator) and ps: Claude Code and Node RAM, nothing else", () => {
    const tl = ['"claude.exe","1","Console","1","245,760 K"', '"claude.exe","2","Console","1","102.400 K"', '"node.exe","3","Console","1","51 200 K"', '"chrome.exe","4","Console","1","900,000 K"'].join("\r\n");
    expect(parseTasklist(tl)).toEqual({ claude: { n: 2, mb: 340 }, node: { n: 1, mb: 50 } });
    const ps = ["  262144 /home/me/.local/bin/claude", "  51200 node", "999999 /usr/bin/Xorg", "garbage"].join("\n");
    expect(parsePs(ps)).toEqual({ claude: { n: 1, mb: 256 }, node: { n: 1, mb: 50 } });
  });
  it("a snapshot: probes that fail are left out; only Linux can clean; argv only", async () => {
    const calls: [string, string[]][] = [];
    const run: Exec = async (cmd, args) => {
      calls.push([cmd, args]);
      return cmd === "ps" ? "1024 node\n" : null;
    };
    const m = await machine("darwin", run);
    expect(m.gpus).toBeNull();
    expect(m.procs).toEqual({ claude: { n: 0, mb: 0 }, node: { n: 1, mb: 1 } });
    expect(m.canClean).toBe(false);
    expect(m.mem.totalMb).toBeGreaterThan(0);
    expect(calls.map((c) => c[0]).sort()).toEqual(["nvidia-smi", "ps"]);
    expect((await machine("linux", run)).canClean).toBe(true);
    expect((await machine("win32", run)).procs).toBeNull();
  });
  it("clean: plain `8sync clean` or `--dry-run`, never --deep/--ram/--timer", async () => {
    const seen: [string[], number | undefined][] = [];
    const run: Exec = async (_c, a, t) => (seen.push([a, t]), "ok");
    await clean(true, run);
    await clean(false, run);
    // Its own long timeout: the 4 s probe timeout would kill a real clean halfway.
    expect(seen).toEqual([[["clean", "--dry-run"], 300_000], [["clean"], 300_000]]);
  });
  it("clean: one at a time, a double click shares the running one", async () => {
    let calls = 0;
    let finish: (v: string) => void = () => {};
    const run: Exec = () => (calls++, new Promise<string>((r) => (finish = r)));
    const a = clean(false, run);
    const b = clean(false, run);
    finish("done");
    expect(await a).toBe("done");
    expect(await b).toBe("done");
    expect(calls).toBe(1);
  });
  it("chip level: calm below 75 %, amber to 90 %, red above", () => {
    expect([level(null), level(74), level(75), level(89), level(90)]).toEqual(["ok", "ok", "warn", "warn", "hot"]);
  });
});

describe("/api/machine", () => {
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
  });
  it("401 without the token; a snapshot with it", async () => {
    expect((await GET(req("/api/machine"))).status).toBe(401);
    const r = await GET(req("/api/machine", { token }));
    expect(r.status).toBe(200);
    const m = (await r.json()) as Machine;
    expect(m.mem.totalMb).toBeGreaterThan(0);
    expect(m.cpu.cores).toBeGreaterThan(0);
  });
  it("clean: 401 without the token; 422 off Linux", async () => {
    expect((await CLEAN(req("/api/machine/clean", { method: "POST", origin: ORIGIN, body: { dryRun: true } }))).status).toBe(401);
    if (process.platform !== "linux") {
      expect((await CLEAN(req("/api/machine/clean", { method: "POST", token, origin: ORIGIN, body: { dryRun: true } }))).status).toBe(422);
    }
  });
});
