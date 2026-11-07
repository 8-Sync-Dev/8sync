import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/codemap/graphify/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import {
  ASK_TIMEOUT_MS,
  checkRoot,
  checkSymbol,
  explainArgs,
  graphifyAsk,
  graphifyCommand,
  MISSING_TEXT,
  pathArgs,
  resetGraphify,
  startUpdate,
  SYMBOL_MAX,
  UPDATE_TIMEOUT_MS,
  updateArgs,
  updateState,
} from "@/lib/server/graphify";
import type { runTrail, TrailOut } from "@/lib/server/trail";
import { ORIGIN, req, tempHome } from "./helpers";

const ok = (stdout = ""): TrailOut => ({ ok: true, code: 0, stdout, stderr: "", timedOut: false, capped: false, missing: false });
const CMD = { cmd: "graphify", pre: [] };

describe("checkSymbol", () => {
  it("trims and keeps a plain symbol", () => {
    expect(checkSymbol("  startBuild()  ")).toEqual({ ok: true, value: "startBuild()" });
    expect(checkSymbol("a".repeat(SYMBOL_MAX)).ok).toBe(true);
  });
  it("rejects empty, non-string, overlong, leading '-', control chars and newlines", () => {
    for (const bad of ["", "   ", 42, null, "a".repeat(SYMBOL_MAX + 1), "-x", "--graph=/etc", " -rf", "a\nb", "a\rb", "a\u0000b", "a\tb", "a\u2028b"]) {
      expect(checkSymbol(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("argv", () => {
  it("never uses query, keeps each value one argument", () => {
    expect(updateArgs()).toEqual(["update", ".", "--no-cluster"]);
    expect(explainArgs("a b; rm")).toEqual(["explain", "a b; rm"]);
    expect(pathArgs("A()", "B()")).toEqual(["path", "A()", "B()"]);
  });
});

describe("checkRoot", () => {
  let a: string;
  let b: string;
  beforeAll(() => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-graphify-")));
    a = path.join(base, "a");
    b = path.join(base, "b");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
  });
  it("accepts a known root (any spelling of it), 409 for an unknown one", () => {
    expect(checkRoot(a, [b, a])).toBeNull();
    expect(checkRoot(path.join(a, "."), [a])).toBeNull();
    expect(checkRoot(b, [a])?.status).toBe(409);
    expect(checkRoot(a, [])?.status).toBe(409);
  });
});

describe("graphifyCommand", () => {
  it("finds graphify.exe on a Windows PATH, null when missing", () => {
    const has = new Set(["C:\\tools\\graphify.exe"]);
    expect(graphifyCommand({ env: { Path: "C:\\x;C:\\tools" }, platform: "win32", exists: (p) => has.has(p) })).toEqual({ cmd: "C:\\tools\\graphify.exe", pre: [] });
    expect(graphifyCommand({ env: { PATH: "/usr/bin" }, platform: "linux", exists: () => false })).toBeNull();
  });
});

describe("runs", () => {
  beforeEach(() => resetGraphify());
  const project = { id: 1, name: "r", root: os.tmpdir() };

  it("update: argv, env GRAPHIFY_MAX_WORKERS=4, 180 s, single-flight per root", async () => {
    const calls: Parameters<typeof runTrail>[] = [];
    const pending = Promise.withResolvers<TrailOut>();
    const run = ((args, o) => {
      calls.push([args, o]);
      return pending.promise;
    }) as typeof runTrail;
    const u = startUpdate(project, { run, command: CMD });
    expect("state" in u && u.state).toBe("running");
    expect(calls[0][0]).toEqual(["update", ".", "--no-cluster"]);
    expect(calls[0][1]).toMatchObject({ cwd: project.root, timeoutMs: UPDATE_TIMEOUT_MS, env: { GRAPHIFY_MAX_WORKERS: "4" } });
    const again = startUpdate(project, { run, command: CMD });
    expect("status" in again && again.status).toBe(409);
    pending.resolve(ok("done\n"));
    await pending.promise;
    await Promise.resolve();
    expect(updateState(project.root)?.state).toBe("done");
    expect("state" in startUpdate(project, { run, command: CMD })).toBe(true);
  });

  it("missing graphify: a clear message, not a crash", async () => {
    expect(startUpdate(project, { command: null })).toEqual({ error: MISSING_TEXT, status: 503 });
    expect(await graphifyAsk(project.root, explainArgs("x"), { command: null })).toMatchObject({ ok: false, error: MISSING_TEXT, status: 503 });
    const run = (async () => ({ ...ok(), ok: false, missing: true })) as typeof runTrail;
    expect(await graphifyAsk(project.root, explainArgs("x"), { run, command: CMD })).toMatchObject({ ok: false, status: 503 });
  });

  it("explain: 30 s, the printed text", async () => {
    let seen: Parameters<typeof runTrail>[1] | null = null;
    const run = (async (_a, o) => {
      seen = o;
      return ok("\u001b[1mNode\u001b[0m startBuild\r\n");
    }) as typeof runTrail;
    expect(await graphifyAsk(project.root, explainArgs("startBuild"), { run, command: CMD })).toEqual({ ok: true, text: "Node startBuild" });
    expect(seen).toMatchObject({ timeoutMs: ASK_TIMEOUT_MS });
  });
});

describe("route", () => {
  let token = "";
  let id = 0;
  beforeAll(() => {
    tempHome();
    token = getToken();
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-graphify-route-")));
    id = Number(getDb().prepare("INSERT INTO projects(path, name, added_at) VALUES (?, ?, ?)").run(root, "repo", Date.now()).lastInsertRowid);
  });
  const post = (body: unknown, origin: string | undefined = ORIGIN) => POST(req("/api/codemap/graphify", { method: "POST", token, origin, body }));

  it("needs the token and a same-origin POST", async () => {
    expect((await GET(req(`/api/codemap/graphify?project=${id}`))).status).toBe(401);
    expect((await post({ project: id, action: "explain", symbol: "x" }, "https://evil.example")).status).toBe(403);
  });

  it("resolves the root by id only and validates arguments before running anything", async () => {
    expect((await post({ project: os.tmpdir(), action: "update" })).status).toBe(422);
    expect((await post({ project: 99999, action: "update" })).status).toBe(404);
    expect((await post({ project: id, action: "query", symbol: "x" })).status).toBe(422);
    expect((await post({ project: id, action: "explain", symbol: "-x" })).status).toBe(422);
    expect((await post({ project: id, action: "explain", symbol: "a".repeat(SYMBOL_MAX + 1) })).status).toBe(422);
    expect((await post({ project: id, action: "path", a: "A", b: "x\ny" })).status).toBe(422);
  });
});
