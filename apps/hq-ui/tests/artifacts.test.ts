import { beforeAll, describe, expect, it, vi } from "vitest";

/** The live room's repo: a real temp git repo (set in beforeAll). */
const room = vi.hoisted(() => ({ cwd: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [{ name: "s1", cwd: room.cwd, status: "running" }],
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as list, POST as register } from "@/app/api/artifacts/route";
import { DELETE as forget } from "@/app/api/artifacts/[id]/route";
import { GET as file } from "@/app/api/artifacts/[id]/file/route";
import { groupArtifacts, type Artifact } from "@/lib/artifacts";
import { getToken } from "@/lib/server/auth";
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
const post = (body: unknown, tunnel = false) => {
  const r = req("/api/artifacts", { method: "POST", token: getToken(), origin: ORIGIN, body });
  if (tunnel) r.headers.set("cf-ray", "abc");
  return register(r);
};

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-art-")));
  fs.mkdirSync(path.join(repo, ".git"));
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  room.cwd = repo;
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-art-out-")));
});

describe("artifacts", () => {
  it("registers a report in a live project, lists it and serves its bytes; the same path again keeps its id", async () => {
    const f = put(repo, "outputs/report.md", "# Kết quả\n");
    const r1 = await post({ path: f, title: "Báo cáo tuần", note: "đọc phần 2", session: "omp-0123456789abcdef" });
    expect(r1.status).toBe(201);
    const a = ((await r1.json()) as { artifact: Artifact }).artifact;
    expect(a).toMatchObject({ title: "Báo cáo tuần", kind: "markdown", project: path.basename(repo), branch: "main", session: "omp-0123456789abcdef", missing: false, size: Buffer.byteLength("# Kết quả\n") });

    const r2 = await post({ path: f, title: "Báo cáo tuần v2" });
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { artifact: Artifact }).artifact).toMatchObject({ id: a.id, title: "Báo cáo tuần v2", session: "omp-0123456789abcdef", created_at: a.created_at });

    const got = (await (await list(req("/api/artifacts", { token: getToken() }))).json()) as { artifacts: Artifact[] };
    expect(got.artifacts.map((x) => x.id)).toEqual([a.id]);
    const bySession = (await (await list(req("/api/artifacts?session=omp-ffffffffffffffff", { token: getToken() }))).json()) as { artifacts: Artifact[] };
    expect(bySession.artifacts).toEqual([]);

    const res = await file(req(`/api/artifacts/${a.id}/file`, { token: getToken() }), ctx(a.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await res.text()).toBe("# Kết quả\n");
  });

  it("refuses files outside known projects, unshown types, secret-looking names, .git and the public link", async () => {
    expect((await post({ path: put(outside, "x.md", "x") })).status).toBe(403);
    expect((await post({ path: put(repo, "bin/app.exe", "x") })).status).toBe(422);
    expect((await post({ path: put(repo, "outputs/.env.md", "K=1") })).status).toBe(422);
    expect((await post({ path: put(repo, ".git/notes.md", "x") })).status).toBe(422);
    expect((await post({ path: "outputs/report.md" })).status).toBe(422);
    expect((await post({ path: path.join(repo, "nope.md") })).status).toBe(404);
    expect((await post({ path: put(repo, "outputs/a.md", "x"), session: "rm -rf" })).status).toBe(422);
    expect((await post({ path: put(repo, "outputs/b.md", "x") }, true)).status).toBe(403);
  });

  it("sandboxes HTML, reports a deleted file as missing and stops serving it, and forget keeps the file", async () => {
    const html = put(repo, "outputs/demo.html", "<script>parent.x=1</script>");
    const a = ((await (await post({ path: html })).json()) as { artifact: Artifact }).artifact;
    const res = await file(req(`/api/artifacts/${a.id}/file?download=1`, { token: getToken() }), ctx(a.id));
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''demo\.html$/);
    await res.body?.cancel();

    const gone = put(repo, "outputs/gone.pdf", "%PDF-1.4");
    const g = ((await (await post({ path: gone })).json()) as { artifact: Artifact }).artifact;
    fs.rmSync(gone);
    const rows = (await (await list(req("/api/artifacts", { token: getToken() }))).json()) as { artifacts: Artifact[] };
    expect(rows.artifacts.find((x) => x.id === g.id)).toMatchObject({ missing: true, size: null });
    expect((await file(req(`/api/artifacts/${g.id}/file`, { token: getToken() }), ctx(g.id))).status).toBe(404);

    const del = req(`/api/artifacts/${a.id}`, { method: "DELETE", token: getToken(), origin: ORIGIN });
    expect((await forget(del, ctx(a.id))).status).toBe(200);
    expect(fs.existsSync(html)).toBe(true);
    expect((await file(req(`/api/artifacts/${a.id}/file`, { token: getToken() }), ctx(a.id))).status).toBe(404);
  });

  it("does not serve a file whose path became a link out of its project", async () => {
    const target = put(outside, "secret.md", "nope");
    const f = put(repo, "outputs/swap.md", "ok");
    const a = ((await (await post({ path: f })).json()) as { artifact: Artifact }).artifact;
    fs.rmSync(f);
    try {
      fs.symlinkSync(target, f, "file");
    } catch {
      return; // no symlink right on this Windows account
    }
    expect((await file(req(`/api/artifacts/${a.id}/file`, { token: getToken() }), ctx(a.id))).status).toBe(404);
  });

  it("groups the list per project root, newest block first, whatever the slash or case", () => {
    const row = (id: string, root: string, project: string, at: number): Artifact => ({
      id, path: `${root}/${id}.md`, root, project, branch: null, session: null, title: id, note: null, kind: "markdown",
      created_at: at, updated_at: at, missing: false, size: 1, mtime: at,
    });
    const g = groupArtifacts([row("a", "C:\\x\\app", "app", 3), row("b", "C:\\x\\site", "site", 2), row("c", "c:/x/app", "app", 1)]);
    expect(g.map((x) => [x.project, x.items.map((i) => i.id)])).toEqual([["app", ["a", "c"]], ["site", ["b"]]]);
  });
});
