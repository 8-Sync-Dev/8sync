import os from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const merged = vi.hoisted(() => vi.fn());
const spawned = vi.hoisted(() => [] as { args: string[]; cwd?: string; proc: EventEmitter & { stdout: PassThrough; stdin: PassThrough } }[]);
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: merged,
}));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: (_cmd: string, args: string[], opts: { cwd?: string }) => {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), kill: () => proc.emit("exit", null) });
    spawned.push({ args, cwd: opts.cwd, proc });
    return proc;
  },
}));

import { DELETE, GET, POST } from "@/app/api/sessions/[name]/term/route";
import { getToken } from "@/lib/server/auth";
import { resetFloorCache } from "@/lib/server/floor";
import { ELSEWHERE_EXIT, closeTerm, openTerm, poll, takeoverTerm, termArgs, termOpen, watch } from "@/lib/server/term";
import { activityScreen } from "@/lib/term-activity";
import { ORIGIN, req, tempHome } from "./helpers";

const ROOM = "omp-00000000000000a1";
const CLAUDE = "3698e3a6-9b73-4b37-ab3a-368b169d0508";
const lsOut = (rows: unknown[]) => ({ ok: true, stdout: JSON.stringify(rows), stderr: "" });
// Idle on purpose: an omp room with no omp process still opens (its terminal starts it).
const ompRow = { engine: "omp", name: "core", repo: "C:\\w\\app", status: "idle", last_active: 1, inbox_id: ROOM, transcript: "C:\\sd\\x.jsonl" };
const params = (name: string) => ({ params: Promise.resolve({ name }) }) as never;

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});
beforeEach(() => {
  resetFloorCache();
  spawned.length = 0;
  run.mockReset();
  run.mockResolvedValue(lsOut([ompRow]));
  merged.mockReset();
  merged.mockResolvedValue([]);
});
afterEach(() => {
  closeTerm(ROOM);
  closeTerm(CLAUDE);
});

