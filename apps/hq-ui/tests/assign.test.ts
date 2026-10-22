import fs from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  live: [] as string[],
  sendKeys: vi.fn(async () => ({ ok: true, stderr: "" })),
  startTmux: vi.fn(async () => ({ ok: true, stdout: "", stderr: "" })),
}));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  listTmux: async () => m.live.map((name) => ({ name, created: 0, pid: null, cwd: null })),
  sendKeys: m.sendKeys,
  startTmux: m.startTmux,
  // tmux "is here" for these tests (on Windows HQ would start background sessions instead).
  hasTmux: async () => true,
  capturePlain: async () => "> ",
  channelArgs: () => ({ args: [], mode: "off", reason: null }),
}));

import { POST as tasksPOST } from "@/app/api/tasks/route";
import { POST as sessionsPOST } from "@/app/api/sessions/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ORIGIN, req, tempHome } from "./helpers";

let token = "";
let home = "";
let pid = 0;
beforeAll(() => {
  home = tempHome();
  token = getToken();
  const db = getDb();
  pid = Number(db.prepare("INSERT INTO projects(path, name, added_at) VALUES (?, 'p', 1)").run(fs.realpathSync(home)).lastInsertRowid);
});
beforeEach(() => {
  m.live = [];
  m.sendKeys.mockClear();
  m.startTmux.mockClear();
  getDb().exec("DELETE FROM sessions; DELETE FROM tasks; DELETE FROM messages;");
});

const post = (body: unknown, auth = true) =>
  tasksPOST(req("/api/tasks", { method: "POST", token: auth ? token : null, origin: ORIGIN, body }));
const seed = (name: string, role: string, started: number) =>
  getDb().prepare("INSERT INTO sessions(name, project_id, started_at, status, role, updated_at) VALUES (?, ?, ?, 'running', ?, 1)").run(name, pid, started, role);

describe("assign by role", () => {
  it("picks the running session with that role, least recent activity first", async () => {
    seed("hq-tester-1", "tester", 200);
    seed("hq-tester-2", "tester", 100);
    seed("hq-quick-1", "quick", 1);
    m.live = ["hq-tester-1", "hq-tester-2", "hq-quick-1"];
    const res = await post({ subject: "write tests", role: "tester", prio: "p1" });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toMatchObject({ session: "hq-tester-2", started: false });
    expect(m.startTmux).not.toHaveBeenCalled();
    expect(m.sendKeys).toHaveBeenCalledWith("hq-tester-2", expect.stringContaining("New task: write tests"));
  });
  it("ignores a role session that is no longer running, and starts a new one", async () => {
    seed("hq-tester-1", "tester", 1);
    m.live = ["hq-tester-1"].slice(1);
    const res = await post({ subject: "x", role: "tester", project: pid });
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toMatchObject({ session: "hq-tester-1", started: true });
    expect(m.startTmux).toHaveBeenCalledWith("hq-tester-1", expect.any(String), expect.objectContaining({ role: "tester", model: "claude-haiku-5-5" }));
    expect(getDb().prepare("SELECT role, model FROM sessions WHERE name = 'hq-tester-1'").get()).toEqual({ role: "tester", model: "claude-haiku-5-5" });
  });
  it("hands a fresh session its task as the first prompt instead of typing into a booting pane", async () => {
    m.live = [];
    const res = await post({ subject: "smoke the login", details: "use the demo account", role: "tester", project: pid });
    const j = await res.json();
    expect(j).toMatchObject({ started: true, delivery: "first-prompt" });
    expect(m.startTmux).toHaveBeenCalledWith(j.session, expect.any(String), expect.objectContaining({ prompt: expect.stringContaining("New task: smoke the login") }));
    expect(m.sendKeys).not.toHaveBeenCalled();
    expect(getDb().prepare("SELECT subject FROM tasks WHERE session = ?").get(j.session)).toEqual({ subject: "smoke the login" });
  });
  it("starts hq-<role>-<n> with the next free n and honours a model override", async () => {
    m.live = ["hq-rd-1"];
    const res = await post({ subject: "x", role: "rd", project: pid, model: "claude-sonnet-5-5" });
    expect((await res.json()).session).toBe("hq-rd-2");
    expect(m.startTmux).toHaveBeenCalledWith("hq-rd-2", expect.any(String), expect.objectContaining({ model: "claude-sonnet-5-5" }));
  });
  it("needs a project when nothing runs", async () => {
    expect((await post({ subject: "x", role: "quick" })).status).toBe(422);
  });
  it("explicit session is delivered as before", async () => {
    const res = await post({ subject: "go", session: "hq-abc", details: "line1\nline2" });
    expect(res.status).toBe(201);
    expect(m.sendKeys).toHaveBeenCalledWith("hq-abc", expect.stringContaining("line2"));
  });
});

