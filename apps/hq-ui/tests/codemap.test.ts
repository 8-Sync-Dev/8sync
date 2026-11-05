import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as STATUS } from "@/app/api/codemap/route";
import { POST as BUILD } from "@/app/api/codemap/build/route";
import { GET as GRAPH } from "@/app/api/codemap/graph/route";
import { GET as MAP } from "@/app/api/codemap/map/route";
import { GET as SEARCH } from "@/app/api/codemap/search/route";
import { GET as SKELETON } from "@/app/api/codemap/skeleton/route";
import { deniedText, GUEST_ROLES } from "@/lib/access";
import { buildProgress, checkProjectId, GRAPH_CSP, graphSrcDoc, checkQuery, checkRelFile, parseAsk, parseGrep, parseMap, parseSkeleton, type BuildState, type CodeMap, type CodemapStatus, type SearchResult, type Skeleton } from "@/lib/codemap";
import { getToken, sessionSecret } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { createInvite, GUEST_COOKIE, guestCookie } from "@/lib/server/invites";
import { BUILDS_MAX, OUTPUT_CAP, READS_MAX, refusalOf, resetTrail, runTrail, startBuild, trailCommand, trailRead, type TrailOut } from "@/lib/server/trail";
import { ORIGIN, req, tempHome } from "./helpers";

const FIX = path.join(import.meta.dirname, "fixtures", "trail");
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), "utf8"));
const win = process.platform === "win32";

describe("trail output → the tab's model (real captured samples)", () => {
  it("turns `trail map --json` into modules → folders/files → symbol counts", () => {
    const m = parseMap(fixture("map")) as CodeMap;
    expect(m.totals).toMatchObject({ files: 518, symbols: 7904, edges: 18870 });
    expect(m.scopes.map((s) => s.scope)).toEqual(["apps/hq-channel/", "apps/hq-ui/", "(root)"]);
    const ui = m.scopes[1];
    expect(ui.entries[0]).toMatchObject({ path: "apps/hq-ui/lib", label: "lib", isFile: false, files: 80, symbols: 918 });
    expect(ui.files).toBe(ui.entries.reduce((n, e) => n + e.files, 0));
    expect(ui.entries[0].hubs[0]).toEqual({ name: "bad", kind: "function", path: "apps/hq-ui/lib/server/http.ts", line: expect.any(Number), inDegree: 40 });
    const file = m.scopes[0].entries[0];
    expect(file).toMatchObject({ path: "apps/hq-channel/src/channel.ts", label: "src/channel.ts", isFile: true, symbols: 26 });
    expect(file.hubs.map((h) => [h.name, h.line])).toEqual([
      ["call", 118],
      ["HqClient", 108],
      ["runPoller", 177],
    ]);
    // "(root)" rows keep their whole path.
    expect(m.scopes[2].entries[0].label).toBe("assets/skills");
    expect(m.hotspots[0]).toMatchObject({ name: "join", path: "crates/cli/src/verbs/ccc/omp_term.rs", line: 260, inDegree: 689 });
  });

  it("puts a repo trail does not split into scopes under one (root) module, and refuses what is not a map", () => {
    const m = parseMap({ totals: { files: 2, symbols: 3, edges: 1, languages: ["rust"] }, dirs: [{ path: "src/main.rs", files: 1, symbols: 3, hubs: [], isFile: true }], scopes: [], hotspots: [] });
    expect(m?.scopes).toEqual([{ scope: "(root)", files: 1, symbols: 3, dropped: 0, entries: [expect.objectContaining({ path: "src/main.rs", label: "src/main.rs", isFile: true })] }]);
    expect(parseMap(fixture("ask"))).toBeNull();
    expect(parseMap(null)).toBeNull();
  });

  it("gives ask and grep hits a file and a line, and a skeleton its signatures", () => {
    const ask = parseAsk(fixture("ask")) as SearchResult;
    expect(ask.hits[0]).toMatchObject({ file: "apps/hq-ui/lib/server/answer.ts", line: 22, title: "Spawn", kind: "type" });
    expect(ask.hits.every((h) => h.file && h.line)).toBe(true);
    const grep = parseGrep(fixture("grep")) as SearchResult;
    expect(grep.total).toBe(16);
    expect(grep.hits[0]).toMatchObject({ file: "apps/hq-ui/lib/server/child-env.ts", line: 16, title: "childEnv", kind: "function" });
    expect(grep.hits[1]).toMatchObject({ file: "apps/hq-ui/lib/server/proc.ts", line: 26, title: "run" });
    const sk = parseSkeleton(fixture("skeleton")) as Skeleton;
    expect(sk.file).toBe("apps/hq-ui/lib/server/child-env.ts");
    expect(sk.entries.map((e) => [e.name, e.line])).toEqual([
      ["Env", 6],
      ["childEnv", 13],
      ["binFor", 24],
    ]);
    expect(parseGrep(fixture("map"))).toBeNull();
  });

  it("puts graph.html under the frame's CSP before anything in the file, keeping standards mode", () => {
    const doc = graphSrcDoc("\uFEFF<!DOCTYPE html>\n<script>early()</script><html><head><script src=\"https://evil.example/x.js\"></script></head></html>");
    expect(doc.startsWith(`<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${GRAPH_CSP.replace(/"/g, "&quot;")}">`)).toBe(true);
    expect(doc.match(/<!doctype/gi)).toHaveLength(1);
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("early()"));
    // The policy itself: no network but the pinned vis-network graphify loads, no forms or frames.
    expect(GRAPH_CSP).toMatch(/default-src 'none'/);
    expect(GRAPH_CSP).toMatch(/connect-src 'none'/);
    expect(GRAPH_CSP).not.toMatch(/https:\/\/[^ ;]*\/(?:;|\s|$)|\*|'unsafe-eval'/);
  });

  it("reads build progress from trail's rewritten `parsing N/M` line", () => {
    expect(buildProgress("parsing 1/587: a.ts   \rparsing 152/587: b.ts\r")).toEqual({ done: 152, total: 587 });
    expect(buildProgress("✓ wiring: 9115 nodes")).toBeNull();
  });
});

