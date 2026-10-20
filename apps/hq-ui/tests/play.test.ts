import { beforeAll, describe, expect, it, vi } from "vitest";

const merged = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/server/proc", async (orig) => ({ ...(await orig<typeof import("@/lib/server/proc")>()), mergedSessions: merged }));
vi.mock("@/lib/server/floor", async (orig) => ({ ...(await orig<typeof import("@/lib/server/floor")>()), loadFloor: async () => [] }));

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as fileRoute from "@/app/api/play/[key]/[[...path]]/route";
import * as playRoute from "@/app/api/play/route";
import * as autoRoute from "@/app/api/auto/route";
import * as messagesRoute from "@/app/api/messages/route";
import * as officeRoute from "@/app/api/office/route";
import * as projectsRoute from "@/app/api/projects/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { playRootDir, playSecretPath } from "@/lib/server/paths";
import {
  addArgs,
  buildArgs,
  buildScript,
  checkoutArgs,
  fetchArgs,
  installArgs,
  KEY_RE,
  npmCommand,
  parseStamp,
  playSecret,
  playSig,
  playSigValid,
  playUrl,
  SIG_RE,
  playDir,
  playKey,
  playSegments,
  playState,
  playStatus,
  playType,
  pushLog,
  resolvePlayFile,
  startPlayBuild,
  STAMP,
  waitPlayBuild,
} from "@/lib/server/play";
import nextConfig from "../next.config";
import { PLAY_HEADERS, PLAY_SANDBOX } from "@/lib/play-headers";
import { ORIGIN, req, tempHome } from "./helpers";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);

let token = "";
let base = "";
beforeAll(() => {
  tempHome();
  process.env.APPDATA = path.join(process.env.HOME!, "AppData", "Roaming");
  process.env.XDG_DATA_HOME = path.join(process.env.HOME!, ".local", "share");
  token = getToken();
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-play-")));
});

describe("playSegments: only plain relative file paths", () => {
  it("maps the bare key to index.html and decodes each segment", () => {
    expect(playSegments("")).toEqual(["index.html"]);
    expect(playSegments("assets/index-B2x.js")).toEqual(["assets", "index-B2x.js"]);
    expect(playSegments("models/tree%20big.glb")).toEqual(["models", "tree big.glb"]);
    // public demo links never hand out source maps (the repo's source)
    expect(playSegments("assets/index-B2x.js.map")).toBeNull();
    expect(playSegments("assets/index-B2x.js.MAP")).toBeNull();
  });
  it.each([
    "..",
    "../secret",
    "a/../../b",
    "%2e%2e/secret",
    "%2E%2E/secret",
    ".%2e/secret",
    "a%2F..%2F..%2Fsecret",
    "..%5C..%5Csecret",
    "a%5Cb",
    "C:%5CWindows%5Cwin.ini",
    "index.html:stream",
    "a%00b",
    "a%0Ab",
    ".. /x",
    "x.",
    "x%20",
    ".",
    "a//b",
    "a/",
    "%ZZ",
  ])("refuses %s", (p) => {
    expect(playSegments(p)).toBeNull();
  });
});