describe("scheduled assign", () => {
  it("delivers a CronCreate booking prompt and labels the task row", async () => {
    const res = await post({ subject: "check CI", session: "hq-abc", schedule: { kind: "every", n: 30, unit: "m" } });
    expect(res.status).toBe(201);
    expect(m.sendKeys).toHaveBeenCalledWith("hq-abc", expect.stringContaining('CronCreate với cron "*/30 * * * *"'));
    expect(m.sendKeys).toHaveBeenCalledWith("hq-abc", expect.stringContaining("New task: check CI"));
    expect(m.sendKeys).toHaveBeenCalledWith("hq-abc", expect.stringContaining("[8sync:wake] New task: check CI"));
    expect(getDb().prepare("SELECT subject FROM tasks WHERE session = 'hq-abc'").get()).toEqual({ subject: "check CI · ⏰ ≈mỗi 30 phút (nhờ phiên lên lịch)" });
  });
  it("a fresh role session gets the booking prompt as its first prompt", async () => {
    m.live = [];
    const res = await post({ subject: "nightly audit", role: "rd", project: pid, schedule: { kind: "daily", at: "02:13" } });
    const j = await res.json();
    expect(j).toMatchObject({ started: true, delivery: "first-prompt" });
    expect(m.startTmux).toHaveBeenCalledWith(j.session, expect.any(String), expect.objectContaining({ prompt: expect.stringContaining('cron "13 2 * * *"') }));
  });
  it("rejects a bad schedule before storing anything", async () => {
    expect((await post({ subject: "x", session: "hq-abc", schedule: { kind: "once", at: "25:00" } })).status).toBe(422);
    expect((await post({ subject: "x", session: "hq-abc", schedule: { kind: "every", n: 7, unit: "m" } })).status).toBe(422);
    expect(m.sendKeys).not.toHaveBeenCalled();
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  });
});

describe("validation and auth", () => {
  it("rejects bad role, bad model, missing target, bad session", async () => {
    expect((await post({ subject: "x", role: "wizard", project: pid })).status).toBe(422);
    expect((await post({ subject: "x", role: "rd", project: pid, model: "gpt-5" })).status).toBe(422);
    expect((await post({ subject: "x" })).status).toBe(422);
    expect((await post({ subject: "x", session: "bash; rm" })).status).toBe(422);
    expect(m.startTmux).not.toHaveBeenCalled();
  });
  it("requires the token and a same-origin request", async () => {
    expect((await post({ subject: "x", role: "rd" }, false)).status).toBe(401);
    const cross = await tasksPOST(req("/api/tasks", { method: "POST", token, origin: "http://evil.example", body: { subject: "x", session: "hq-a" } }));
    expect(cross.status).toBeGreaterThanOrEqual(400);
  });
  it("POST /api/sessions rejects unknown role/model and stores a valid role", async () => {
    const s = (body: unknown) => sessionsPOST(req("/api/sessions", { method: "POST", token, origin: ORIGIN, body }));
    expect((await s({ project: pid, name: "a1", role: "nope" })).status).toBe(422);
    expect((await s({ project: pid, name: "a1", model: "claude-opus-4" })).status).toBe(422);
    const ok = await s({ project: pid, name: "a1", role: "architect" });
    expect(ok.status).toBe(201);
    expect(m.startTmux).toHaveBeenCalledWith("hq-a1", expect.any(String), expect.objectContaining({ role: "architect", model: "claude-opus-5-5" }));
    expect(getDb().prepare("SELECT role FROM sessions WHERE name = 'hq-a1'").get()).toEqual({ role: "architect" });
  });
});
