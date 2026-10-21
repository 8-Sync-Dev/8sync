import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Never a real room: delivery, the office and the project list are fakes.
const deliverWatched = vi.hoisted(() => vi.fn());
const queueInbox = vi.hoisted(() => vi.fn());
const loadOffice = vi.hoisted(() => vi.fn());
const diskProjects = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/channel", async (orig) => ({ ...(await orig<typeof import("@/lib/server/channel")>()), deliverWatched }));
vi.mock("@/lib/server/inbox", async (orig) => ({ ...(await orig<typeof import("@/lib/server/inbox")>()), queueInbox, inboxLive: () => true }));
vi.mock("@/lib/server/office", async (orig) => ({ ...(await orig<typeof import("@/lib/server/office")>()), loadOffice }));
vi.mock("@/lib/server/disk", async (orig) => ({ ...(await orig<typeof import("@/lib/server/disk")>()), diskProjects }));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as getLoop, POST as postLoop } from "@/app/api/machine/cleanup/route";
import { GET as getDisk, POST as postDisk } from "@/app/api/machine/disk/route";
import { getToken } from "@/lib/server/auth";
import { SessionWaiting } from "@/lib/server/channel";
import { FIRST_DELAY_MS, LOOP_EVERY_MS, loopState, readLoop, RESEND_MS, runLoop, setLoopProject, shouldSend, startCleanupLoop, stopCleanupLoop } from "@/lib/server/cleanup-loop";
import { getDb } from "@/lib/server/db";
import { resetDisk, startScan } from "@/lib/server/disk";
import { diskKey } from "@/lib/disk";
import { ORIGIN, req, tempHome } from "./helpers";

let token = "";
let home = "";
let root = "";
const room = (name: string, label: string, cwd = root) => ({ key: name, name, label, cwd, project: { root: cwd, name: "shop", branch: "main" }, delivery: "terminal", role: null, tokens: null, inboxLive: false });

/** A project whose evidence folder is over 20 MB (sparse-free: a real 21 MB file). */
function bloat(mb: number) {
  fs.mkdirSync(path.join(root, "qa", "evidence"), { recursive: true });
  fs.writeFileSync(path.join(root, "qa", "evidence", "shots.bin"), Buffer.alloc(mb * 2 ** 20));
}

beforeAll(() => {
  home = tempHome();
  token = getToken();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-cleanup-"));
  fs.writeFileSync(path.join(root, "README.md"), "x");
});
beforeEach(() => {
  deliverWatched.mockReset().mockResolvedValue({ message: { id: 1 }, delivery: "terminal", error: null });
  queueInbox.mockReset();
  loadOffice.mockReset().mockResolvedValue({ rooms: [room("hq-qa", "qa"), room("hq-lead", "lead")] });
  diskProjects.mockReset().mockResolvedValue([{ root, name: "shop", branch: "main" }]);
  fs.rmSync(path.join(home, ".local", "state", "8sync", "hq", "cleanup.json"), { force: true });
  fs.rmSync(path.join(home, ".local", "state", "8sync", "hq", "disk.json"), { force: true });
  fs.rmSync(path.join(root, "qa"), { recursive: true, force: true });
  resetDisk();
});

describe("shouldSend", () => {
  const f = [{ id: "dir:.git", severity: "warn" as const, path: ".git", bytes: 1, why: "x" }];
  it("nothing found, or the same set within 24 h: no", () => {
    expect(shouldSend([], undefined, 0)).toBe(false);
    expect(shouldSend(f, { fp: "dir:.git", at: 0, room: "lead", n: 1, delivery: "terminal" }, RESEND_MS - 1)).toBe(false);
  });
  it("new findings, or a day later: yes", () => {
    expect(shouldSend(f, undefined, 0)).toBe(true);
    expect(shouldSend(f, { fp: "other", at: 0, room: "lead", n: 1, delivery: "terminal" }, 1)).toBe(true);
    expect(shouldSend(f, { fp: "dir:.git", at: 0, room: "lead", n: 1, delivery: "terminal" }, RESEND_MS + 1)).toBe(true);
  });
});