describe("resolvePlayFile: the real file must stay inside dist", () => {
  let dist = "";
  let outside = "";
  beforeAll(() => {
    const d = fs.mkdtempSync(path.join(base, "dist-case-"));
    dist = path.join(d, "dist");
    outside = path.join(d, "outside");
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(dist, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(dist, "assets", "a.js"), "1");
    fs.writeFileSync(path.join(outside, "secret.txt"), "s");
    fs.writeFileSync(path.join(d, "dist-evil.txt"), "prefix sibling");
    // A junction needs no admin rights on Windows; elsewhere a plain dir symlink.
    fs.symlinkSync(outside, path.join(dist, "out"), process.platform === "win32" ? "junction" : "dir");
  });
  it("serves files under dist", () => {
    expect(resolvePlayFile(dist, ["index.html"])?.size).toBe(13);
    expect(resolvePlayFile(dist, ["assets", "a.js"])?.abs).toBe(fs.realpathSync(path.join(dist, "assets", "a.js")));
  });
  it("refuses a link out of dist, folders, dist itself and missing files", () => {
    expect(resolvePlayFile(dist, ["out", "secret.txt"])).toBeNull();
    expect(resolvePlayFile(dist, ["assets"])).toBeNull();
    expect(resolvePlayFile(dist, [])).toBeNull();
    expect(resolvePlayFile(dist, ["nope.js"])).toBeNull();
    // Path segments a caller forgot to clean still cannot climb out, nor reach a sibling sharing the prefix.
    expect(resolvePlayFile(dist, ["..", "outside", "secret.txt"])).toBeNull();
    expect(resolvePlayFile(dist, ["..", "dist-evil.txt"])).toBeNull();
  });
  it("refuses a file symlink out of dist", (ctx) => {
    try {
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(dist, "s.txt"), "file");
    } catch {
      ctx.skip(); // Windows without Developer Mode cannot make file symlinks
    }
    expect(resolvePlayFile(dist, ["s.txt"])).toBeNull();
  });
});

describe("content types", () => {
  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["a.JS", "text/javascript; charset=utf-8"],
    ["a.mjs", "text/javascript; charset=utf-8"],
    ["a.css", "text/css; charset=utf-8"],
    ["a.wasm", "application/wasm"],
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.glb", "model/gltf-binary"],
    ["a.gltf", "model/gltf+json"],
    ["a.json", "application/json"],
    ["a.svg", "image/svg+xml"],
    ["a.mp3", "audio/mpeg"],
    ["a.ogg", "audio/ogg"],
    ["a.wav", "audio/wav"],
    ["a.unknown", "application/octet-stream"],
    ["noext", "application/octet-stream"],
  ])("%s -> %s", (f, t) => {
    expect(playType(f)).toBe(t);
  });
});

describe("status and stale", () => {
  const stamp = { lockHash: "h", sha: SHA, builtAt: 1000 };
  it("ready when stamped and dist/index.html exists; stale once main moves", () => {
    expect(playState({ job: null, stamp, distOk: true, mainSha: SHA })).toMatchObject({ state: "ready", sha: SHA, builtAt: 1000, stale: false });
    expect(playState({ job: null, stamp, distOk: true, mainSha: SHA2 })).toMatchObject({ state: "ready", stale: true });
    // Unknown main (no origin/main) is not "stale".
    expect(playState({ job: null, stamp, distOk: true, mainSha: null }).stale).toBe(false);
  });
  it("none without a stamped sha or without dist", () => {
    expect(playState({ job: null, stamp, distOk: false, mainSha: SHA }).state).toBe("none");
    expect(playState({ job: null, stamp: { lockHash: "h", sha: null, builtAt: null }, distOk: true, mainSha: SHA }).state).toBe("none");
    expect(playState({ job: null, stamp: null, distOk: true, mainSha: SHA }).state).toBe("none");
  });
  it("a running or failed job wins and is never stale", () => {
    const job = { state: "building" as const, step: "install" as const, log: ["x"], startedAt: 5, error: null };
    expect(playState({ job, stamp, distOk: true, mainSha: SHA2 })).toMatchObject({ state: "building", step: "install", stale: false, startedAt: 5, log: ["x"] });
    const failed = { ...job, state: "failed" as const, step: null, error: "npm run build thất bại" };
    expect(playState({ job: failed, stamp, distOk: true, mainSha: SHA })).toMatchObject({ state: "failed", step: null, error: "npm run build thất bại" });
  });
  it("parseStamp drops junk", () => {
    expect(parseStamp(null)).toBeNull();
    expect(parseStamp("{")).toBeNull();
    expect(parseStamp(JSON.stringify({ lockHash: "h", sha: "not-a-sha", builtAt: 1 }))).toEqual({ lockHash: "h", sha: null, builtAt: null });
    expect(parseStamp(JSON.stringify({ lockHash: 3, sha: SHA, builtAt: 9 }))).toEqual({ lockHash: null, sha: SHA, builtAt: 9 });
  });
  it("buildScript", () => {
    expect(buildScript(JSON.stringify({ scripts: { build: "vite build" } }))).toEqual({ ok: true });
    expect(buildScript(JSON.stringify({ scripts: { dev: "vite" } })).ok).toBe(false);
    expect(buildScript(JSON.stringify({ scripts: { build: " " } })).ok).toBe(false);
    expect(buildScript("nope").ok).toBe(false);
    expect(buildScript(null).ok).toBe(false);
  });
  it("pushLog keeps the last 200 lines, splits \\r redraws, drops ANSI", () => {
    const log: string[] = [];
    const carry = { rest: "" };
    pushLog(log, "\x1b[32mok\x1b[0m\nhalf", carry);
    pushLog(log, " line\r50%\r100%\n", carry);
    expect(log).toEqual(["ok", "half line", "50%", "100%"]);
    for (let i = 0; i < 300; i++) pushLog(log, `l${i}\n`, carry);
    expect(log).toHaveLength(200);
    expect(log.at(-1)).toBe("l299");
  });
});

