import { EventEmitter } from "node:events";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** The live room's repo: a real temp git repo (set in beforeAll). */
const room = vi.hoisted(() => ({ cwd: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [{ name: "s1", cwd: room.cwd, status: "running" }],
}));
vi.mock("@/lib/server/floor", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/floor")>()),
  loadFloor: async () => [],
}));
// Nothing opens on the test machine: the reveal's file manager is a fake child that "starts".
const spawned = vi.hoisted(() => ({ calls: [] as { cmd: string; args: string[]; opts: Record<string, unknown> }[] }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    spawned.calls.push({ cmd, args, opts });
    const child = Object.assign(new EventEmitter(), { unref: () => {} });
    setImmediate(() => child.emit("spawn"));
    return child;
  },
}));
// The PDF route's LibreOffice: absent, whatever this machine has.
vi.mock("@/lib/server/office-pdf", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/office-pdf")>()),
  findSoffice: () => null,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as list, POST as register } from "@/app/api/artifacts/route";
import { GET as file } from "@/app/api/artifacts/[id]/file/route";
import { GET as pdf } from "@/app/api/artifacts/[id]/pdf/route";
import { POST as revealRoute } from "@/app/api/reveal/route";
import { fileType, type ArtifactView } from "@/lib/artifacts";
import { artifactSig } from "@/lib/server/artifacts";
import { getToken } from "@/lib/server/auth";
import { revealCommand } from "@/lib/server/reveal";
import { ORIGIN, req } from "./helpers";

type Ctx = { params: Promise<{ id: string }> };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as Ctx;

let repo = "";
let outside = "";
const put = (dir: string, rel: string, data: string | Buffer) => {
  const f = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  return f;
};
const add = async (f: string): Promise<ArtifactView> => {
  const r = await register(req("/api/artifacts", { method: "POST", token: getToken(), origin: ORIGIN, body: { path: f } }));
  expect(r.status).toBe(201);
  const id = ((await r.json()) as { artifact: { id: string } }).artifact.id;
  const rows = (await (await list(req("/api/artifacts", { token: getToken() }))).json()) as { artifacts: ArtifactView[] };
  return rows.artifacts.find((a) => a.id === id)!;
};
const reveal = (body: unknown, opts: { tunnel?: boolean; origin?: string | null } = {}) => {
  const r = req("/api/reveal", { method: "POST", token: getToken(), origin: opts.origin === undefined ? ORIGIN : opts.origin, body });
  if (opts.tunnel) r.headers.set("cf-ray", "abc");
  return revealRoute(r);
};

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-rux-")));
  fs.mkdirSync(path.join(repo, ".git"));
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  room.cwd = repo;
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-rux-out-")));
});
beforeEach(() => {
  spawned.calls.length = 0;
});