describe("runLoop", () => {
  it("does nothing for a project with the loop off", async () => {
    bloat(21);
    await runLoop(1_000, getDb());
    expect(deliverWatched).not.toHaveBeenCalled();
    expect(readLoop().lastRun).toBe(1_000);
  });

  it("sends the prepared message to the lead once, then not again for the same findings", async () => {
    bloat(21);
    setLoopProject(root, { on: true });
    await runLoop(10_000, getDb());
    expect(deliverWatched).toHaveBeenCalledTimes(1);
    const [, to, text] = deliverWatched.mock.calls[0];
    expect(to).toBe("hq-lead");
    expect(text).toContain("qa/evidence");
    expect(text).toContain("AskUserQuestion");
    const sent = readLoop().sent[diskKey(root)];
    expect(sent).toEqual({ fp: "evidence:qa/evidence", room: "lead", n: 1, delivery: "terminal", at: 10_000 });

    await runLoop(10_000 + LOOP_EVERY_MS, getDb());
    expect(deliverWatched).toHaveBeenCalledTimes(1);
    await runLoop(10_000 + RESEND_MS + 1, getDb());
    expect(deliverWatched).toHaveBeenCalledTimes(2);
  });

  it("the picked room wins; an inbox room is queued, not typed into", async () => {
    bloat(21);
    const sid = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
    loadOffice.mockResolvedValue({ rooms: [room("hq-lead", "lead"), { ...room(sid, "dev"), delivery: "inbox" }] });
    setLoopProject(root, { on: true, room: sid });
    await runLoop(20_000, getDb());
    expect(deliverWatched).not.toHaveBeenCalled();
    expect(queueInbox).toHaveBeenCalledTimes(1);
    expect(queueInbox.mock.calls[0][0]).toBe(sid);
    expect(readLoop().sent[diskKey(root)]).toMatchObject({ room: "dev", delivery: "inbox-live" });
  });

  it("a send that did not reach the room is not recorded as sent: the next run retries", async () => {
    bloat(21);
    deliverWatched.mockRejectedValueOnce(new SessionWaiting("permission"));
    setLoopProject(root, { on: true });
    await runLoop(30_000, getDb());
    expect(readLoop().sent[diskKey(root)]).toBeUndefined();
    expect(readLoop().lastError[diskKey(root)]).toEqual({ at: 30_000, room: "lead", error: "phòng đang chờ anh trả lời" });

    deliverWatched.mockResolvedValueOnce({ message: { id: 2 }, delivery: "failed", error: "tmux: no such session" });
    await runLoop(30_000 + LOOP_EVERY_MS, getDb());
    expect(deliverWatched).toHaveBeenCalledTimes(2);
    expect(readLoop().sent[diskKey(root)]).toBeUndefined();
    expect(readLoop().lastError[diskKey(root)]).toMatchObject({ error: "tmux: no such session" });

    await runLoop(30_000 + 2 * LOOP_EVERY_MS, getDb());
    expect(deliverWatched).toHaveBeenCalledTimes(3);
    expect(readLoop().sent[diskKey(root)]).toMatchObject({ room: "lead", delivery: "terminal", at: 30_000 + 2 * LOOP_EVERY_MS });
    expect(readLoop().lastError[diskKey(root)]).toBeUndefined(); // a send that went through clears it
  });

  it("findings but no live room: an error for the tab, nothing sent", async () => {
    bloat(21);
    loadOffice.mockResolvedValue({ rooms: [] });
    setLoopProject(root, { on: true });
    await runLoop(50_000, getDb());
    expect(deliverWatched).not.toHaveBeenCalled();
    expect(readLoop().lastError[diskKey(root)]).toEqual({ at: 50_000, room: null, error: "dự án chưa có phòng nào chạy" });
  });

  it("clean project: no send", async () => {
    setLoopProject(root, { on: true });
    await runLoop(40_000, getDb());
    expect(deliverWatched).not.toHaveBeenCalled();
  });
});

describe("schedule", () => {
  it("first run waits FIRST_DELAY_MS after a start, or until LOOP_EVERY_MS after the last run", () => {
    stopCleanupLoop();
    startCleanupLoop(5_000_000);
    expect(loopState().nextRun).toBe(5_000_000 + FIRST_DELAY_MS);
    stopCleanupLoop();
    setLoopProject(root, { on: false });
    const s = readLoop();
    fs.writeFileSync(path.join(home, ".local", "state", "8sync", "hq", "cleanup.json"), JSON.stringify({ ...s, lastRun: 5_000_000 }));
    startCleanupLoop(5_000_000);
    expect(loopState().nextRun).toBe(5_000_000 + LOOP_EVERY_MS);
    stopCleanupLoop();
  });
});

describe("/api/machine/cleanup", () => {
  const post = (body: unknown) => postLoop(req("/api/machine/cleanup", { method: "POST", token, origin: ORIGIN, body }));
  it("flips one project and persists it in cleanup.json", async () => {
    const r = await post({ root, on: true });
    expect(r.status).toBe(200);
    expect((await r.json()).projects[diskKey(root)]).toEqual({ on: true, room: null });
    expect((await post({ root, room: "hq-qa" })).status).toBe(200);
    const file = JSON.parse(fs.readFileSync(path.join(home, ".local", "state", "8sync", "hq", "cleanup.json"), "utf8"));
    expect(file.projects[diskKey(root)]).toEqual({ on: true, room: "hq-qa" });
    const g = await (await getLoop(req("/api/machine/cleanup", { token }))).json();
    expect(g.projects[diskKey(root)].on).toBe(true);
  });
  it("refuses bad bodies", async () => {
    for (const b of [{}, { root: "" }, { root, on: "yes" }, { root }, { root, room: 5 }]) expect((await post(b)).status).toBe(400);
  });
});

describe("/api/machine/disk", () => {
  it("first GET starts a scan; POST rescans; the result carries findings", async () => {
    bloat(21);
    const first = await (await getDisk(req("/api/machine/disk", { token }))).json();
    expect(first.scanning).toBe(true);
    await startScan([{ root, name: "shop", branch: "main" }]); // joins the scan GET started
    const done = await (await getDisk(req("/api/machine/disk", { token }))).json();
    expect(done.scanning).toBe(false);
    expect(done.projects).toHaveLength(1);
    expect(done.projects[0].findings.map((f: { id: string }) => f.id)).toEqual(["evidence:qa/evidence"]);
    expect(fs.existsSync(path.join(home, ".local", "state", "8sync", "hq", "disk.json"))).toBe(true);
    expect((await postDisk(req("/api/machine/disk", { method: "POST", token, origin: ORIGIN }))).status).toBe(202);
  });
});