describe("what the browser may ask for", () => {
  it("takes a query as text: no empty, overlong, control-char or stdin `-` query, no broken regex for grep", () => {
    expect(checkQuery("ask", "  where is login?  ")).toEqual({ ok: true, value: "where is login?" });
    expect(checkQuery("ask", "-- rm -rf; $(x)")).toEqual({ ok: true, value: "-- rm -rf; $(x)" });
    for (const bad of ["", "   ", "-", "a\nb", "a\u0000", "x".repeat(301), 42, null]) expect(checkQuery("ask", bad).ok, JSON.stringify(bad)).toBe(false);
    expect(checkQuery("grep", "(").ok).toBe(false);
    expect(checkQuery("ask", "(").ok).toBe(true);
  });

  it("takes only repo-relative files: no absolute, drive, UNC, `..` or stream paths", () => {
    expect(checkRelFile("apps\\hq-ui\\lib\\x.ts")).toEqual({ ok: true, value: "apps/hq-ui/lib/x.ts" });
    for (const bad of ["/etc/passwd", "C:\\Windows\\win.ini", "c:x", "\\\\host\\share\\a", "../secret", "a/../../b", "a/./b", "a//b", "a.ts:stream", "", 7]) {
      expect(checkRelFile(bad).ok, String(bad)).toBe(false);
    }
  });

  it("takes a project id only as a positive integer", () => {
    expect(checkProjectId("12")).toEqual({ ok: true, value: 12 });
    expect(checkProjectId(3)).toEqual({ ok: true, value: 3 });
    for (const bad of ["0", "-1", "1.5", "1e3", "C:\\repo", "", null, "1 OR 1=1"]) expect(checkProjectId(bad).ok, String(bad)).toBe(false);
  });
});

