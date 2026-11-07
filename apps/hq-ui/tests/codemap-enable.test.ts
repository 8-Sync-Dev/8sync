import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/codemap/enable/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { resetGraphify } from "@/lib/server/graphify";
import { resetTrail } from "@/lib/server/trail";
import { ORIGIN, req, tempHome } from "./helpers";

// POST /api/codemap/enable: "Tạo bản đồ code cho repo này" on a bot's Bản đồ code tab.
describe("codemap enable route", () => {
  let token = "";
  let roomRoot = "";
  let stranger = "";
  const savedPath = process.env.PATH;
  const projectRow = (p: string) => getDb().prepare("SELECT id, path FROM projects WHERE path = ?").get(p) as { id: number; path: string } | undefined;

  beforeAll(() => {
    tempHome();
    token = getToken();
    // No graphify / trail / tmux on PATH: nothing real runs, the route says what is missing.
    process.env.PATH = "";
    resetGraphify();
    resetTrail();
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-enable-")));
    roomRoot = path.join(base, "bot-repo");
    stranger = path.join(base, "elsewhere");
    fs.mkdirSync(roomRoot);
    fs.mkdirSync(stranger);
    // A room HQ has seen work in roomRoot (ended now): a known root, not yet a project.
    getDb().prepare("INSERT INTO sessions(name, started_at, status, cwd, updated_at) VALUES (?, ?, 'ended', ?, ?)").run("hq-bot-uat", Date.now(), roomRoot, Date.now());
  });
  afterAll(() => {
    process.env.PATH = savedPath;
  });

  const post = (body: unknown, ui = true) => POST(req("/api/codemap/enable", { method: "POST", token, origin: ORIGIN, body, ui }));

  it("a room (hq.mjs: UI token, no page marker) gets 403 and registers nothing", async () => {
    const r = await post({ path: roomRoot }, false);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Chỉ chủ HQ tạo bản đồ code, từ trang HQ" });
    expect(projectRow(roomRoot)).toBeUndefined();
  });

  it("no token, another origin: refused before anything", async () => {
    expect((await POST(req("/api/codemap/enable", { method: "POST", origin: ORIGIN, body: { path: roomRoot }, ui: true }))).status).toBe(401);
    expect((await POST(req("/api/codemap/enable", { method: "POST", token, origin: "https://evil.example", body: { path: roomRoot }, ui: true }))).status).toBe(403);
  });

  it("a folder HQ does not know (or not a folder path at all) is refused, never registered", async () => {
    expect((await post({ path: stranger })).status).toBe(409);
    expect(projectRow(stranger)).toBeUndefined();
    expect((await post({ path: "relative/dir" })).status).toBe(422);
    expect((await post({ path: `${roomRoot}${path.sep}..${path.sep}elsewhere` })).status).toBe(422);
    expect((await post({})).status).toBe(422);
    expect((await post({ project: 99999 })).status).toBe(404);
  });

  it("the owner's page: a known room root becomes a project, 202, and says what could not start", async () => {
    const r = await post({ path: roomRoot });
    expect(r.status).toBe(202);
    const body = await r.json();
    const row = projectRow(roomRoot);
    expect(row).toBeDefined();
    expect(body).toMatchObject({ project: { id: row!.id, name: "bot-repo", root: roomRoot }, update: null, build: null });
    expect(body.notes).toEqual([expect.stringMatching(/chưa cài graphify/), expect.stringMatching(/không tìm thấy lệnh trail/)]);
    // Again (by path or by id): the same project, not a second row.
    expect((await post({ path: roomRoot })).status).toBe(202);
    expect((await post({ project: row!.id })).status).toBe(202);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM projects WHERE path = ?").get(roomRoot)).toEqual({ n: 1 });
  });
});
