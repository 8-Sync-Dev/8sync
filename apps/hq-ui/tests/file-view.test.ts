import { beforeAll, describe, expect, it, vi } from "vitest";

/** The rooms HQ lists: a live one in `repo`, an ended one in `done` (both set in beforeAll). */
const rooms = vi.hoisted(() => ({ live: "", ended: "", home: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [
    { name: "live", cwd: rooms.live, status: "running" },
    { name: "done", cwd: rooms.ended, status: "ended" },
    { name: "at-home", cwd: rooms.home, status: "ended" },
  ],
}));
vi.mock("@/lib/server/floor", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/floor")>()),
  loadFloor: async () => [],
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST as locate } from "@/app/api/files/locate/route";
import { GET as raw } from "@/app/api/files/raw/route";
import { filesRawUrl, type FileSpot, type FileSpots } from "@/lib/files";
import { allowedUnder } from "@/lib/server/artifacts";
import { getToken } from "@/lib/server/auth";
import { endedRoots } from "@/lib/server/in-view";
import { configDir, stateDir } from "@/lib/server/paths";
import { byteRange, sendFile } from "@/lib/server/send-file";
import { ORIGIN, req } from "./helpers";

let repo = "";
let done = "";
let outside = "";
const put = (dir: string, rel: string, data: string | Buffer) => {
  const f = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  return f;
};
const gitRepo = (prefix: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return dir;
};
const find = async (paths: string[], base: string | null = repo): Promise<FileSpot[]> => {
  const res = await locate(req("/api/files/locate", { method: "POST", token: getToken(), origin: ORIGIN, body: { base, paths } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as FileSpots).files;
};
const one = async (p: string, base: string | null = repo) => (await find([p], base))[0];
/** 300 bytes standing in for a video: byte i is i % 256, so a slice shows where it came from. */
const VIDEO = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256));

