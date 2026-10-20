import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const merged = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: merged,
}));

import { GET } from "@/app/api/sessions/[name]/activity/route";
import { ompActivityFrom, readOmpActivity } from "@/lib/server/activity";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { loadFloor, ompSessions, resetFloorCache } from "@/lib/server/floor";
import { ORIGIN, req, tempHome } from "./helpers";

// Fake, but shaped like a real token: it must never reach the log. Built at runtime for secret scanners.
const FAKE_SECRET = ["gh", "p_", "FAKE".repeat(9)].join("");
const ROOM = "omp-83bf7fc460598f10";

const ts = (s: number) => `2026-10-20T15:00:${String(s).padStart(2, "0")}.000Z`;
const usage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const msg = (s: number, message: object) => JSON.stringify({ type: "message", id: `m${s}`, parentId: `m${s - 1}`, timestamp: ts(s), message: { timestamp: Date.parse(ts(s)), ...message } });
const assistant = (s: number, content: object[]) => msg(s, { role: "assistant", content, api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5-5", usage, stopReason: "toolUse" });
const result = (s: number, id: string, name: string, text: string, isError = false) =>
  msg(s, { role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], details: {}, isError });

// Lines shaped like a real omp session file (`<session-dir>/<ts>_<id>.jsonl`, checked 2026-10-20).
const OMP = [
  JSON.stringify({ type: "title", v: 1, title: "Fix board", source: "auto", updatedAt: ts(0), pad: "" }),
  JSON.stringify({ type: "session", version: 3, id: "s", timestamp: ts(0), cwd: "C:\\w\\app" }),
  JSON.stringify({ type: "model_change", id: "a", parentId: null, timestamp: ts(0), model: "anthropic/claude-opus-5-5", resolvedModelIsFallback: false }),
  JSON.stringify({ type: "custom", customType: "memory", data: { version: 1, scope: "x", text: "secret memory", memories: [] }, id: "b", parentId: "a", timestamp: ts(0) }),
  msg(1, { role: "user", content: [{ type: "text", text: "check board [Image #1, 722x1568]" }, { type: "image", data: "AAAA", mimeType: "image/png" }], attribution: "user" }),
  msg(2, { role: "developer", content: [{ type: "text", text: "dev rules" }], attribution: "agent" }),
  msg(3, { role: "user", content: [{ type: "text", text: "<system-reminder>injected</system-reminder>" }], attribution: "user" }),
  assistant(4, [
    { type: "thinking", thinking: "private chain", thinkingSignature: "sig" },
    { type: "text", text: "Đọc board trước." },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "C:\\w\\app\\STATE.md", i: "Reading state" }, intent: "Reading state" },
    { type: "toolCall", id: "t2", name: "bash", arguments: { command: `curl -H "Authorization: Bearer ${FAKE_SECRET}" https://api.github.com`, cwd: "C:\\w", i: "Checking open PRs" }, intent: "Checking open PRs" },
  ]),
  result(5, "t1", "read", "ok"),
  result(6, "t2", "bash", "exit 22: 401 Unauthorized", true),
  assistant(7, [{ type: "toolCall", id: "t3", name: "bash", arguments: { command: `GH_TOKEN=${FAKE_SECRET} gh pr list` } }]),
  assistant(8, [{ type: "toolCall", id: "t4", name: "eval", arguments: { language: "py", code: `print("${FAKE_SECRET}")`, title: "Tính tổng" }, intent: "Tính tổng" }]),
  assistant(9, [{ type: "toolCall", id: "t5", name: "task", arguments: { i: "Review diff", context: "x", tasks: [{ name: "Rev", agent: "reviewer", task: "y" }] }, intent: "Review diff" }]),
  JSON.stringify({ type: "custom_message", customType: "async-result", content: "job done", display: true, details: {}, attribution: "agent", id: "c", parentId: "b", timestamp: ts(10) }),
  msg(11, { role: "user", content: [{ type: "text", text: "bạn đề xuất nên hướng nào" }], steering: true, attribution: "user" }),
  "{not json",
];

