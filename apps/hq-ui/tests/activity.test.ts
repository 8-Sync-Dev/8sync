import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { activityFrom, readActivity, toolSummary } from "@/lib/server/activity";

const SID = "04d7c8d5-7473-44e7-bab9-0606b4db5a01";
// Fake, but shaped like a real token: it must never reach the log.
// Built at runtime so secret scanners do not flag the fixture itself.
const FAKE_SECRET = ["gh", "p_", "FAKE".repeat(9)].join("");

const at = (s: number) => `2026-10-17T15:00:${String(s).padStart(2, "0")}.000Z`;
const user = (content: unknown, s: number, extra: object = {}) => JSON.stringify({ type: "user", timestamp: at(s), message: { content }, ...extra });
const assistant = (content: unknown[], s: number) => JSON.stringify({ type: "assistant", timestamp: at(s), message: { content } });

const FIXTURE = [
  JSON.stringify({ type: "summary", summary: "x" }),
  user("<command-name>/clear</command-name>", 0),
  user("caveat", 1, { isMeta: true }),
  user("Làm card #6: art bible", 2),
  "{not json",
  assistant([{ type: "text", text: "Đọc board trước." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/w/ai-game-studio/su-code/STATE.md" } }], 3),
  user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }], 4),
  assistant([{ type: "tool_use", id: "t2", name: "Bash", input: { command: `curl -H "Authorization: Bearer ${FAKE_SECRET}" https://api.github.com`, description: "Kiểm PR đang mở" } }], 5),
  user([{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "exit 22: 401 Unauthorized" }], 6),
  assistant([{ type: "tool_use", id: "t3", name: "Bash", input: { command: `GH_TOKEN=${FAKE_SECRET} gh pr list` } }], 7),
  assistant([{ type: "tool_use", id: "t4", name: "WebFetch", input: { url: `https://example.com/a?token=${FAKE_SECRET}` } }], 8),
  assistant([{ type: "tool_use", id: "t5", name: "Agent", input: { subagent_type: "researcher", description: "Tìm sprite 64px" } }], 9),
  assistant([{ type: "text", text: "x".repeat(900) }], 10),
];

describe("activityFrom", () => {
  it("turns a transcript into prompt, reply, tool and subagent lines, oldest first", () => {
    const ev = activityFrom(FIXTURE);
    expect(ev.map((e) => [e.kind, e.tool ?? null, e.text.slice(0, 40), e.status ?? null])).toEqual([
      ["prompt", null, "Làm card #6: art bible", null],
      ["text", null, "Đọc board trước.", null],
      ["tool", "Read", "/w/ai-game-studio/su-code/STATE.md", "ok"],
      ["tool", "Bash", "Kiểm PR đang mở", "error"],
      ["tool", "Bash", "gh", "pending"],
      ["tool", "WebFetch", "example.com", "pending"],
      ["agent", "researcher", "Tìm sprite 64px", "pending"],
      ["text", null, "x".repeat(40), null],
    ]);
    expect(ev[3].error).toBe("exit 22: 401 Unauthorized");
    expect(ev[0].at).toBe(Date.parse(at(2)));
    expect(ev[7].text.length).toBeLessThanOrEqual(400);
  });

  it("never shows a command line: only its description or the first word", () => {
    const all = JSON.stringify(activityFrom(FIXTURE));
    expect(all).not.toContain(FAKE_SECRET);
    expect(all).not.toContain("Authorization");
    expect(all).not.toContain("gh pr list");
    expect(toolSummary("Bash", { command: "/usr/bin/git push --force origin main" })).toBe("git");
    expect(toolSummary("PowerShell", { command: `"C:\\Program Files\\x.exe" -k ${FAKE_SECRET}` })).not.toContain(FAKE_SECRET);
  });

  it("keeps the newest `limit` events", () => {
    const lines = Array.from({ length: 30 }, (_, i) => user(`prompt ${i}`, i));
    expect(activityFrom(lines, 5).map((e) => e.text)).toEqual(["prompt 25", "prompt 26", "prompt 27", "prompt 28", "prompt 29"]);
  });
});

describe("readActivity", () => {
  it("reads the transcript of a session and caches by size and mtime", async () => {
    const { tempHome } = await import("./helpers");
    const home = tempHome();
    const dir = path.join(home, ".claude", "projects", "C--w-game");
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${SID}.jsonl`);
    fs.writeFileSync(f, FIXTURE.join("\n") + "\n");
    const root = path.join(home, ".claude");
    const a = readActivity(SID, "C:\\w\\game", 80, root);
    expect(a).toHaveLength(8);
    expect(readActivity(SID, "C:\\w\\game", 80, root)).toBe(a);
    fs.appendFileSync(f, user("thêm việc", 20) + "\n");
    expect(readActivity(SID, "C:\\w\\game", 80, root).at(-1)?.text).toBe("thêm việc");
    expect(readActivity("not-a-session", null, 80, root)).toEqual([]);
  });
});

describe("GET /api/sessions/[name]/activity", () => {
  const params = (name: string) => ({ params: Promise.resolve({ name }) }) as never;

  it("needs the HQ token", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/sessions/[name]/activity/route");
    const { ORIGIN, req, tempHome } = await import("./helpers");
    tempHome();
    const res = await GET(req(`/api/sessions/${SID}/activity`, { origin: ORIGIN }), params(SID));
    expect(res.status).toBe(401);
  });

  it("refuses a name that is not a session id, and answers events for one", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/sessions/[name]/activity/route");
    const { getToken } = await import("@/lib/server/auth");
    const { ORIGIN, req, tempHome } = await import("./helpers");
    const home = tempHome();
    process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
    try {
      const bad = await GET(req("/api/sessions/hq-x/activity", { token: getToken(), origin: ORIGIN }), params("../../etc"));
      expect(bad.status).toBe(422);
      const dir = path.join(home, ".claude", "projects", "x");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${SID}.jsonl`), FIXTURE.join("\n"));
      const ok = await GET(req(`/api/sessions/${SID}/activity?limit=2`, { token: getToken(), origin: ORIGIN }), params(SID));
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { events: { kind: string }[] };
      expect(body.events.map((e) => e.kind)).toEqual(["agent", "text"]);
      expect(JSON.stringify(body)).not.toContain(FAKE_SECRET);
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  });
});

describe("Nhật ký UI", () => {
  it("one line per event, errors expandable, empty state", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { LogLines } = await import("@/components/hq/room-log");
    const ev = activityFrom(FIXTURE);
    const html = renderToStaticMarkup(createElement(LogLines, { events: ev, now: Date.parse(at(30)) }));
    for (const s of ["Làm card #6", "Read: /w/ai-game-studio/su-code/STATE.md", "Bash: Kiểm PR đang mở", "401 Unauthorized", "<details", "researcher: Tìm sprite 64px", "đang chạy", "28s", 'aria-label="Nhật ký phòng, mới nhất ở cuối"'])
      expect(html).toContain(s);
    expect(html).not.toContain(FAKE_SECRET);
    expect(renderToStaticMarkup(createElement(LogLines, { events: [], now: 0 }))).toContain("Chưa có gì trong nhật ký");
  });
});