beforeAll(() => {
  repo = gitRepo("hq-view-");
  done = gitRepo("hq-view-done-");
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-view-out-")));
  rooms.live = path.join(repo, "apps", "web");
  rooms.ended = done;
  rooms.home = os.homedir();
  fs.mkdirSync(rooms.live, { recursive: true });
  put(repo, "out/highlight lien quan.mp4", VIDEO);
  put(repo, "apps/web/shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  put(repo, "docs/plan.md", "# Kế hoạch\n");
  put(done, "render/final.mp4", VIDEO);
  put(outside, "stolen.mp4", VIDEO);
  put(os.homedir(), "home-note.md", "# nhà\n");
  for (const s of [".env", ".env.local", "server.pem", "tls.key", "cert.p12", "id_rsa", "bot.session", "model.pkl", ".ssh/config", ".git/config"]) put(repo, s, "secret\n");
});

describe("files/locate: finding what a reply names", () => {
  it("finds an absolute path, a path relative to the room's folder, then to its repo root, and a bare name", async () => {
    const abs = path.join(repo, "out", "highlight lien quan.mp4");
    const [a, rel, up, bare] = await find([abs, "shot.png", "out/highlight lien quan.mp4", "./docs/plan.md"], rooms.live);
    expect(a).toEqual({ path: abs, ok: true, root: path.join(repo, "out"), rel: "highlight lien quan.mp4", kind: "video", size: 300 });
    expect(rel).toMatchObject({ ok: true, root: rooms.live, rel: "shot.png", kind: "image" });
    // Not under apps/web: found under the repo root the room sits in.
    expect(up).toMatchObject({ ok: true, root: path.join(repo, "out"), kind: "video" });
    expect(bare).toMatchObject({ ok: true, root: path.join(repo, "docs"), rel: "plan.md", kind: "markdown" });
  });

  it("finds a file of a room that ended, but never under a room run in the home folder", async () => {
    expect(await one(path.join(done, "render", "final.mp4"))).toMatchObject({ ok: true, kind: "video" });
    expect(await one(path.join(os.homedir(), "home-note.md"))).toMatchObject({ ok: false, status: 403, error: "file không nằm trong dự án nào HQ đang biết" });
    expect(endedRoots([{ name: "a", cwd: "C:\\", status: "ended" }, { name: "b", cwd: "/", status: "ended" }, { name: "c", cwd: path.dirname(os.homedir()), status: "ended" }], () => null)).toEqual([]);
  });

  it("refuses a path out of every known project, by `..`, or through a junction", async () => {
    expect(await one(path.join(outside, "stolen.mp4"))).toMatchObject({ ok: false, status: 403 });
    const climb = path.relative(rooms.live, path.join(outside, "stolen.mp4"));
    expect(climb.startsWith("..")).toBe(true);
    expect(await one(climb, rooms.live)).toMatchObject({ ok: false, status: 403 });
    expect(await one("../../nope/missing.mp4", rooms.live)).toMatchObject({ ok: false, status: 404, error: "không thấy file trên máy" });
    let linked = false;
    try {
      fs.symlinkSync(outside, path.join(repo, "linked"), "junction");
      linked = true;
    } catch {
      // the platform refused the link: nothing to test through it
    }
    if (linked) expect(await one("linked/stolen.mp4")).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses secrets inside a known project and HQ's own config and state", async () => {
    const spots = await find([".env", ".env.local", "server.pem", "tls.key", "cert.p12", "id_rsa", "bot.session", "model.pkl", ".ssh/config", ".git/config"]);
    for (const s of spots) expect(s, s.path).toMatchObject({ ok: false, status: 403 });
    expect(allowedUnder(path.join(configDir(), "ui-token"), os.homedir())).toBe(false);
    expect(allowedUnder(path.join(configDir(), "public.json"), os.homedir())).toBe(false);
    expect(allowedUnder(path.join(stateDir(), "hq.db"), os.homedir())).toBe(false);
    expect(allowedUnder(path.join(repo, "out", "clip.mp4"), repo)).toBe(true);
  });

  it("says why a path is not usable: a folder, a UNC share, a relative path without the room's folder", async () => {
    expect(await one(path.join(repo, "docs"))).toMatchObject({ ok: false, status: 422 });
    expect(await one("\\\\evil-host\\share\\a.mp4")).toMatchObject({ ok: false, status: 422 });
    expect(await one("//evil-host/share/a.mp4")).toMatchObject({ ok: false, status: 422 });
    expect(await one("out/highlight lien quan.mp4", null)).toMatchObject({ ok: false, status: 422 });
    const unc = await locate(req("/api/files/locate", { method: "POST", token: getToken(), origin: ORIGIN, body: { base: "\\\\evil-host\\share", paths: ["a.mp4"] } }));
    expect(unc.status).toBe(422);
    const many = await locate(req("/api/files/locate", { method: "POST", token: getToken(), origin: ORIGIN, body: { base: repo, paths: Array.from({ length: 41 }, (_, i) => `${i}.md`) } }));
    expect(many.status).toBe(422);
  });

  it("answers nobody without the owner's login", async () => {
    const res = await locate(req("/api/files/locate", { method: "POST", origin: ORIGIN, body: { base: repo, paths: ["docs/plan.md"] }, host: "127.0.0.1:8740" }));
    expect(res.status).toBe(401);
  });
});

describe("byte ranges for seeking", () => {
  it("reads one range of a file, a suffix, an open end, and clips the end to the file", () => {
    expect(byteRange("bytes=0-99", 300)).toEqual({ start: 0, end: 99 });
    expect(byteRange("bytes=-500", 300)).toEqual({ start: 0, end: 299 });
    expect(byteRange("bytes=-100", 300)).toEqual({ start: 200, end: 299 });
    expect(byteRange("bytes=250-", 300)).toEqual({ start: 250, end: 299 });
    expect(byteRange("bytes=250-9999", 300)).toEqual({ start: 250, end: 299 });
  });

  it("416 for a range past the end or an empty suffix; the whole file for a reversed, multi or foreign range", () => {
    expect(byteRange("bytes=300-", 300)).toBe("unsatisfiable");
    expect(byteRange("bytes=300-400", 300)).toBe("unsatisfiable");
    expect(byteRange("bytes=-0", 300)).toBe("unsatisfiable");
    expect(byteRange("bytes=0-", 0)).toBe("unsatisfiable");
    expect(byteRange("bytes=5-3", 300)).toBeNull();
    expect(byteRange("bytes=0-1,5-6", 300)).toBeNull();
    expect(byteRange("items=0-1", 300)).toBeNull();
    expect(byteRange("bytes=-", 300)).toBeNull();
  });

  it("the viewer's video URL answers 206 with the slice, 416 past the end, inline with nosniff", async () => {
    const root = path.join(repo, "out");
    const url = filesRawUrl(root, "highlight lien quan.mp4");
    const seek = req(url, { token: getToken() });
    seek.headers.set("range", "bytes=100-199");
    const part = await raw(seek);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-type")).toBe("video/mp4");
    expect(part.headers.get("accept-ranges")).toBe("bytes");
    expect(part.headers.get("content-range")).toBe("bytes 100-199/300");
    expect(part.headers.get("content-length")).toBe("100");
    expect(part.headers.get("x-content-type-options")).toBe("nosniff");
    expect(part.headers.get("content-disposition")).toBe(`inline; filename*=UTF-8''${encodeURIComponent("highlight lien quan.mp4")}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(VIDEO.subarray(100, 200));
    const past = req(url, { token: getToken() });
    past.headers.set("range", "bytes=300-");
    const r416 = await raw(past);
    expect(r416.status).toBe(416);
    expect(r416.headers.get("content-range")).toBe("bytes */300");
    const env = req(filesRawUrl(repo, ".env"), { token: getToken() });
    expect((await raw(env)).status).toBe(403);
  });

  it("sendFile never runs past the stat'ed size when the file grows after the lookup", async () => {
    const f = put(outside, "growing.mp4", VIDEO);
    const r = new Request(ORIGIN + "/x", { headers: { range: "bytes=-50" } });
    const res = await sendFile(r, { path: f, name: "growing.mp4", type: "video/mp4", size: 100 }, { download: false, cache: "no-store" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 50-99/100");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(VIDEO.subarray(50, 100));
  });
});