describe("finding trail without a shell", () => {
  const SHIM = [
    "@ECHO off",
    "GOTO start",
    ":start",
    "SETLOCAL",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    ")",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@trailhq\\trail-code\\dist\\bin\\trail.js" %*',
  ].join("\r\n");
  const fsx = (files: Record<string, string>) => ({ exists: (p: string) => p in files, read: (p: string) => files[p] ?? "" });
  const script = "C:\\npm\\node_modules\\@trailhq\\trail-code\\dist\\bin\\trail.js";

  it("runs an npm .cmd shim's script under node (the HQ's node when the shim has none of its own)", () => {
    const env = { Path: "C:\\empty;C:\\npm" };
    expect(trailCommand({ env, platform: "win32", execPath: "C:\\node\\node.exe", fsx: fsx({ "C:\\npm\\trail.cmd": SHIM, [script]: "" }) })).toEqual({ cmd: "C:\\node\\node.exe", pre: [script] });
    expect(trailCommand({ env, platform: "win32", execPath: "C:\\node\\node.exe", fsx: fsx({ "C:\\npm\\trail.cmd": SHIM, [script]: "", "C:\\npm\\node.exe": "" }) })).toEqual({ cmd: "C:\\npm\\node.exe", pre: [script] });
  });

  it("prefers a real trail.exe, skips a shim it cannot read safely, and says null when there is none", () => {
    const env = { PATH: "C:\\a;C:\\b" };
    expect(trailCommand({ env, platform: "win32", fsx: fsx({ "C:\\a\\trail.exe": "", "C:\\b\\trail.cmd": SHIM }) })).toEqual({ cmd: "C:\\a\\trail.exe", pre: [] });
    expect(trailCommand({ env, platform: "win32", fsx: fsx({ "C:\\a\\trail.cmd": "@echo off\r\ncalc.exe %*" }) })).toBeNull();
    expect(trailCommand({ env, platform: "win32", fsx: fsx({ "C:\\a\\trail.cmd": SHIM }) })).toBeNull(); // script it names is gone
    expect(trailCommand({ env: { PATH: "/usr/bin:/opt/t/bin" }, platform: "linux", fsx: fsx({ "/opt/t/bin/trail": "" }) })).toEqual({ cmd: "/opt/t/bin/trail", pre: [] });
    expect(trailCommand({ env: {}, platform: "linux", fsx: fsx({}) })).toBeNull();
  });
});

describe("running trail: argv, timeout, output cap", () => {
  const node = (code: string) => ({ cmd: process.execPath, pre: ["-e", code] });
  let cwd = "";
  beforeAll(() => {
    cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-trail-run-")));
  });

  it("hands every argument over verbatim (no shell to read `&`, `|`, `$()` or quotes)", async () => {
    const args = ["grep", "--", 'a "b" & calc | x %PATH% $(id) `id`', "C:\\repo with space"];
    const r = await runTrail(args, { cwd, timeoutMs: 20_000, cap: OUTPUT_CAP, command: node("process.stdout.write(JSON.stringify(process.argv.slice(1)))") });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.stdout)).toEqual(args);
  });

  it("stops a run that passes its timeout, and says so", async () => {
    const t0 = Date.now();
    const r = await runTrail([], { cwd, timeoutMs: 400, cap: OUTPUT_CAP, command: node("setInterval(() => {}, 1000)") });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(refusalOf(r)).toMatchObject({ status: 504 });
  });

  it("keeps only the first OUTPUT_CAP bytes of a run that prints more, and stops it", async () => {
    const r = await runTrail([], { cwd, timeoutMs: 20_000, cap: OUTPUT_CAP, command: node(`const b = "x".repeat(64 * 1024); let i = 0; (function w() { if (i++ < 40) process.stdout.write(b, w); })();`) });
    expect(r).toMatchObject({ ok: false, capped: true });
    expect(Buffer.byteLength(r.stdout)).toBe(OUTPUT_CAP);
    expect(refusalOf(r)).toMatchObject({ status: 413 });
  });

  it("answers 503 when trail is not on the machine, 502 with trail's own error otherwise", async () => {
    const r = await runTrail(["map"], { cwd, timeoutMs: 5000, cap: OUTPUT_CAP, command: null });
    expect(refusalOf(r)).toMatchObject({ status: 503 });
    const bad = await runTrail([], { cwd, timeoutMs: 20_000, cap: OUTPUT_CAP, command: node(`process.stderr.write("\\u001b[31m✗ invalid pattern\\u001b[0m\\n"); process.exit(1)`) });
    expect(refusalOf(bad)).toEqual({ status: 502, error: "trail lỗi: ✗ invalid pattern" });
  });

  it("refuses a read past READS_MAX at once, and a second build of the same project or past BUILDS_MAX", async () => {
    resetTrail();
    const waits: (() => void)[] = [];
    const done: TrailOut = { ok: true, code: 0, stdout: "{}", stderr: "", timedOut: false, capped: false, missing: false };
    const slow = () => {
      const { promise, resolve } = Promise.withResolvers<TrailOut>();
      waits.push(() => resolve(done));
      return promise;
    };
    const running = Array.from({ length: READS_MAX }, () => trailRead(cwd, ["map"], slow));
    expect(await trailRead(cwd, ["map"], slow)).toMatchObject({ status: 429 });
    waits.forEach((w) => w());
    await Promise.all(running);
    waits.length = 0;
    expect(await trailRead(cwd, ["map"], async () => done)).toBe(done);

    const p = (id: number) => ({ id, name: `p${id}`, root: cwd });
    expect(startBuild(p(1), slow)).toMatchObject({ state: "running" });
    expect(startBuild(p(1), slow)).toMatchObject({ status: 409 });
    for (let id = 2; id <= BUILDS_MAX; id++) startBuild(p(id), slow);
    expect(startBuild(p(99), slow)).toMatchObject({ status: 429 });
    waits.forEach((w) => w());
    resetTrail();
  });

  it("keeps reads and builds server-wide: another bundle's copy of the module sees and counts them", async () => {
    resetTrail();
    vi.resetModules();
    const other = await import("@/lib/server/trail");
    expect(other.startBuild).not.toBe(startBuild);
    const { promise, resolve } = Promise.withResolvers<TrailOut>();
    const done: TrailOut = { ok: true, code: 0, stdout: "{}", stderr: "", timedOut: false, capped: false, missing: false };
    expect(startBuild({ id: 7, name: "p7", root: cwd }, () => promise)).toMatchObject({ state: "running" });
    expect(other.buildState(7)).toMatchObject({ state: "running" });
    expect(other.startBuild({ id: 7, name: "p7", root: cwd }, () => promise)).toMatchObject({ status: 409 });
    const held = Array.from({ length: READS_MAX }, () => trailRead(cwd, ["map"], () => promise));
    expect(await other.trailRead(cwd, ["map"], async () => done)).toMatchObject({ status: 429 });
    resolve(done);
    await Promise.all(held);
    resetTrail();
  });
});

