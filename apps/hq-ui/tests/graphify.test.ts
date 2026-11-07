import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/codemap/graphify/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import {
  ASK_CACHE_MAX,
  ASK_CACHE_MS,
  ASK_TIMEOUT_MS,
  checkRoot,
  checkSymbol,
  explainArgs,
  graphifyAsk,
  graphifyCommand,
  MISSING_TEXT,
  NO_GRAPH_TEXT,
  pathArgs,
  resetGraphify,
  startUpdate,
  SYMBOL_MAX,
  UPDATE_TIMEOUT_MS,
  updateArgs,
  updateState,
} from "@/lib/server/graphify";
import { OUTPUT_CAP, type runTrail, type TrailOut } from "@/lib/server/trail";
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

  it("explain: argv as one array (no shell), 30 s, OUTPUT_CAP, the printed text", async () => {
    let seen: Parameters<typeof runTrail> | null = null;
    const run = (async (a, o) => {
      seen = [a, o];
      return ok("\u001b[1mNode\u001b[0m startBuild\r\n");
    }) as typeof runTrail;
    expect(await graphifyAsk(project.root, explainArgs("startBuild; rm -rf /"), { run, command: CMD })).toEqual({ ok: true, text: "Node startBuild", cached: false });
    expect(seen![0]).toEqual(["explain", "startBuild; rm -rf /"]);
    expect(seen![1]).toMatchObject({ cwd: project.root, timeoutMs: ASK_TIMEOUT_MS, cap: OUTPUT_CAP, command: CMD });
    expect(ASK_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("timeout and output cap: refused with a reason, never cached", async () => {
    let calls = 0;
    const slow = (async () => (calls++, { ...ok("partial"), ok: false, timedOut: true })) as typeof runTrail;
    expect(await graphifyAsk(project.root, explainArgs("x"), { run: slow, command: CMD })).toMatchObject({ ok: false, status: 504 });
    expect(await graphifyAsk(project.root, explainArgs("x"), { run: slow, command: CMD })).toMatchObject({ ok: false, status: 504 });
    expect(calls).toBe(2);
    const big = (async () => ({ ...ok("x".repeat(10)), ok: false, capped: true })) as typeof runTrail;
    expect(await graphifyAsk(project.root, explainArgs("y"), { run: big, command: CMD })).toMatchObject({ ok: false, status: 413 });
    const broken = (async () => ({ ...ok(), ok: false, code: 1, stderr: "error: graph file not found" })) as typeof runTrail;
    expect(await graphifyAsk(project.root, explainArgs("z"), { run: broken, command: CMD })).toMatchObject({ ok: false, status: 502 });
  });

  it("exit 3 (ambiguous, on stderr) and 4 (no such node) are answers", async () => {
    const amb = (async () => ({ ...ok(), ok: false, code: 3, stderr: "Ambiguous: 'open()' matches 2 nodes in different files.\n" })) as typeof runTrail;
    expect(await graphifyAsk(project.root, explainArgs("open()"), { run: amb, command: CMD })).toMatchObject({ ok: true, text: "Ambiguous: 'open()' matches 2 nodes in different files." });
    const none = (async () => ({ ...ok("No node matching 'q' found.\n"), ok: false, code: 4 })) as typeof runTrail;
    expect(await graphifyAsk(project.root, explainArgs("q"), { run: none, command: CMD })).toMatchObject({ ok: true, text: "No node matching 'q' found." });
  });

  it("cache: same root + argv within a minute answers from memory; another root, argv or an update runs again", async () => {
    let t = 1_000;
    let calls = 0;
    const run = (async () => (calls++, ok(`answer ${calls}`))) as typeof runTrail;
    const ask = (args: string[], root = project.root) => graphifyAsk(root, args, { run, command: CMD, now: () => t });
    expect(await ask(explainArgs("a"))).toEqual({ ok: true, text: "answer 1", cached: false });
    t += ASK_CACHE_MS - 1;
    expect(await ask(explainArgs("a"))).toEqual({ ok: true, text: "answer 1", cached: true });
    expect(calls).toBe(1);
    expect(await ask(pathArgs("a", "b"))).toMatchObject({ cached: false });
    expect(await ask(explainArgs("a"), path.join(project.root, "other-root"))).toMatchObject({ cached: false });
    t += 1;
    expect(await ask(explainArgs("a"))).toEqual({ ok: true, text: "answer 4", cached: false });
    // A graph rebuild forgets the root's answers.
    const pending = Promise.withResolvers<TrailOut>();
    startUpdate(project, { run: () => pending.promise, command: CMD });
    expect(await ask(explainArgs("a"))).toMatchObject({ cached: false });
    expect(calls).toBe(5);
    pending.resolve(ok());
  });

  it("cache holds at most ASK_CACHE_MAX answers, oldest out first", async () => {
    const run = (async (a) => ok(a.join(" "))) as typeof runTrail;
    for (let i = 0; i <= ASK_CACHE_MAX; i++) await graphifyAsk(project.root, explainArgs(`s${i}`), { run, command: CMD });
    expect(await graphifyAsk(project.root, explainArgs(`s${ASK_CACHE_MAX}`), { run, command: CMD })).toMatchObject({ cached: true });
    expect(await graphifyAsk(project.root, explainArgs("s0"), { run, command: CMD })).toMatchObject({ cached: false });
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

  it("update: the owner's page only, a room (hq.mjs: token, no page marker) gets 403", async () => {
    const r = await post({ project: id, action: "update" });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: expect.stringMatching(/Chỉ chủ HQ/) });
  });

  it("explain/path on a repo with no graph: 409 with what to do, graphify never runs", async () => {
    const r = await post({ project: id, action: "explain", symbol: "x" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: NO_GRAPH_TEXT });
    expect((await post({ project: id, action: "path", a: "A", b: "B" })).status).toBe(409);
  });
});