describe("ompActivityFrom (omp session JSONL)", () => {
  it("turns prompts, replies, tool calls (closed by their results) and subagents into events", () => {
    const ev = ompActivityFrom(OMP);
    expect(ev.map((e) => [e.kind, e.tool ?? null, e.text, e.status ?? null])).toEqual([
      ["prompt", null, "check board [Image #1, 722x1568]", null],
      ["text", null, "Đọc board trước.", null],
      ["tool", "read", "Reading state", "ok"],
      ["tool", "bash", "Checking open PRs", "error"],
      ["tool", "bash", "gh", "pending"],
      ["tool", "eval", "Tính tổng", "pending"],
      ["agent", "reviewer", "Review diff", "pending"],
      ["prompt", null, "bạn đề xuất nên hướng nào", null],
    ]);
    expect(ev[3].error).toBe("exit 22: 401 Unauthorized");
    expect(ev[0].at).toBe(Date.parse(ts(1)));
  });

  it("never shows code, thinking, memory or injected text", () => {
    const all = JSON.stringify(ompActivityFrom(OMP));
    for (const s of [FAKE_SECRET, "Authorization", "gh pr list", "print(", "private chain", "secret memory", "dev rules", "injected", "job done"]) expect(all).not.toContain(s);
  });

  it("keeps the newest `limit` events", () => {
    const lines = Array.from({ length: 30 }, (_, i) => msg(i + 1, { role: "user", content: [{ type: "text", text: `p${i}` }] }));
    expect(ompActivityFrom(lines, 3).map((e) => e.text)).toEqual(["p27", "p28", "p29"]);
  });

  it("reads a transcript file and follows appends", () => {
    const dir = fs.mkdtempSync(path.join(tempHome(), "sd-"));
    const f = path.join(dir, "2026-10-20T15-00-00-000Z_x.jsonl");
    fs.writeFileSync(f, OMP.join("\n") + "\n");
    expect(readOmpActivity(f)).toHaveLength(8);
    fs.appendFileSync(f, msg(12, { role: "user", content: [{ type: "text", text: "update board" }] }) + "\n");
    expect(readOmpActivity(f).at(-1)?.text).toBe("update board");
    expect(readOmpActivity(path.join(dir, "missing.jsonl"))).toEqual([]);
  });
});

const lsOut = (rows: unknown[]) => ({ ok: true, stdout: JSON.stringify(rows), stderr: "" });
const ompRow = (o: Record<string, unknown>) => ({ engine: "omp", name: "core", repo: "C:\\w\\app", status: "running", last_active: Math.floor(Date.now() / 1000) - 600, model: "claude-opus-5-5", ...o });

describe("omp rooms on the floor and in Nhật ký", () => {
  let token = "";
  let file = "";
  beforeAll(() => {
    const home = tempHome();
    token = getToken();
    file = path.join(home, "sd", "2026-10-20T15-00-00-000Z_x.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, OMP.join("\n") + "\n");
  });
  beforeEach(() => {
    resetFloorCache();
    run.mockReset();
    merged.mockReset();
    merged.mockResolvedValue([]);
  });

  it("a session with an open omp process is a room (with its model) even when its transcript is quiet; closed ones are not", async () => {
    run.mockResolvedValue(
      lsOut([
        ompRow({ inbox_id: ROOM, transcript: file }),
        ompRow({ name: "active", inbox_id: "omp-0000000000000001", status: "active" }),
        ompRow({ name: "old", inbox_id: "omp-0000000000000002", status: "idle", last_active: 1 }),
        ompRow({ name: "noid", inbox_id: null }),
      ]),
    );
    const db = getDb();
    const rooms = ompSessions(db, await loadFloor(db));
    expect(rooms.map((r) => [r.label, r.name, r.model])).toEqual([
      ["core", ROOM, "claude-opus-5-5"],
      ["active", "omp-0000000000000001", "claude-opus-5-5"],
    ]);
  });

  it("GET activity reads an omp room's transcript from `8sync ls`, never a path from the client", async () => {
    run.mockResolvedValue(lsOut([ompRow({ inbox_id: ROOM, transcript: file }), ompRow({ name: "rel", inbox_id: "omp-0000000000000003", transcript: "sd/x.jsonl" })]));
    const params = (name: string) => ({ params: Promise.resolve({ name }) }) as never;
    const get = (name: string, q = "") => GET(req(`/api/sessions/${name}/activity${q}`, { token, origin: ORIGIN }), params(name));
    const events = async (name: string, q = "") => {
      const body: { events: { kind: string; text: string }[] } = await (await get(name, q)).json();
      return body.events;
    };

    expect((await get(ROOM)).status).toBe(200);
    const ev = await events(ROOM, "?limit=2");
    expect(ev.map((e) => [e.kind, e.text])).toEqual([
      ["agent", "Review diff"],
      ["prompt", "bạn đề xuất nên hướng nào"],
    ]);
    expect(JSON.stringify(ev)).not.toContain(FAKE_SECRET);

    // Unknown room, or a row whose transcript is not an absolute .jsonl: nothing read.
    expect(await events("omp-00000000000000ff")).toEqual([]);
    expect(await events("omp-0000000000000003")).toEqual([]);
    expect((await get("omp-..%2F..%2Fetc")).status).toBe(422);
    expect((await get(encodeURIComponent(file))).status).toBe(422);
  });
});