describe("an omp room's terminal", () => {
  it("GET opens `8sync ccc term <omp-room-id>` in the room's repo from `8sync ls`, never a path from the client", async () => {
    const res = await GET(req(`/api/sessions/${ROOM}/term?cols=90&rows=25&gen=0&since=-1`, { token }), params(ROOM));
    expect(res.status).toBe(200);
    expect(spawned.map((s) => [s.args, s.cwd])).toEqual([[termArgs(ROOM, 90, 25), "C:\\w\\app"]]);
    expect(termArgs(ROOM, 90, 25)).toEqual(["ccc", "term", ROOM, "--cols", "90", "--rows", "25"]);
    expect(await res.json()).toMatchObject({ ended: false, elsewhere: false });
  });

  it("refuses an id that is neither a session uuid nor an omp room id, and an omp room `8sync ls` does not know", async () => {
    for (const bad of ["..%2F..%2Fx", "omp-00000000000000A1", "omp-1234", "hq-core"]) {
      expect((await GET(req(`/api/sessions/${bad}/term`, { token }), params(decodeURIComponent(bad)))).status).toBe(422);
      expect((await POST(req(`/api/sessions/${bad}/term`, { method: "POST", token, origin: ORIGIN, body: { data: "x" } }), params(decodeURIComponent(bad)))).status).toBe(422);
    }
    expect((await GET(req(`/api/sessions/omp-0000000000000001/term`, { token }), params("omp-0000000000000001"))).status).toBe(404);
    expect((await GET(req(`/api/sessions/${ROOM}/term`, {}), params(ROOM))).status).toBe(401);
    expect(spawned).toHaveLength(0);
  });

  it("a session open in another terminal ends the bridge as `elsewhere` (exit 3), for the stream and the poll", async () => {
    const t = openTerm(ROOM, null, { cols: 80, rows: 24 });
    const ends: (Buffer | null)[] = [];
    watch(ROOM, t, (b) => ends.push(b));
    spawned[0].proc.stdout.write("phiên đang mở ở terminal khác trên máy (pid 42)\r\n");
    await new Promise((r) => setImmediate(r));
    spawned[0].proc.emit("exit", ELSEWHERE_EXIT);
    expect(ends.at(-1)).toBeNull();
    expect(t.elsewhere).toBe(true);
    expect(poll(ROOM, t, t.gen, 0)).toMatchObject({ ended: true, elsewhere: true });
    expect(termOpen(ROOM)).toBe(false);
    // Another exit code is a plain end; a Claude room is never `elsewhere`.
    const c = openTerm(CLAUDE, null, { cols: 80, rows: 24 });
    spawned[1].proc.emit("exit", ELSEWHERE_EXIT);
    expect(c.elsewhere).toBe(false);
  });

  it("“Chuyển sang HQ” is a POST with the token and Origin, for an omp room only, and spawns `--takeover`", async () => {
    const body = { takeover: true, cols: 100, rows: 30 };
    expect((await POST(req(`/api/sessions/${ROOM}/term`, { method: "POST", token, body }), params(ROOM))).status).toBe(403);
    expect((await POST(req(`/api/sessions/${ROOM}/term`, { method: "POST", origin: ORIGIN, body }), params(ROOM))).status).toBe(401);
    expect((await POST(req(`/api/sessions/${CLAUDE}/term`, { method: "POST", token, origin: ORIGIN, body }), params(CLAUDE))).status).toBe(422);
    expect((await POST(req(`/api/sessions/omp-0000000000000001/term`, { method: "POST", token, origin: ORIGIN, body }), params("omp-0000000000000001"))).status).toBe(404);
    expect(spawned).toHaveLength(0);
    const res = await POST(req(`/api/sessions/${ROOM}/term`, { method: "POST", token, origin: ORIGIN, body }), params(ROOM));
    expect(res.status).toBe(200);
    expect(spawned.map((s) => [s.args, s.cwd])).toEqual([[["ccc", "term", ROOM, "--takeover", "--cols", "100", "--rows", "30"], "C:\\w\\app"]]);
    // The page reconnects with GET and joins that same bridge.
    await GET(req(`/api/sessions/${ROOM}/term?gen=0&since=-1`, { token }), params(ROOM));
    expect(spawned).toHaveLength(1);
    expect(() => takeoverTerm(CLAUDE, null, { cols: 80, rows: 24 })).toThrow();
  });

  it("a `~\\x` repo (how `8sync ls` prints it on Windows) is expanded: an unexpanded cwd fails the spawn (ENOENT)", async () => {
    run.mockResolvedValue(lsOut([{ ...ompRow, repo: "~\\w\\app" }]));
    await GET(req(`/api/sessions/${ROOM}/term?gen=0&since=-1`, { token }), params(ROOM));
    expect(spawned.map((s) => s.cwd)).toEqual([`${os.homedir()}\\w\\app`]);
  });

  it("closing the drawer only ends the bridge (the connection to the omp host)", async () => {
    openTerm(ROOM, null, { cols: 80, rows: 24 });
    const res = await DELETE(req(`/api/sessions/${ROOM}/term`, { method: "DELETE", token, origin: ORIGIN }), params(ROOM));
    expect(res.status).toBe(200);
    expect(termOpen(ROOM)).toBe(false);
  });
});

describe("the read-only view of an omp session open in another terminal", () => {
  it("writes the Nhật ký events as terminal lines, newest last, with no escape from the transcript", () => {
    const at = new Date(2026, 9, 21, 9, 5).getTime();
    const s = activityScreen([
      { kind: "prompt", at, text: "sửa board\nđi" },
      { kind: "text", at, text: "Đọc board trước.\x1b]52;c;cm0gLXJm\x07\x1b[2J" },
      { kind: "tool", at, tool: "bash", text: "Checking open PRs", status: "error", error: "exit 22" },
      { kind: "tool", at: null, tool: "read", text: "Reading state", status: "pending" },
      { kind: "agent", at, tool: "reviewer", text: "Review diff" },
    ]);
    expect(s.startsWith("\x1b[2J\x1b[3J\x1b[H")).toBe(true);
    const plain = s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    expect(plain).toContain("Đang xem (chỉ đọc)");
    expect(plain).toContain("09:05 › sửa board\r\nđi");
    expect(plain).toContain("09:05 ✗ bash: Checking open PRs — exit 22");
    expect(plain).toContain("      … read: Reading state");
    expect(plain).toContain("⇢ subagent reviewer: Review diff");
    expect(plain.indexOf("sửa board")).toBeLessThan(plain.indexOf("Review diff"));
    // Only the view's own clear at the top: the reply's OSC 52 / clear-screen bytes are gone.
    expect(s.indexOf("\x1b]")).toBe(-1);
    expect(s.lastIndexOf("\x1b[2J")).toBe(0);
    expect(activityScreen([])).toContain("Chưa có gì");
  });
});