describe("argv: fixed, the root is one element, never a shell", () => {
  const root = String.raw`C:\p\a b;$(rm -rf ~)&calc|x`;
  it("git steps", () => {
    expect(fetchArgs(root)).toEqual(["-C", root, "fetch", "--no-tags", "origin", "main"]);
    expect(addArgs(root, "D", SHA)).toEqual(["-C", root, "worktree", "add", "--detach", "--force", "D", SHA]);
    expect(checkoutArgs("D", SHA)).toEqual(["-C", "D", "checkout", "--detach", "--force", SHA]);
  });
  it("npm steps", () => {
    expect(installArgs(true)).toEqual(["ci", "--no-audit", "--no-fund"]);
    expect(installArgs(false)).toEqual(["install", "--no-audit", "--no-fund"]);
    expect(buildArgs()).toEqual(["run", "build", "--", "--base", "./"]);
  });
  it("npm runs as node + npm-cli.js when it sits next to node", () => {
    const exec = path.join("X", "node", "node.exe");
    const cli = path.join("X", "node", "node_modules", "npm", "bin", "npm-cli.js");
    expect(npmCommand(exec, (p) => p === cli)).toEqual({ cmd: exec, pre: [cli] });
    const unix = path.join("Y", "lib", "node_modules", "npm", "bin", "npm-cli.js");
    expect(npmCommand(path.join("Y", "bin", "node"), (p) => path.normalize(p) === unix)).toEqual({ cmd: path.join("Y", "bin", "node"), pre: [path.join("Y", "bin", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")] });
    expect(npmCommand("node", () => false)).toEqual({ cmd: "npm", pre: [] });
  });
  it("keys are slugs, stable per root, and the dir lives outside the repo", () => {
    const k = playKey(root);
    expect(k).toMatch(KEY_RE);
    expect(playKey(String.raw`c:/p/a b;$(rm -rf ~)&calc|x/`)).toBe(k);
    expect(playKey("/srv/../..")).toMatch(KEY_RE);
    expect(playDir(k)).toBe(path.join(playRootDir(), k));
    expect(playRootDir({ APPDATA: "C:\\U\\AppData\\Roaming" }, "win32", "C:\\U")).toBe(path.join("C:\\U\\AppData\\Roaming", "8sync", "hq-play"));
    expect(playRootDir({}, "linux", "/home/u")).toBe(path.join("/home/u", ".local", "share", "8sync", "hq-play"));
  });
});

describe("auth: the signature in the path is the only lock", () => {
  const A = "game-a-0123456789";
  const B = "game-b-abcdefabcd";
  it("its own secret: random, 0600 file, not the UI token, shared on globalThis, re-read on change", () => {
    const s = playSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s).not.toBe(token);
    expect(fs.readFileSync(playSecretPath(), "utf8").trim()).toBe(s);
    if (process.platform !== "win32") expect(fs.statSync(playSecretPath()).mode & 0o777).toBe(0o600);
    // A signature keyed by the UI token is refused: the token is not the play key.
    expect(playSigValid(playSig(A, Date.now() + 60_000, token), A)).toBe(false);
    // Rotated on disk (another bundle, or the owner revoking): the next call signs with the new key.
    const next = "c".repeat(64);
    fs.writeFileSync(playSecretPath(), next + "\n");
    fs.utimesSync(playSecretPath(), new Date(), new Date(Date.now() + 5000));
    expect(playSecret()).toBe(next);
    // Gone: made again with `wx`, and every old signature stops working.
    const old = playSig(A, Date.now() + 60_000);
    fs.rmSync(playSecretPath());
    expect(playSecret()).not.toBe(next);
    expect(playSigValid(old, A)).toBe(false);
  });
  it("signatures: exact format, per key, until expiry, at most 12 h ahead, forged ones refused", () => {
    const now = Date.now();
    const sig = playSig(A, now + 60_000);
    expect(sig).toMatch(SIG_RE);
    expect(playSigValid(sig, A, now)).toBe(true);
    expect(playSigValid(sig, B, now)).toBe(false);
    expect(playSigValid(sig, A, now + 60_001)).toBe(false);
    expect(playSigValid(playSig(A, now - 1), A, now)).toBe(false);
    expect(playSigValid(playSig(A, now + 12 * 3600_000 + 1), A, now)).toBe(false);
    const [exp, mac] = sig.split(".");
    expect(playSigValid(`${Number(exp) + 1}.${mac}`, A, now)).toBe(false);
    expect(playSigValid(`${exp}.${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`, A, now)).toBe(false);
    for (const junk of ["", "1", `${exp}.`, `.${mac}`, `${exp}.${mac}x`, `-1.${mac}`, `0${exp}.${mac}`, `${exp}.${mac.toUpperCase()}`]) expect(playSigValid(junk, A, now), junk).toBe(false);
  });
  it("playUrl: signed, 11-12 h, the same URL for a whole hour", () => {
    const t = Date.UTC(2026, 9, 20, 10, 5);
    const u = playUrl(A, t);
    const m = new RegExp(`^/api/play/${A}/(\\d{13}\\.[0-9a-f]{64})/index\\.html$`).exec(u);
    expect(m).not.toBeNull();
    const exp = Number(m![1].split(".")[0]);
    expect(exp - t).toBeGreaterThanOrEqual(11 * 3600_000);
    expect(exp - t).toBeLessThanOrEqual(12 * 3600_000);
    expect(playUrl(A, t + 50 * 60_000)).toBe(u);
    expect(playSigValid(m![1], A, t)).toBe(true);
  });
  it("every other HQ route still refuses a request without the token (old play cookie or not)", async () => {
    const ck = `hq_play=${playSig(A, Date.now() + 60_000)}`;
    const only = (p: string, method = "GET") =>
      new Request(ORIGIN + p, { method, headers: { host: "127.0.0.1:8740", origin: ORIGIN, cookie: ck, ...(method === "GET" ? {} : { "content-type": "application/json" }) }, body: method === "GET" ? undefined : "{}" });
    for (const [name, fn] of [
      ["GET /api/auto", () => autoRoute.GET(only("/api/auto"))],
      ["POST /api/auto", () => autoRoute.POST(only("/api/auto", "POST"))],
      ["GET /api/office", () => officeRoute.GET(only("/api/office"))],
      ["GET /api/projects", () => projectsRoute.GET(only("/api/projects"))],
      ["POST /api/messages", () => messagesRoute.POST(only("/api/messages", "POST"))],
      ["GET /api/play", () => playRoute.GET(only("/api/play?root=x"))],
      ["POST /api/play", () => playRoute.POST(only("/api/play", "POST"))],
    ] as const) {
      expect((await fn()).status, name).toBe(401);
    }
  });
  it("play files: sandboxed opaque origin, framed by HQ only; everything else stays DENY", async () => {
    expect(PLAY_HEADERS["Content-Security-Policy"]).toBe("sandbox allow-scripts allow-pointer-lock allow-popups allow-forms; frame-ancestors 'self'");
    expect(PLAY_HEADERS["Content-Security-Policy"]).not.toContain("allow-same-origin");
    expect(PLAY_SANDBOX).not.toContain("allow-same-origin");
    const rules = await nextConfig.headers!();
    expect(rules[0].source).toBe("/:path*");
    expect(Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]))["X-Frame-Options"]).toBe("DENY");
    const play = rules.find((r) => r.source === "/api/play/:key/:path+");
    expect(Object.fromEntries(play!.headers.map((x) => [x.key, x.value]))).toEqual(PLAY_HEADERS);
    // Later than the global rule, so it overrides it (Next: the last matching key wins).
    expect(rules.indexOf(play!)).toBeGreaterThan(0);
  });
});

