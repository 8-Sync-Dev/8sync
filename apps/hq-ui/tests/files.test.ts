import { beforeAll, describe, expect, it, vi } from "vitest";

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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as list } from "@/app/api/files/route";
import { GET as read, PUT as save } from "@/app/api/files/file/route";
import { GET as raw } from "@/app/api/files/raw/route";
import nextConfig from "@/next.config";
import { ARTIFACT_CSP } from "@/lib/artifact-headers";
import { deniedText } from "@/lib/access";
import { FILES_CONFLICT, FILES_EDIT_MAX, FILES_TEXT_MAX, filesFileUrl, filesListUrl, filesRawUrl, relLink, splitLinks, type DirListing, type FileView } from "@/lib/files";
import { getToken, sessionSecret } from "@/lib/server/auth";
import { filesSrc, sha256 } from "@/lib/server/files";
import { createInvite, GUEST_COOKIE, guestCookie } from "@/lib/server/invites";
import { ORIGIN, req } from "./helpers";

let repo = "";
let outside = "";
const put = (dir: string, rel: string, data: string | Buffer) => {
  const f = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  return f;
};
const getList = (rel: string, root = repo) => list(req(filesListUrl(root, rel), { token: getToken() }));
const getFile = (rel: string, root = repo) => read(req(filesFileUrl(root, rel), { token: getToken() }));
const putFile = (body: unknown) => save(req("/api/files/file", { method: "PUT", token: getToken(), origin: ORIGIN, body }));
const err = async (r: Response) => ((await r.json()) as { error: string }).error;
/** A folder junction (no admin right needed on Windows); null when the platform refuses. */
const junction = (target: string, at: string) => {
  try {
    fs.symlinkSync(target, at, "junction");
    return at;
  } catch {
    return null;
  }
};

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-files-")));
  fs.mkdirSync(path.join(repo, ".git"));
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  room.cwd = repo;
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-files-out-")));
  put(outside, "stolen.txt", "bí mật ngoài dự án");
  put(repo, "README.md", "# Dự án\n\nXem https://8syncdev.com và [docs](docs/a.md).\n");
  put(repo, "docs/a.md", "## A\n");
  put(repo, "src/10-b.ts", "export const b = 1;\n");
  put(repo, "src/2-a.ts", "export const a = 1;\n");
  put(repo, ".github/workflows/ci.yml", "on: push\n");
  put(repo, "node_modules/x/index.js", "module.exports = 1;\n");
  put(repo, "target/debug/app", Buffer.from([0, 1, 2]));
  put(repo, ".env", "TOKEN=abc\n");
  put(repo, "secrets.json", "{}\n");
  put(repo, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  put(repo, "blob.bin", Buffer.from([1, 0, 2, 0, 3]));
  put(repo, "crlf.txt", "một\r\nhai\r\n");
});

describe("files: listing", () => {
  it("lists folders first then files, hides .git/node_modules/target and secret names, keeps dot-folders", async () => {
    const r = await getList("");
    expect(r.status).toBe(200);
    const l = (await r.json()) as DirListing;
    expect(l.path).toBe("");
    const names = l.entries.map((e) => e.name);
    expect(names).toEqual([".github", "docs", "src", "blob.bin", "crlf.txt", "logo.png", "README.md"]);
    expect(l.entries[0]).toMatchObject({ dir: true, size: null });
    expect(l.entries.find((e) => e.name === "README.md")).toMatchObject({ dir: false, size: expect.any(Number) });
    // Numbers in order inside a folder.
    const src = (await (await getList("src")).json()) as DirListing;
    expect(src.entries.map((e) => e.name)).toEqual(["2-a.ts", "10-b.ts"]);
  });

  it("refuses folders outside the root, blocked folders and roots HQ does not know", async () => {
    expect((await getList("../")).status).toBe(403);
    expect((await getList(".git")).status).toBe(403);
    expect((await getList("node_modules")).status).toBe(403);
    expect((await getList(outside)).status).toBe(422);
    expect((await getList("", outside)).status).toBe(403);
    expect((await getList("", "relative/path")).status).toBe(422);
    expect((await getList("", path.join(repo, ".git"))).status).toBe(403);
    // A folder inside a known project is a root too (a room whose cwd is a sub-folder).
    expect((await getList("", path.join(repo, "src"))).status).toBe(200);
  });

  it("drops a link that leaves the root and refuses to go through it", async () => {
    const at = junction(outside, path.join(repo, "escape"));
    if (!at) return;
    try {
      const l = (await (await getList("")).json()) as DirListing;
      expect(l.entries.map((e) => e.name)).not.toContain("escape");
      expect((await getList("escape")).status).toBe(403);
      expect((await getFile("escape/stolen.txt")).status).toBe(403);
    } finally {
      fs.rmSync(at, { recursive: false, force: true });
    }
  });

  it("keeps a link that stays inside the root", async () => {
    const at = junction(path.join(repo, "docs"), path.join(repo, "docs-link"));
    if (!at) return;
    try {
      const l = (await (await getList("")).json()) as DirListing;
      expect(l.entries.find((e) => e.name === "docs-link")).toMatchObject({ dir: true });
      expect((await getFile("docs-link/a.md")).status).toBe(200);
    } finally {
      fs.rmSync(at, { recursive: false, force: true });
    }
  });
});

