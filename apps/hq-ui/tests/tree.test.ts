import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/tree/route";
import { getToken } from "@/lib/server/auth";
import { TREE_MAX, hiddenDir, listTree, resolveTreeDir, treeListing, treeParent, treeRoots } from "@/lib/server/tree";
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

  it("empty path lists the roots as dirs", () => {
    expect(treeListing("", [os.tmpdir()])).toMatchObject({ path: "", parent: null, roots: [os.tmpdir()], dirs: [{ name: os.tmpdir(), path: os.tmpdir() }] });
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
});