describe("/api/codemap routes", () => {
  let token = "";
  let root = "";
  let outside = "";
  let id = 0;
  let gone = 0;
  let log = "";
  const savedPath = process.env.PATH;
  const savedWinPath = process.env.Path;
  const get = (url: string) => req(url, { token });
  const body = async <T>(r: Response) => (await r.json()) as T;

  beforeAll(() => {
    tempHome();
    token = getToken();
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-codemap-")));
    root = path.join(base, "repo");
    outside = path.join(base, "outside");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(outside, "secret.ts"), "export const key = 'x';\n");
    // A folder link inside the repo that leads out of it (a junction needs no admin on Windows).
    fs.symlinkSync(outside, path.join(root, "escape"), "junction");
    // A fake `trail` on PATH: on Windows a real npm-style .cmd shim, so the shim reader is what finds it.
    const bin = path.join(base, "bin");
    fs.mkdirSync(bin);
    log = path.join(base, "argv.log");
    const fake = [
      'const fs = require("node:fs"), path = require("node:path");',
      "const a = process.argv.slice(2);",
      "fs.appendFileSync(process.env.FAKE_TRAIL_LOG, JSON.stringify(a) + '\\n');",
      'if (a[0] === "build") {',
      '  const dir = path.join(a[1], ".trail", "cache", ".graph");',
      "  fs.mkdirSync(dir, { recursive: true });",
      '  process.stderr.write("parsing 1/2: src/a.ts\\rparsing 2/2: src/b.ts\\r");',
      '  fs.writeFileSync(path.join(dir, "wiring.json"), "{}");',
      '  process.stdout.write("✓ wiring: 2 nodes\\n");',
      '} else process.stdout.write(fs.readFileSync(path.join(process.env.FAKE_TRAIL_FIX, a[0] + ".json")));',
    ].join("\n");
    if (win) {
      fs.writeFileSync(path.join(bin, "fake-trail.cjs"), fake);
      fs.writeFileSync(path.join(bin, "trail.cmd"), `@ECHO off\r\n"%_prog%"  "%dp0%\\fake-trail.cjs" %*\r\n`);
    } else {
      fs.writeFileSync(path.join(bin, "trail"), `#!/usr/bin/env node\n${fake}`, { mode: 0o755 });
    }
    const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    process.env[key] = `${bin}${path.delimiter}${process.env[key] ?? ""}`;
    process.env.FAKE_TRAIL_LOG = log;
    process.env.FAKE_TRAIL_FIX = FIX;
    const db = getDb();
    const add = db.prepare("INSERT INTO projects(path, name, added_at) VALUES (?, ?, ?)");
    id = Number(add.run(root, "repo", Date.now()).lastInsertRowid);
    gone = Number(add.run(path.join(base, "deleted"), "deleted", Date.now()).lastInsertRowid);
  });
  afterAll(() => {
    process.env.PATH = savedPath;
    if (savedWinPath !== undefined) process.env.Path = savedWinPath;
  });
  beforeEach(() => {
    resetTrail();
    fs.rmSync(log, { force: true });
  });
  const argv = (): string[][] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

  it("resolves only registered projects by id: 422 for a path or junk, 404 unknown, 410 folder gone", async () => {
    expect((await STATUS(get(`/api/codemap?project=${encodeURIComponent(root)}`))).status).toBe(422);
    expect((await STATUS(get("/api/codemap"))).status).toBe(422);
    expect((await STATUS(get("/api/codemap?project=99999"))).status).toBe(404);
    expect((await STATUS(get(`/api/codemap?project=${gone}`))).status).toBe(410);
    expect((await STATUS(req(`/api/codemap?project=${id}`))).status).toBe(401);
  });

  it("before a build: not indexed, and map / search / skeleton say so with 409", async () => {
    const st = await body<CodemapStatus>(await STATUS(get(`/api/codemap?project=${id}`)));
    expect(st).toMatchObject({ project: { id, name: "repo", root }, trail: true, index: { indexed: false, builtAt: null }, build: null, graph: { dir: false, html: null } });
    expect((await MAP(get(`/api/codemap/map?project=${id}`))).status).toBe(409);
    expect((await SEARCH(get(`/api/codemap/search?project=${id}&mode=ask&q=x`))).status).toBe(409);
    expect((await SKELETON(get(`/api/codemap/skeleton?project=${id}&file=src/a.ts`))).status).toBe(409);
    expect(argv()).toEqual([]);
  });

  it("refuses a build from a guest, from a page on another origin, and without an Origin", async () => {
    const { invite } = createInvite({ label: "khách", role: "editor", days: 1 });
    const cookie = guestCookie({ id: invite.id, role: "editor", issued: Date.now() }, sessionSecret());
    const guest = new Request(`${ORIGIN}/api/codemap/build`, { method: "POST", headers: { host: "127.0.0.1:8740", origin: ORIGIN, cookie: `${GUEST_COOKIE}=${cookie}`, "content-type": "application/json" }, body: JSON.stringify({ project: id }) });
    const g = await BUILD(guest);
    expect(g.status).toBe(403);
    expect((await body<{ error: string }>(g)).error).toBe(deniedText("editor"));
    expect((await BUILD(req("/api/codemap/build", { method: "POST", token, origin: "https://evil.example", body: { project: id } }))).status).toBe(403);
    expect((await BUILD(req("/api/codemap/build", { method: "POST", token, body: { project: id } }))).status).toBe(403);
    expect((await BUILD(req("/api/codemap/build", { method: "POST", token, origin: ORIGIN, body: { project: root } }))).status).toBe(422);
    expect(argv()).toEqual([]);
  });

  it("keeps every guest role out of each read route", async () => {
    const urls = [`/api/codemap?project=${id}`, `/api/codemap/map?project=${id}`, `/api/codemap/search?project=${id}&mode=ask&q=x`, `/api/codemap/skeleton?project=${id}&file=src/a.ts`, `/api/codemap/graph?project=${id}`];
    const routes = [STATUS, MAP, SEARCH, SKELETON, GRAPH];
    for (const role of GUEST_ROLES) {
      const { invite } = createInvite({ label: `khách ${role}`, role, days: 1 });
      const cookie = guestCookie({ id: invite.id, role, issued: Date.now() }, sessionSecret());
      for (const [i, url] of urls.entries()) {
        const r = await routes[i](new Request(`${ORIGIN}${url}`, { headers: { host: "127.0.0.1:8740", cookie: `${GUEST_COOKIE}=${cookie}` } }));
        expect(r.status, `${role} ${url}`).toBe(403);
      }
    }
    expect(argv()).toEqual([]);
  });

  it("builds in the project root, shows progress, then the index and its build time", async () => {
    const r = await BUILD(req("/api/codemap/build", { method: "POST", token, origin: ORIGIN, body: { project: id } }));
    expect(r.status).toBe(202);
    let st: CodemapStatus | null = null;
    // A real child process runs the build: wait for its state to change, as the tab does.
    for (let i = 0; i < 200; i++) {
      st = await body<CodemapStatus>(await STATUS(get(`/api/codemap?project=${id}`)));
      if (st.build?.state !== "running") break;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(st?.build).toMatchObject({ state: "done", progress: { done: 2, total: 2 }, error: null } satisfies Partial<BuildState>);
    expect(st?.build?.tail).toBe("✓ wiring: 2 nodes");
    expect(st?.index).toEqual({ indexed: true, builtAt: fs.statSync(path.join(root, ".trail", "cache", ".graph", "wiring.json")).mtimeMs, dir: ".trail/cache" });
    expect(argv()).toEqual([["build", root]]);
  });

  it("serves the map, ask and grep hits with file:line, passing the query as one argument after `--`", async () => {
    const m = await body<{ map: CodeMap }>(await MAP(get(`/api/codemap/map?project=${id}`)));
    expect(m.map.scopes).toHaveLength(3);
    const q = "-n 1 --source; & echo";
    const ask = await body<SearchResult>(await SEARCH(get(`/api/codemap/search?project=${id}&mode=ask&q=${encodeURIComponent(q)}`)));
    expect(ask.hits[0]).toMatchObject({ file: "apps/hq-ui/lib/server/answer.ts", line: 22 });
    const grep = await body<SearchResult>(await SEARCH(get(`/api/codemap/search?project=${id}&mode=grep&q=childEnv`)));
    expect(grep.hits[0]).toMatchObject({ file: "apps/hq-ui/lib/server/child-env.ts", line: 16 });
    expect(argv()).toEqual([
      ["map", "--json", "--no-refresh", root],
      ["ask", "--json", "--no-refresh", "-n", "20", "--", q, root],
      ["grep", "--json", "--no-refresh", "-i", "--", "childEnv", root],
    ]);
    expect((await SEARCH(get(`/api/codemap/search?project=${id}&mode=shell&q=x`))).status).toBe(422);
    expect((await SEARCH(get(`/api/codemap/search?project=${id}&mode=grep&q=(`))).status).toBe(422);
  });

  it("skeleton: a file inside the project only; `..`, absolute paths and a link out of the repo are refused", async () => {
    const ok = await SKELETON(get(`/api/codemap/skeleton?project=${id}&file=src/a.ts`));
    expect(ok.status).toBe(200);
    expect((await body<{ skeleton: Skeleton }>(ok)).skeleton.entries.map((e) => e.name)).toEqual(["Env", "childEnv", "binFor"]);
    for (const f of ["../outside/secret.ts", path.join(outside, "secret.ts"), "/etc/passwd"]) {
      expect((await SKELETON(get(`/api/codemap/skeleton?project=${id}&file=${encodeURIComponent(f)}`))).status, f).toBe(422);
    }
    expect((await SKELETON(get(`/api/codemap/skeleton?project=${id}&file=escape/secret.ts`))).status).toBe(404);
    expect((await SKELETON(get(`/api/codemap/skeleton?project=${id}&file=src/none.ts`))).status).toBe(404);
    expect(argv()).toEqual([["skeleton", "--json", "--no-refresh", "--", "src/a.ts", root]]);
  });

  it("graphify: graph.html as sandboxed text; none, or a graphify-out that links out of the repo, is 404", async () => {
    expect((await GRAPH(get(`/api/codemap/graph?project=${id}`))).status).toBe(404);
    fs.symlinkSync(outside, path.join(root, "graphify-out"), "junction");
    fs.writeFileSync(path.join(outside, "graph.html"), "<script>steal()</script>");
    expect((await GRAPH(get(`/api/codemap/graph?project=${id}`))).status).toBe(404);
    expect((await body<CodemapStatus>(await STATUS(get(`/api/codemap?project=${id}`)))).graph).toEqual({ dir: false, html: null });
    fs.rmSync(path.join(root, "graphify-out"), { recursive: false, force: true });
    fs.mkdirSync(path.join(root, "graphify-out"));
    expect((await body<CodemapStatus>(await STATUS(get(`/api/codemap?project=${id}`)))).graph).toEqual({ dir: true, html: null });
    fs.writeFileSync(path.join(root, "graphify-out", "graph.html"), "<html>graph</html>");
    const r = await GRAPH(get(`/api/codemap/graph?project=${id}`));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(r.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(await r.text()).toBe("<html>graph</html>");
    expect((await body<CodemapStatus>(await STATUS(get(`/api/codemap?project=${id}`)))).graph).toMatchObject({ dir: true, html: { size: 18 } });
    // A hard link to a file outside the repo is a regular file with two names: refused.
    fs.rmSync(path.join(root, "graphify-out", "graph.html"));
    fs.writeFileSync(path.join(outside, "other.html"), "<html>outside</html>");
    fs.linkSync(path.join(outside, "other.html"), path.join(root, "graphify-out", "graph.html"));
    expect((await GRAPH(get(`/api/codemap/graph?project=${id}`))).status).toBe(404);
  });
});