describe("file kinds", () => {
  it("knows video, audio, images, Office, CSV and code by extension, any case; unknown and executables are null", () => {
    const k = (p: string) => fileType(p);
    expect(k("a/clip.MP4")).toEqual({ kind: "video", type: "video/mp4" });
    expect(k("clip.webm")?.kind).toBe("video");
    expect(k("clip.mov")).toEqual({ kind: "video", type: "video/quicktime" });
    expect(k("clip.mkv")?.type).toBe("video/x-matroska");
    for (const e of ["mp3", "wav", "ogg", "m4a", "flac", "aac"]) expect(k(`song.${e}`)?.kind).toBe("audio");
    expect(k("logo.svg")).toEqual({ kind: "image", type: "image/svg+xml" });
    for (const e of ["gif", "webp", "avif"]) expect(k(`x.${e}`)?.kind).toBe("image");
    for (const e of ["docx", "xlsx", "pptx", "doc", "xls", "ppt", "odt", "ods", "odp"]) expect(k(`x.${e.toUpperCase()}`)?.kind).toBe("office");
    expect(k("report.docx")?.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(k("data.csv")?.kind).toBe("text");
    expect(k("main.ts")).toEqual({ kind: "text", type: "text/plain; charset=utf-8" });
    expect(k("doc.pdf")?.kind).toBe("pdf");
    expect(k("app.exe")).toBeNull();
    expect(k("noext")).toBeNull();
  });
});

describe("artifact file route", () => {
  it("answers a byte range with 206, the slice and the file's type; past the end 416", async () => {
    const bytes = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
    const a = await add(put(repo, "out/clip.mp4", bytes));
    const ranged = (range: string) => {
      const r = req(`/api/artifacts/${a.id}/file`, { token: getToken() });
      r.headers.set("range", range);
      return file(r, ctx(a.id));
    };
    const r = await ranged("bytes=10-19");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(bytes.subarray(10, 20));
    const tail = await ranged("bytes=-5");
    expect(Buffer.from(await tail.arrayBuffer())).toEqual(bytes.subarray(95));
    const past = await ranged("bytes=200-");
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */100");
  });

  it("serves the list's signed src to the owner without the token header, and nothing else", async () => {
    const a = await add(put(repo, "out/song.mp3", "ID3-bytes"));
    expect(a.src).toMatch(new RegExp(`^/api/artifacts/${a.id}/file\\?e=\\d+&sig=[0-9a-f]{64}$`));
    const get = (url: string, tunnel = false) => {
      const r = req(url);
      if (tunnel) r.headers.set("cf-ray", "abc");
      return file(r, ctx(a.id));
    };
    const ok = await get(a.src);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("audio/mpeg");
    expect(await ok.text()).toBe("ID3-bytes");
    const download = await get(`${a.src}&download=1`);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="song\.mp3"/);
    await download.body?.cancel();

    const exp = Number(new URL(`http://x${a.src}`).searchParams.get("e"));
    // A tampered signature, another file's signature, an expired one, one too far ahead: refused.
    expect((await get(a.src.replace(/sig=(.)/, (_, c) => `sig=${c === "0" ? "1" : "0"}`))).status).toBe(401);
    expect((await get(`/api/artifacts/${a.id}/file?e=${exp}&sig=${artifactSig("f".repeat(32), exp)}`)).status).toBe(401);
    const past = Date.now() - 1000;
    expect((await get(`/api/artifacts/${a.id}/file?e=${past}&sig=${artifactSig(a.id, past)}`)).status).toBe(401);
    const far = Date.now() + 48 * 3600_000;
    expect((await get(`/api/artifacts/${a.id}/file?e=${far}&sig=${artifactSig(a.id, far)}`)).status).toBe(401);
    // A valid link through the public tunnel without the owner's login cookie: refused.
    expect((await get(a.src, true)).status).toBe(401);
    // No signature and no token: the plain route still wants the token.
    expect((await get(`/api/artifacts/${a.id}/file`)).status).toBe(401);
  });

  it("takes an SVG but serves it sandboxed with no script or outside loads", async () => {
    const a = await add(put(repo, "out/logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));
    const r = await file(req(`/api/artifacts/${a.id}/file`, { token: getToken() }), ctx(a.id));
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(r.headers.get("content-security-policy")).toMatch(/^sandbox; default-src 'none'/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    await r.body?.cancel();
  });
});

describe("office PDF route", () => {
  it("says 501 without LibreOffice for an Office file and 422 for anything else", async () => {
    const doc = await add(put(repo, "out/report.docx", "PK-not-really"));
    expect((await pdf(req(`/api/artifacts/${doc.id}/pdf`, { token: getToken() }), ctx(doc.id))).status).toBe(501);
    const md = await add(put(repo, "out/notes.md", "# x"));
    expect((await pdf(req(`/api/artifacts/${md.id}/pdf`, { token: getToken() }), ctx(md.id))).status).toBe(422);
    expect((await pdf(req(`/api/artifacts/${doc.id}/pdf`), ctx(doc.id))).status).toBe(401);
  });
});

describe("reveal route", () => {
  it("shows an artifact or a project file in the file manager, argv only and no shell", async () => {
    const a = await add(put(repo, "out/show me.md", "x"));
    const r = await reveal({ id: a.id });
    expect(r.status).toBe(200);
    const want = revealCommand(process.platform, path.join(repo, "out", "show me.md"), false);
    expect(spawned.calls).toHaveLength(1);
    expect(spawned.calls[0]).toMatchObject({ cmd: want.cmd, args: want.args, opts: { shell: false, detached: true, stdio: "ignore" } });

    // A path a result names, relative to the room's folder.
    put(repo, "src/app.ts", "x");
    expect((await reveal({ path: "src/app.ts", base: repo })).status).toBe(200);
    expect(spawned.calls[1].args).toEqual(revealCommand(process.platform, path.join(repo, "src", "app.ts"), false).args);
    // A folder opens itself.
    expect((await reveal({ path: path.join(repo, "src") })).status).toBe(200);
    expect(spawned.calls[2].args).toEqual(revealCommand(process.platform, path.join(repo, "src"), true).args);
  });

  it("refuses the public link, a cross-site post, outside files, escapes, .git and secrets, missing files and bad input", async () => {
    const ok = put(repo, "out/fine.md", "x");
    expect((await reveal({ path: ok }, { tunnel: true })).status).toBe(403);
    expect((await reveal({ path: ok }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await reveal({ path: put(outside, "x.md", "x") })).status).toBe(403);
    expect((await reveal({ path: "../" + path.basename(outside) + "/x.md", base: repo })).status).toBe(403);
    expect((await reveal({ path: put(repo, ".git/config.md", "x") })).status).toBe(403);
    expect((await reveal({ path: put(repo, "node_modules/x/readme.md", "x") })).status).toBe(403);
    expect((await reveal({ path: put(repo, "out/.env.local", "K=1") })).status).toBe(403);
    expect((await reveal({ path: path.join(repo, "nope.md") })).status).toBe(404);
    expect((await reveal({ id: "f".repeat(32) })).status).toBe(404);
    expect((await reveal({ id: "../x" })).status).toBe(422);
    expect((await reveal({ path: 42 })).status).toBe(422);
    expect((await reveal({ path: "" })).status).toBe(422);
    expect((await reveal({ path: `${ok}\0.md` })).status).toBe(422);
    expect((await reveal({ path: "out/fine.md" })).status).toBe(422);
    expect((await reveal({ path: "out/fine.md", base: "relative" })).status).toBe(422);
    expect((await reveal({ path: "x".repeat(5000) })).status).toBe(422);
    expect(spawned.calls).toHaveLength(0);
  });

  it("refuses a link inside a project that points out of it", async () => {
    const target = put(outside, "secret.md", "nope");
    const link = path.join(repo, "out", "escape.md");
    try {
      fs.symlinkSync(target, link, "file");
    } catch {
      return; // no symlink right on this Windows account
    }
    expect((await reveal({ path: link })).status).toBe(403);
    expect(spawned.calls).toHaveLength(0);
  });

  it("builds each platform's command with the path as one argument, and never opens what it reveals", () => {
    const w = revealCommand("win32", "C:\\p\\a b.md", false, { SystemRoot: "C:\\Windows" });
    expect(w).toEqual({ cmd: "C:\\Windows\\explorer.exe", args: ['/select,"C:\\p\\a b.md"'], verbatim: true });
    // A folder is selected in its parent too: `explorer <path>` / `open X.app` would run what sits there.
    expect(revealCommand("win32", "C:\\p\\tool.exe", true, { SystemRoot: "C:\\Windows" }).args).toEqual(['/select,"C:\\p\\tool.exe"']);
    expect(revealCommand("darwin", "/p/a b.md", false)).toEqual({ cmd: "/usr/bin/open", args: ["-R", "/p/a b.md"], verbatim: false });
    expect(revealCommand("darwin", "/p/X.app", true).args).toEqual(["-R", "/p/X.app"]);
    expect(revealCommand("linux", "/p/a b.md", false)).toEqual({ cmd: "xdg-open", args: ["/p"], verbatim: false });
    expect(revealCommand("linux", "/p/dir", true).args).toEqual(["/p/dir"]);
  });
});