/** A repo with an origin and a tiny build that writes dist/ (no network: one `file:` dependency). */
function makeRepo(name: string, pkg: Record<string, unknown> = {}) {
  const dir = path.join(base, name);
  const remote = path.join(base, `${name}-origin.git`);
  fs.mkdirSync(path.join(dir, "dep"), { recursive: true });
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\ndist/\n");
  fs.writeFileSync(path.join(dir, "dep", "package.json"), JSON.stringify({ name: "dep", version: "1.0.0" }));
  fs.writeFileSync(
    path.join(dir, "build.js"),
    `const fs = require("fs");\nif (!fs.existsSync("node_modules/dep/package.json")) { console.error("no deps installed"); process.exit(3); }\nfs.mkdirSync("dist/assets", { recursive: true });\nfs.writeFileSync("dist/index.html", "<script src=\\"./assets/a.js\\"></script><!--" + process.argv.slice(2).join(" ") + "-->");\nfs.writeFileSync("dist/assets/a.js", "1");\nconsole.log("built");\n`,
  );
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "g", version: "1.0.0", scripts: { build: "node build.js" }, dependencies: { dep: "file:./dep" }, ...pkg }));
  const npm = npmCommand();
  execFileSync(npm.cmd, [...npm.pre, "install", "--no-audit", "--no-fund", "--offline"], { cwd: dir, stdio: "ignore" });
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "first");
  git(dir, "remote", "add", "origin", remote);
  git(dir, "push", "-q", "origin", "main");
  return dir;
}

