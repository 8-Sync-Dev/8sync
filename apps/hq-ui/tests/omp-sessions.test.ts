import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const coreGet = vi.hoisted(() => vi.fn());
const spawned = vi.hoisted(() => [] as { args: string[]; cwd?: string }[]);
vi.mock("@/lib/server/proc", async (orig) => ({ ...(await orig<typeof import("@/lib/server/proc")>()), run, mergedSessions: vi.fn(async () => []) }));
vi.mock("@/lib/server/core", async (orig) => ({ ...(await orig<typeof import("@/lib/server/core")>()), coreGet }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: (_cmd: string, args: string[], opts: { cwd?: string }) => {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), kill: () => proc.emit("exit", null) });
    spawned.push({ args, cwd: opts.cwd });
    return proc;
  },
}));

import { GET as LIST, POST as CREATE } from "@/app/api/omp/sessions/route";
import { GET as TERM } from "@/app/api/sessions/[name]/term/route";
import { getToken } from "@/lib/server/auth";
import { resetFloorCache } from "@/lib/server/floor";
import { canonicalRoot, forgetOmpSessions, ompIdFor, pendingNew, projectRoot, rememberNew, roomIdOf } from "@/lib/server/omp-sessions";
import { closeTerm, ompNewArgs } from "@/lib/server/term";
import { ORIGIN, req, tempHome } from "./helpers";

const tmps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hq-omp-ws-"));
  tmps.push(d);
  return d;
};
const lsOut = (rows: unknown[]) => ({ ok: true, stdout: JSON.stringify(rows), stderr: "" });

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});
beforeEach(() => {
  resetFloorCache();
  spawned.length = 0;
  run.mockReset();
  run.mockResolvedValue(lsOut([]));
  coreGet.mockReset();
  coreGet.mockResolvedValue(null);
});
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("omp room id, as ccc_core::room_id makes it", () => {
  it("is FNV-1a 64 of root NUL name (the Rust golden value)", () => {
    expect(roomIdOf("a", "b")).toBe("omp-e5d29919042666b2");
    expect(roomIdOf("a", "c")).not.toBe(roomIdOf("a", "b"));
  });

  it("hashes the canonical root: verbatim `\\\\?\\` on Windows (std::fs::canonicalize), the real path elsewhere", () => {
    const d = tmp();
    const real = fs.realpathSync.native(d);
    expect(canonicalRoot(d, "linux")).toBe(real);
    if (process.platform === "win32") {
      expect(canonicalRoot(d, "win32")).toBe(`\\\\?\\${real}`);
      expect(canonicalRoot(`\\\\?\\${real}`, "win32")).toBe(`\\\\?\\${real}`);
    }
    expect(canonicalRoot(path.join(d, "missing"), "win32")).toBe(path.join(d, "missing"));
  });

  it("the project root is the nearest folder with a marker (`8sync .`), else the folder itself", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "repo", "src", "deep"), { recursive: true });
    fs.mkdirSync(path.join(d, "repo", ".git"));
    expect(projectRoot(path.join(d, "repo", "src", "deep"))).toBe(path.join(d, "repo"));
    fs.writeFileSync(path.join(d, "repo", "src", "package.json"), "{}");
    expect(projectRoot(path.join(d, "repo", "src", "deep"))).toBe(path.join(d, "repo", "src"));
    expect(ompIdFor(path.join(d, "repo", "src", "deep"), "x")).toBe(roomIdOf(canonicalRoot(path.join(d, "repo", "src")), "x"));
  });

  it("a pending new session is kept 10 minutes", () => {
    rememberNew("omp-00000000000000b1", { cwd: "C:\\x", name: "a", model: null }, 1000);
    expect(pendingNew("omp-00000000000000b1", 1000 + 60_000)).toMatchObject({ name: "a" });
    expect(pendingNew("omp-00000000000000b1", 1000 + 11 * 60_000)).toBeNull();
  });
});

describe("GET/POST /api/omp/sessions", () => {
  it("lists a folder's omp sessions with `8sync . ls --json` run there", async () => {
    const d = tmp();
    run.mockResolvedValue(lsOut([{ engine: "omp", name: "core", inbox_id: "omp-00000000000000c1", status: "idle" }, { engine: "ccc", name: "x" }]));
    const res = await LIST(req(`/api/omp/sessions?cwd=${encodeURIComponent(d)}`, { token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cwd: path.resolve(d), sessions: [{ engine: "omp", name: "core", inbox_id: "omp-00000000000000c1", status: "idle" }] });
    expect(run).toHaveBeenCalledWith("8sync", [".", "ls", "--json"], 15_000, path.resolve(d));
    forgetOmpSessions(path.resolve(d));
    expect((await LIST(req(`/api/omp/sessions?cwd=relative`, { token }))).status).toBe(422);
    expect((await LIST(req(`/api/omp/sessions?cwd=${encodeURIComponent(d)}`, {}))).status).toBe(401);
  });

  it("asks the HQ core first and starts no `8sync` when it answers", async () => {
    const d = tmp();
    coreGet.mockResolvedValue({ v: [{ engine: "omp", name: "web", inbox_id: "omp-00000000000000c2", status: "running" }, { engine: "ccc", name: "x" }] });
    const res = await LIST(req(`/api/omp/sessions?cwd=${encodeURIComponent(d)}`, { token }));
    expect(await res.json()).toEqual({ cwd: path.resolve(d), sessions: [{ engine: "omp", name: "web", inbox_id: "omp-00000000000000c2", status: "running" }] });
    expect(coreGet).toHaveBeenCalledWith("/v1/omp-ls", { body: { cwd: path.resolve(d) }, timeoutMs: 15_000 });
    expect(run).not.toHaveBeenCalled();
    forgetOmpSessions(path.resolve(d));
  });

  it("POST validates folder, name and model, answers the room id, and the terminal then runs `--omp-new` in that folder", async () => {
    const d = tmp();
    const post = (body: unknown) => CREATE(req("/api/omp/sessions", { method: "POST", token, origin: ORIGIN, body }));
    for (const bad of [
      { cwd: "rel", name: "a" },
      { cwd: path.join(d, "missing"), name: "a" },
      { cwd: d, name: "Bad Name" },
      { cwd: d, name: "../x" },
      { cwd: d, name: "ls" },
      { cwd: d, name: "a", model: "--continue" },
    ]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(422);
    }
    const res = await post({ cwd: d, name: "fix-login", model: "zai/glm-5.3" });
    expect(res.status).toBe(200);
    const { id, name, cwd } = (await res.json()) as { id: string; name: string; cwd: string };
    expect([id, name, cwd]).toEqual([ompIdFor(d, "fix-login"), "fix-login", path.resolve(d)]);
    expect(spawned).toHaveLength(0);

    const t = await TERM(req(`/api/sessions/${id}/term?cols=90&rows=25&gen=0&since=-1`, { token }), { params: Promise.resolve({ name: id }) } as never);
    expect(t.status).toBe(200);
    expect(spawned).toEqual([{ args: ompNewArgs("fix-login", "zai/glm-5.3", 90, 25), cwd: path.resolve(d) }]);
    expect(ompNewArgs("a", null, 80, 24)).toEqual(["ccc", "term", "--omp-new", "a", "--cols", "80", "--rows", "24"]);
    closeTerm(id);
  });
});