describe("files: reading", () => {
  it("hands a text file with its text, hash and a signed src", async () => {
    const r = await getFile("README.md");
    expect(r.status).toBe(200);
    const v = (await r.json()) as FileView;
    const bytes = fs.readFileSync(path.join(repo, "README.md"));
    expect(v).toMatchObject({ path: "README.md", name: "README.md", kind: "markdown", size: bytes.length, editable: true, big: false, hash: sha256(bytes) });
    expect(v.text).toBe(bytes.toString("utf8"));
    expect(v.src).toMatch(/^\/api\/files\/raw\?root=.+&path=README\.md&e=\d+&sig=[0-9a-f]{64}$/);
    // Backslashes work too, and the answer is always `/`.
    expect(((await (await getFile("docs\\a.md")).json()) as FileView).path).toBe("docs/a.md");
  });

  it("gives media and unknown binaries no text", async () => {
    expect(await (await getFile("logo.png")).json()).toMatchObject({ kind: "image", editable: false });
    const b = (await (await getFile("blob.bin")).json()) as FileView;
    expect(b).toMatchObject({ kind: "binary", editable: false });
    expect(b.text).toBeUndefined();
  });

  it("refuses .git, node_modules, secret names and paths out of the root", async () => {
    for (const rel of [".git/HEAD", "node_modules/x/index.js", ".env", "secrets.json", "../" + path.basename(outside) + "/stolen.txt", path.join(outside, "stolen.txt")]) {
      const r = await getFile(rel);
      expect([403, 422], rel).toContain(r.status);
    }
    expect((await getFile("nope.md")).status).toBe(404);
    expect((await getFile("docs")).status).toBe(422);
  });

  it("refuses a file link that points at a secret or out of the root", async () => {
    try {
      fs.symlinkSync(path.join(outside, "stolen.txt"), path.join(repo, "out.txt"), "file");
      fs.symlinkSync(path.join(repo, ".env"), path.join(repo, "env.txt"), "file");
    } catch {
      return; // no symlink right on this Windows account
    }
    try {
      expect((await getFile("out.txt")).status).toBe(403);
      expect((await getFile("env.txt")).status).toBe(403);
    } finally {
      fs.rmSync(path.join(repo, "out.txt"), { force: true });
      fs.rmSync(path.join(repo, "env.txt"), { force: true });
    }
  });

  it("shows text up to 2 MB, edits up to 1 MB", async () => {
    put(repo, "big/mid.txt", "a".repeat(FILES_EDIT_MAX + 10));
    put(repo, "big/huge.txt", "a".repeat(FILES_TEXT_MAX + 10));
    const mid = (await (await getFile("big/mid.txt")).json()) as FileView;
    expect(mid).toMatchObject({ kind: "text", editable: false, big: false });
    expect(mid.text?.length).toBe(FILES_EDIT_MAX + 10);
    const huge = (await (await getFile("big/huge.txt")).json()) as FileView;
    expect(huge).toMatchObject({ kind: "text", big: true, editable: false });
    expect(huge.text).toBeUndefined();
    const r = await putFile({ root: repo, path: "big/mid.txt", text: "x", hash: mid.hash });
    expect(r.status).toBe(413);
    expect(fs.readFileSync(path.join(repo, "big/mid.txt"), "utf8").length).toBe(FILES_EDIT_MAX + 10);
  });
});