describe("build end to end (real git + npm, temp repos)", () => {
  let root = "";
  beforeAll(() => {
    // Shell metacharacters in the project path: it only ever travels as one argv element.
    root = makeRepo("a b;$(echo x)&c");
  }, 120_000);

  it("first build: worktree outside the repo, npm ci, build with --base ./", async () => {
    const r = startPlayBuild(root);
    expect(r.ok).toBe(true);
    const key = playKey(root);
    expect(startPlayBuild(root)).toEqual({ ok: false, error: "đang build rồi, chờ xong" });
    await waitPlayBuild(key, 120_000);
    const s = await playStatus(root);
    expect(s.log.join("\n")).not.toContain("không chạy được");
    expect(s).toMatchObject({ key, state: "ready", stale: false, buildable: true });
    expect(s.url).toMatch(new RegExp(`^/api/play/${key}/\\d{13}\\.[0-9a-f]{64}/index\\.html$`));
    expect(s.sha).toBe(git(root, "rev-parse", "origin/main").trim());
    const dir = playDir(key);
    expect(fs.readFileSync(path.join(dir, "dist", "index.html"), "utf8")).toContain("<!----base ./-->");
    expect(fs.existsSync(path.join(root, ".claude"))).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(parseStamp(fs.readFileSync(path.join(dir, STAMP), "utf8"))?.sha).toBe(s.sha);
  }, 120_000);

  it("stale once main moves; a rebuild runs npm ci only when package-lock.json changed", async () => {
    const key = playKey(root);
    const marker = path.join(playDir(key), "node_modules", ".marker");
    const push = (msg: string) => {
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", msg);
      git(root, "push", "-q", "origin", "main");
    };
    fs.writeFileSync(marker, "kept unless npm ci runs");
    fs.writeFileSync(path.join(root, "README.md"), "x\n");
    push("second");
    const before = await playStatus(root);
    expect(before).toMatchObject({ state: "ready", stale: true });
    startPlayBuild(root);
    await waitPlayBuild(key, 120_000);
    expect(await playStatus(root)).toMatchObject({ state: "ready", stale: false, sha: before.mainSha });
    expect(fs.existsSync(marker)).toBe(true);

    // A new version in package.json + lockfile: npm ci wipes node_modules and installs again.
    const pkgFile = path.join(root, "package.json");
    fs.writeFileSync(pkgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkgFile, "utf8")), version: "1.0.1" }));
    const npm = npmCommand();
    execFileSync(npm.cmd, [...npm.pre, "install", "--no-audit", "--no-fund", "--offline"], { cwd: root, stdio: "ignore" });
    push("third");
    startPlayBuild(root);
    await waitPlayBuild(key, 120_000);
    expect(await playStatus(root)).toMatchObject({ state: "ready", stale: false });
    expect(fs.existsSync(marker)).toBe(false);
  }, 240_000);

  it("refuses a folder that is not a worktree of this repo, and leaves it alone", async () => {
    const other = makeRepo("other");
    const dir = playDir(playKey(other));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mine.txt"), "keep");
    startPlayBuild(other);
    await waitPlayBuild(playKey(other), 60_000);
    const s = await playStatus(other);
    expect(s.state).toBe("failed");
    expect(s.error).toContain("không phải worktree");
    expect(fs.readFileSync(path.join(dir, "mine.txt"), "utf8")).toBe("keep");
  }, 120_000);

  it("not buildable without a build script", async () => {
    const plain = makeRepo("plain", { scripts: { dev: "node x.js" } });
    expect(await playStatus(plain)).toMatchObject({ buildable: false, reason: "package.json trên origin/main không có script build", state: "none" });
  }, 120_000);

  describe("routes", () => {
    const addProject = (p: string) => getDb().prepare("INSERT OR IGNORE INTO projects(path, name, added_at) VALUES (?, ?, ?)").run(p, path.basename(p), Date.now());
    const fileReq = (p: string, h: Record<string, string> = {}, method = "GET") => new Request(ORIGIN + p, { method, headers: { host: "127.0.0.1:8740", ...h } });
    const expectPlayHeaders = (r: Response, what: string) => {
      for (const [k, v] of Object.entries(PLAY_HEADERS)) expect(r.headers.get(k), `${what}: ${k}`).toBe(v);
      expect(r.headers.get("set-cookie"), `${what}: no cookie`).toBeNull();
    };

    it("status and build need the token, a loopback Host and (POST) the UI Origin", async () => {
      addProject(root);
      const q = `/api/play?root=${encodeURIComponent(root)}`;
      expect((await playRoute.GET(req(q))).status).toBe(401);
      expect((await playRoute.GET(req(q, { token, host: "evil.test" }))).status).toBe(403);
      expect((await playRoute.POST(req("/api/play", { method: "POST", token, origin: "http://evil.test", body: { root } }))).status).toBe(403);
      expect((await playRoute.POST(req("/api/play", { method: "POST", token, body: { root } }))).status).toBe(403);
      expect((await playRoute.GET(req(`/api/play?root=${encodeURIComponent(path.join(base, "unknown"))}`, { token }))).status).toBe(409);
      expect((await playRoute.POST(req("/api/play", { method: "POST", token, origin: ORIGIN, body: { root: 7 } }))).status).toBe(422);
    });

    it("serves dist under the signed path only, sandboxed, no cookie, no token", async () => {
      const res = await playRoute.GET(req(`/api/play?root=${encodeURIComponent(root)}`, { token }));
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
      const { status } = await res.json();
      const key = status.key as string;
      const url = status.url as string;
      const at = url.replace(/index\.html$/, "");
      const sig = at.split("/")[4];

      // No token, no Host rule, no Origin check: a sandboxed page sends `Origin: null`; another host (the VPS
      // without the GitHub gate on /api/play) works too. The signature is the lock.
      for (const h of [{}, { origin: "null" }, { host: "vps.example" }, { "cf-ray": "x" }] as Record<string, string>[]) {
        const page = await fileRoute.GET(fileReq(url, h));
        expect(page.status, JSON.stringify(h)).toBe(200);
        expectPlayHeaders(page, "index.html");
        expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(page.headers.get("cache-control")).toBe("no-store");
        expect(await page.text()).toContain("./assets/a.js");
      }
      const js = await fileRoute.GET(fileReq(`${at}assets/a.js`, { origin: "null" }));
      expect(js.status).toBe(200);
      expectPlayHeaders(js, "a.js");
      expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      const etag = js.headers.get("etag")!;
      const notModified = await fileRoute.GET(fileReq(`${at}assets/a.js`, { "if-none-match": etag }));
      expect(notModified.status).toBe(304);
      expectPlayHeaders(notModified, "304");
      const head = await fileRoute.HEAD(fileReq(url, {}, "HEAD"));
      expect(head.status).toBe(200);
      expect(head.body).toBeNull();
      expectPlayHeaders(head, "HEAD");

      const bare = await fileRoute.GET(fileReq(`/api/play/${key}/${sig}`));
      expect(bare.status).toBe(307);
      expect(bare.headers.get("location")).toBe(`${sig}/index.html`);

      // Forged, expired, more than 12 h ahead, project A's signature on project B, old formats: refused,
      // and still sandboxed.
      const other = playKey(path.join(base, "other"));
      const now = Date.now();
      for (const p of [
        `/api/play/${key}/1.${"0".repeat(64)}/index.html`,
        `/api/play/${key}/${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}/index.html`,
        `/api/play/${key}/${playSig(key, now - 1)}/index.html`,
        `/api/play/${key}/${playSig(key, now + 12 * 3600_000 + 60_000)}/index.html`,
        `/api/play/${other}/${sig}/index.html`,
        `/api/play/${key}/index.html`,
        `/api/play/${key}/index.html?k=${sig}`,
        `/api/play/${key}/assets/a.js`,
      ]) {
        const r = await fileRoute.GET(fileReq(p));
        expect(r.status, p).toBe(401);
        expectPlayHeaders(r, p);
      }
      // An old `hq_play` cookie or `?k=` alone opens nothing.
      const oldCookie = await fileRoute.GET(fileReq(`/api/play/${key}/index.html`, { cookie: `hq_play=${sig}` }));
      expect(oldCookie.status).toBe(401);

      for (const p of [`${at}..%2F..%2Fpackage.json`, `${at}..%5Cpackage.json`, `${at}assets`, `${at}nope.js`, `/api/play/..%2F/${sig}/index.html`, `/api/play/${key}/${sig}/${encodeURIComponent("..")}/build.js`]) {
        const r = await fileRoute.GET(fileReq(p));
        expect([401, 404], p).toContain(r.status);
        expectPlayHeaders(r, p);
      }
      // The worktree's own files next to dist/ are never served.
      expect((await fileRoute.GET(fileReq(`${at}${encodeURIComponent("..")}/build.js`))).status).not.toBe(200);
    });
  });
});
