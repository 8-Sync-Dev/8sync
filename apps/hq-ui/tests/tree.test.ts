import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/tree/route";
import { getToken } from "@/lib/server/auth";
import { TREE_MAX, folderNameError, hiddenDir, listTree, makeFolder, resolveTreeDir, treeListing, treeParent, treeRoots } from "@/lib/server/tree";
import { req, tempHome } from "./helpers";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hq-tree-"));
  tmps.push(d);
  return d;
};

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

describe("machine folder tree (workspace)", () => {
  it("roots: the drives that exist on Windows, else / and home", () => {
    expect(treeRoots("win32", "C:\\Users\\me", (p) => p === "C:\\" || p === "E:\\")).toEqual(["C:\\", "E:\\"]);
    expect(treeRoots("linux", "/home/me", () => true)).toEqual(["/", "/home/me"]);
    expect(treeRoots("darwin", "/", () => true)).toEqual(["/"]);
  });

  it("lists folders only, sorted by name, without dot-dirs, node_modules or Windows system folders; marks git repos", () => {
    const d = tmp();
    for (const n of ["beta", "Alpha", ".cache", "node_modules", "app10", "app9"]) fs.mkdirSync(path.join(d, n));
    fs.mkdirSync(path.join(d, "beta", ".git"));
    fs.writeFileSync(path.join(d, "file.txt"), "x");
    expect(listTree(d).map((x) => [x.name, x.git])).toEqual([["Alpha", false], ["app9", false], ["app10", false], ["beta", true]]);
    expect(listTree(d)[0].path).toBe(path.join(d, "Alpha"));
    expect(hiddenDir("$Recycle.Bin", "win32") && hiddenDir("System Volume Information", "win32")).toBe(true);
    expect(hiddenDir("$x", "linux")).toBe(false);
  });

  it("caps a huge folder at TREE_MAX", () => {
    const d = tmp();
    for (let i = 0; i < TREE_MAX + 5; i++) fs.mkdirSync(path.join(d, `d${String(i).padStart(4, "0")}`));
    expect(listTree(d)).toHaveLength(TREE_MAX);
  });

  it("only an existing absolute folder resolves; the root has no parent", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "f"), "x");
    expect(resolveTreeDir(d)).toBe(path.resolve(d));
    expect(resolveTreeDir(path.join(d, "f"))).toBeNull();
    expect(resolveTreeDir("relative/dir")).toBeNull();
    expect(resolveTreeDir(`${d}\0x`)).toBeNull();
    expect(resolveTreeDir("")).toBeNull();
    const root = path.parse(d).root;
    expect(treeParent(root)).toBeNull();
    expect(treeParent(path.join(d, "x"))).toBe(d);
  });

  it("empty path lists the roots as dirs, with the home folder", () => {
    expect(treeListing("", [os.tmpdir()], "/home/me")).toMatchObject({ path: "", parent: null, roots: [os.tmpdir()], home: "/home/me", dirs: [{ name: os.tmpdir(), path: os.tmpdir() }] });
    expect(treeListing(os.tmpdir(), [], "/home/me")?.home).toBe("/home/me");
  });

  it("GET /api/tree needs the HQ token and answers 404 for a non-folder", async () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "sub"));
    expect((await GET(req(`/api/tree?path=${encodeURIComponent(d)}`, {}))).status).toBe(401);
    const res = await GET(req(`/api/tree?path=${encodeURIComponent(d)}`, { token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ path: path.resolve(d), parent: path.dirname(path.resolve(d)), dirs: [{ name: "sub", git: false }] });
    expect((await GET(req(`/api/tree?path=${encodeURIComponent(path.join(d, "nope"))}`, { token }))).status).toBe(404);
  });

  it("a new folder name: one plain level, portable across Windows and Unix", () => {
    for (const ok of ["my-app", "Dự án 8 Sync", "v1.2", ".config"]) expect(folderNameError(ok)).toBeNull();
    for (const bad of ["", "  ", " lead", "trail ", ".", "..", "a/b", "a\\b", "x:y", "q?", "end.", "CON", "nul.txt", "com1", "a\u0001"]) expect(folderNameError(bad)).not.toBeNull();
    expect(folderNameError("x".repeat(101))).not.toBeNull();
  });

  it("makeFolder creates one empty folder, never over an existing one or under a missing parent", () => {
    const d = tmp();
    expect(makeFolder(d, "app")).toEqual({ ok: true, path: path.join(d, "app") });
    expect(fs.statSync(path.join(d, "app")).isDirectory()).toBe(true);
    expect(makeFolder(d, "app")).toMatchObject({ ok: false, status: 409 });
    expect(makeFolder(path.join(d, "missing"), "x")).toMatchObject({ ok: false, status: 404 });
    expect(makeFolder(d, "../escape")).toMatchObject({ ok: false, status: 422 });
    expect(fs.existsSync(path.join(path.dirname(d), "escape"))).toBe(false);
  });

  it("POST /api/tree: owner only (token + UI origin), 201 with the path, git init on request", async () => {
    const d = tmp();
    const body = { parent: d, name: "plain" };
    expect((await POST(req("/api/tree", { method: "POST", body, origin: "http://127.0.0.1:8740" }))).status).toBe(401);
    expect((await POST(req("/api/tree", { method: "POST", body, token }))).status).toBe(403);
    const res = await POST(req("/api/tree", { method: "POST", body, token, origin: "http://127.0.0.1:8740" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ path: path.join(d, "plain"), git: false });
    const g = await POST(req("/api/tree", { method: "POST", body: { parent: d, name: "repo", git: true }, token, origin: "http://127.0.0.1:8740" }));
    expect(g.status).toBe(201);
    expect((await g.json()).git).toBe(true);
    expect(fs.existsSync(path.join(d, "repo", ".git"))).toBe(true);
    expect((await POST(req("/api/tree", { method: "POST", body: { parent: d, name: "x", git: "yes" }, token, origin: "http://127.0.0.1:8740" }))).status).toBe(422);
  });
});