describe("files: saving", () => {
  it("writes when the file is unchanged since it was loaded, 409 when it changed", async () => {
    const f = put(repo, "notes/todo.md", "- một\n");
    const v = (await (await getFile("notes/todo.md")).json()) as FileView;
    const ok = await putFile({ root: repo, path: "notes/todo.md", text: "- một\n- hai\n", hash: v.hash });
    expect(ok.status).toBe(200);
    const s = (await ok.json()) as { ok: true; hash: string; size: number };
    expect(fs.readFileSync(f, "utf8")).toBe("- một\n- hai\n");
    expect(s.hash).toBe(sha256(fs.readFileSync(f)));
    // No temp file left beside it.
    expect(fs.readdirSync(path.dirname(f))).toEqual(["todo.md"]);

    // The old hash is stale now: refused, file untouched.
    const stale = await putFile({ root: repo, path: "notes/todo.md", text: "ghi đè", hash: v.hash });
    expect(stale.status).toBe(409);
    expect(await err(stale)).toBe(FILES_CONFLICT);
    expect(fs.readFileSync(f, "utf8")).toBe("- một\n- hai\n");

    // Changed on disk by someone else: refused too.
    fs.writeFileSync(f, "phòng vừa sửa\n");
    expect((await putFile({ root: repo, path: "notes/todo.md", text: "của anh", hash: s.hash })).status).toBe(409);
    expect(fs.readFileSync(f, "utf8")).toBe("phòng vừa sửa\n");
  });

  it("keeps CRLF line endings when the editor sends LF", async () => {
    const v = (await (await getFile("crlf.txt")).json()) as FileView;
    expect((await putFile({ root: repo, path: "crlf.txt", text: "một\nhai\nba\n", hash: v.hash })).status).toBe(200);
    expect(fs.readFileSync(path.join(repo, "crlf.txt"), "utf8")).toBe("một\r\nhai\r\nba\r\n");
  });

  it("never creates a file, never writes a binary, a blocked or an outside file, never over 1 MB", async () => {
    const h = "0".repeat(64);
    expect((await putFile({ root: repo, path: "new.md", text: "x", hash: h })).status).toBe(404);
    expect(fs.existsSync(path.join(repo, "new.md"))).toBe(false);
    expect((await putFile({ root: repo, path: "logo.png", text: "x", hash: h })).status).toBe(422);
    expect((await putFile({ root: repo, path: "blob.bin", text: "x", hash: h })).status).toBe(422);
    expect((await putFile({ root: repo, path: ".env", text: "x", hash: h })).status).toBe(403);
    expect((await putFile({ root: repo, path: ".git/HEAD", text: "x", hash: h })).status).toBe(403);
    expect((await putFile({ root: outside, path: "stolen.txt", text: "x", hash: sha256(fs.readFileSync(path.join(outside, "stolen.txt"))) })).status).toBe(403);
    expect((await putFile({ root: repo, path: "../" + path.basename(outside) + "/stolen.txt", text: "x", hash: h })).status).toBe(403);
    expect(fs.readFileSync(path.join(outside, "stolen.txt"), "utf8")).toBe("bí mật ngoài dự án");
    expect((await putFile({ root: repo, path: "docs/a.md", text: "x", hash: "nope" })).status).toBe(422);

    const v = (await (await getFile("docs/a.md")).json()) as FileView;
    expect((await putFile({ root: repo, path: "docs/a.md", text: "a".repeat(FILES_EDIT_MAX + 1), hash: v.hash })).status).toBe(413);
    expect(fs.readFileSync(path.join(repo, "docs/a.md"), "utf8")).toBe("## A\n");
  });

  it("answers a guest 403 on every files route", async () => {
    const { invite } = createInvite({ label: "khách", role: "editor", days: 7 });
    const cookie = guestCookie({ id: invite.id, role: "editor", issued: Date.now() }, sessionSecret());
    const guest = (url: string, method = "GET", body?: unknown) => {
      const headers = new Headers({ host: "127.0.0.1:8740", cookie: `${GUEST_COOKIE}=${cookie}` });
      if (method !== "GET") headers.set("origin", ORIGIN);
      return new Request(ORIGIN + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    };
    for (const res of [
      await list(guest(filesListUrl(repo, ""))),
      await read(guest(filesFileUrl(repo, "README.md"))),
      await save(guest("/api/files/file", "PUT", { root: repo, path: "README.md", text: "x", hash: "0".repeat(64) })),
      await raw(guest(filesRawUrl(repo, "logo.png"))),
    ]) {
      expect(res.status).toBe(403);
      expect(await err(res)).toBe(deniedText("editor"));
    }
    // The signed URL alone is not enough for a guest either.
    const signed = await raw(guest(filesSrc(repo, "logo.png")));
    expect(signed.status).toBe(403);
  });
});

describe("files: raw bytes", () => {
  it("serves media inline with the sandbox CSP and anything else as an octet-stream download", async () => {
    const png = await raw(req(filesRawUrl(repo, "logo.png"), { token: getToken() }));
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("content-security-policy")).toBe(ARTIFACT_CSP);
    const md = await raw(req(filesRawUrl(repo, "README.md"), { token: getToken() }));
    expect(md.headers.get("content-type")).toBe("application/octet-stream");
    expect(md.headers.get("content-disposition")).toMatch(/^attachment;/);
    const dl = await raw(req(`${filesRawUrl(repo, "logo.png")}&download=1`, { token: getToken() }));
    expect(dl.headers.get("content-type")).toBe("application/octet-stream");
    expect((await raw(req(filesRawUrl(repo, ".env"), { token: getToken() }))).status).toBe(403);
  });

  it("takes a signed URL from the owner's own browser only, for exactly that file", async () => {
    const src = filesSrc(repo, "logo.png");
    expect((await raw(req(src))).status).toBe(200);
    expect((await raw(req(src.replace("logo.png", "README.md")))).status).toBe(401);
    expect((await raw(req(src.replace(/sig=[0-9a-f]{4}/, "sig=0000")))).status).toBe(401);
    const remote = req(src);
    remote.headers.set("cf-ray", "abc");
    expect((await raw(remote)).status).toBe(401);
  });

  it("next.config puts the sandbox CSP on the raw route after the global rule", async () => {
    const rules = await nextConfig.headers!();
    const at = (src: string) => rules.findIndex((r) => r.source === src);
    expect(at("/api/files/raw")).toBeGreaterThan(at("/:path*"));
    expect(rules[at("/api/files/raw")].headers.find((h) => h.key.toLowerCase() === "content-security-policy")?.value).toBe(ARTIFACT_CSP);
  });
});

describe("files: links", () => {
  it("resolves a markdown link against the file's folder, never out of the root", () => {
    expect(relLink("docs/a.md", "b.md")).toBe("docs/b.md");
    expect(relLink("docs/a.md", "../README.md#top")).toBe("README.md");
    expect(relLink("docs/a.md", "./img/x%20y.png")).toBe("docs/img/x y.png");
    expect(relLink("docs/a.md", "/src/2-a.ts")).toBe("src/2-a.ts");
    expect(relLink("docs/a.md", "../../etc/passwd")).toBeNull();
    for (const href of ["https://x.dev", "mailto:a@b.c", "#part", "//evil.dev/x", "javascript:alert(1)", ""]) expect(relLink("docs/a.md", href)).toBeNull();
  });

  it("cuts http(s) URLs out of text, trailing punctuation left as text", () => {
    expect(splitLinks("xem https://8syncdev.com/a?b=1. rồi http://x.dev, xong")).toEqual(["xem ", { url: "https://8syncdev.com/a?b=1" }, ". rồi ", { url: "http://x.dev" }, ", xong"]);
    expect(splitLinks("ftp://x javascript:alert(1)")).toEqual(["ftp://x javascript:alert(1)"]);
  });
});
