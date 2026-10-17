import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { askLine, attachCommand, pendingAsk } from "@/lib/ask";
import { projectDirName, readAsk, transcriptOf } from "@/lib/server/ask";
import { terminalLaunchers } from "@/lib/server/attach";

const SID = "04d7c8d5-7473-44e7-bab9-0606b4db5a01";

// Claude Code writes every block of one assistant message as its own line, sharing `message.id`.
const assistant = (blocks: unknown[], ts = "2026-10-17T13:44:44.649Z", id?: string) =>
  JSON.stringify({ type: "assistant", timestamp: ts, message: { ...(id ? { id } : {}), content: blocks } });
const result = (id: string) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
// The shape Claude Code 2.1.296 wrote for the game lead's Ship question (UAT 2026-10-17).
const shipAsk = (id = "toolu_ship") => ({
  type: "tool_use",
  id,
  name: "AskUserQuestion",
  input: {
    questions: [
      {
        header: "Ship",
        question: "Ship: merge PR 2 (card #4) bằng squash vào main?",
        multiSelect: false,
        options: [
          { label: "Duyệt tất cả (Recommended)", description: "gh pr merge 2 --squash" },
          { label: "Chỉ merge, chưa deploy", description: "Giống trên" },
          { label: "Dừng", description: "Giữ card #4 ở approved" },
        ],
      },
      { header: "iOS", question: "iOS cho v1: có chi Apple Developer Program?", multiSelect: false, options: [{ label: "Chưa, để sau v1 (Recommended)" }] },
    ],
  },
});

describe("pendingAsk", () => {
  it("shows an open AskUserQuestion with every question and option", () => {
    const a = pendingAsk([result("toolu_old"), assistant([shipAsk()]), JSON.stringify({ type: "attachment" }), JSON.stringify({ type: "last-prompt" })]);
    expect(a?.kind).toBe("question");
    if (a?.kind !== "question") return;
    expect(a.questions.map((q) => q.header)).toEqual(["Ship", "iOS"]);
    expect(a.questions[0].options.map((o) => o.label)).toEqual(["Duyệt tất cả (Recommended)", "Chỉ merge, chưa deploy", "Dừng"]);
    expect(a.questions[1].options[0].description).toBeNull();
    expect(a.at).toBe(Date.parse("2026-10-17T13:44:44.649Z"));
    expect(askLine(a)).toBe("Ship: Ship: merge PR 2 (card #4) bằng squash vào main?");
  });

  it("is null once the question has its answer (the session moved on)", () => {
    expect(pendingAsk([assistant([shipAsk()]), result("toolu_ship"), assistant([{ type: "text", text: "merging" }])])).toBeNull();
    expect(pendingAsk([assistant([shipAsk()]), result("toolu_ship"), assistant([{ type: "tool_use", id: "t2", name: "Bash", input: {} }]), result("t2")])).toBeNull();
  });

  it("names a permission prompt by its description, never the raw command", () => {
    const a = pendingAsk([assistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "curl -H 'Authorization: Bearer abc123' x", description: "Merge the release PR" } }])]);
    expect(a).toMatchObject({ kind: "permission", tool: "Bash", what: "Merge the release PR" });
    expect(JSON.stringify(a)).not.toContain("abc123");
    expect(askLine(a)).toBe("Xin quyền chạy lệnh: Merge the release PR");
    const web = pendingAsk([assistant([{ type: "tool_use", id: "t3", name: "WebFetch", input: { url: "https://example.com/a?token=s3cret" } }])]);
    expect(web).toMatchObject({ what: "example.com" });
    expect(JSON.stringify(web)).not.toContain("s3cret");
  });

  it("prefers the AskUserQuestion among parallel open calls, and skips a cut first line", () => {
    const lines = ['_use","id":"x"}]}}', assistant([shipAsk("q1")], undefined, "msg_1"), assistant([{ type: "tool_use", id: "b1", name: "Bash", input: { description: "list" } }], undefined, "msg_1")];
    expect(pendingAsk(lines)?.kind).toBe("question");
  });

  it("finds an open question even when a sibling call of the same message already has its result", () => {
    const lines = [assistant([shipAsk("q1")], undefined, "msg_1"), assistant([{ type: "tool_use", id: "b1", name: "Bash", input: {} }], undefined, "msg_1"), result("b1")];
    expect(pendingAsk(lines)?.kind).toBe("question");
  });

  it("ignores a call left open by a crash or resume", () => {
    const bash = { type: "tool_use", id: "b9", name: "Bash", input: { description: "now" } };
    // An older message's open question is not what a newer permission prompt waits on.
    expect(pendingAsk([assistant([shipAsk("old")], undefined, "msg_1"), assistant([bash], undefined, "msg_2")])).toMatchObject({ kind: "permission", what: "now" });
    // A typed prompt after it.
    expect(pendingAsk([assistant([shipAsk()], undefined, "msg_1"), JSON.stringify({ type: "user", message: { content: "tiếp tục đi" } })])).toBeNull();
    expect(pendingAsk([assistant([shipAsk()], undefined, "msg_1"), JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "go" }] } })])).toBeNull();
    // The model wrote on in a newer message.
    expect(pendingAsk([assistant([shipAsk()], undefined, "msg_1"), assistant([{ type: "text", text: "moving on" }], undefined, "msg_2")])).toBeNull();
    // Its own text in the same message does not count; injected meta lines are skipped.
    expect(pendingAsk([assistant([{ type: "text", text: "asking" }], undefined, "msg_1"), assistant([shipAsk()], undefined, "msg_1"), JSON.stringify({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "skill body" }] } })])?.kind).toBe("question");
  });

  it("caps long text", () => {
    const long = { ...shipAsk(), input: { questions: [{ question: "x".repeat(5000), options: [] }] } };
    const a = pendingAsk([assistant([long])]);
    expect(a?.kind === "question" && a.questions[0].question.length).toBe(600);
  });
});

describe("transcript on disk", () => {
  let root = "";
  const cwd = "C:\\Users\\Projects\\startup\\8sync-startup\\game\\ai-game-studio";
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-ask-"));
    const dir = path.join(root, "projects", projectDirName(cwd));
    fs.mkdirSync(dir, { recursive: true });
    // Big enough that only the tail is read: the first line in the window is cut mid-way.
    const filler = Array.from({ length: 2000 }, (_, i) => assistant([{ type: "text", text: `${i} ${"y".repeat(400)}` }]));
    fs.writeFileSync(path.join(dir, `${SID}.jsonl`), [...filler, assistant([shipAsk()])].join("\n") + "\n");
  });

  it("uses Claude Code's folder name for the cwd", () => {
    expect(projectDirName(cwd)).toBe("C--Users-Projects-startup-8sync-startup-game-ai-game-studio");
    expect(projectDirName("/home/me/.x/repo")).toBe("-home-me--x-repo");
  });

  it("finds the transcript from the cwd, or in any project when the room moved", () => {
    expect(transcriptOf(SID, cwd, root)).toMatch(/ai-game-studio[\\/]04d7c8d5/);
    expect(transcriptOf("not-a-session", cwd, root)).toBeNull();
    expect(transcriptOf("11111111-2222-3333-4444-555555555555", cwd, root)).toBeNull();
  });

  it("reads the pending question from the file tail", () => {
    const a = readAsk(SID, `${cwd}\\.claude\\worktrees\\card-5`, root);
    expect(a?.kind).toBe("question");
  });
});

describe("attach", () => {
  it("is the short id claude attach takes", () => {
    expect(attachCommand(SID)).toBe("claude attach 04d7c8d5");
  });

  it("builds argv-only launchers per OS and refuses anything but 8 hex chars", () => {
    const win = terminalLaunchers("win32", "04d7c8d5");
    expect(win[0]).toEqual({ cmd: "cmd.exe", args: ["/d", "/c", "start", '""', "cmd.exe", "/k", "claude", "attach", "04d7c8d5"], verbatim: true });
    expect(terminalLaunchers("darwin", "04d7c8d5")[0].args[1]).toBe('tell application "Terminal" to do script "claude attach 04d7c8d5"');
    expect(terminalLaunchers("linux", "04d7c8d5").map((l) => l.cmd)).toContain("x-terminal-emulator");
    for (const bad of ["04d7c8d5 & calc", "04d7c8d", "\"; rm -rf /", "zzzzzzzz"]) expect(terminalLaunchers("win32", bad)).toEqual([]);
  });
});

describe("AskPanel markup", () => {
  it("shows the question, every option and both ways to answer; a tmux room opens its terminal instead", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { AskPanel } = await import("@/components/hq/ask-panel");
    const ask = pendingAsk([assistant([shipAsk()])]);
    const base = { key: SID, label: "lead", session_id: SID, project: "ai-game-studio", waiting: "input needed", ask, tmux: false };
    const html = renderToStaticMarkup(createElement(AskPanel, { rooms: [base], now: Date.parse("2026-10-17T15:44:44Z"), token: "t", onOpen: () => {} }));
    for (const s of ["Anh cần trả lời", "Ship: merge PR 2 (card #4) bằng squash vào main?", "Duyệt tất cả (Recommended)", "Dừng", "iOS", "Mở terminal để trả lời", "Chép lệnh", "claude attach 04d7c8d5"]) expect(html).toContain(s);
    expect(html).not.toContain("input needed");
    const tmux = renderToStaticMarkup(createElement(AskPanel, { rooms: [{ ...base, ask: null, tmux: true }], now: 0, token: "t", onOpen: () => {} }));
    expect(tmux).toContain("Mở phòng để trả lời");
    expect(tmux).toContain("input needed");
    expect(tmux).not.toContain("claude attach");
    expect(renderToStaticMarkup(createElement(AskPanel, { rooms: [], now: 0, token: "t", onOpen: () => {} }))).toBe("");
  });
});

describe("POST /api/sessions/[name]/attach", () => {
  it("refuses a name that is not a session id", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/sessions/[name]/attach/route");
    const { getToken } = await import("@/lib/server/auth");
    const { ORIGIN, req, tempHome } = await import("./helpers");
    tempHome();
    const res = await POST(req("/api/sessions/hq-x/attach", { method: "POST", token: getToken(), origin: ORIGIN }), { params: Promise.resolve({ name: "hq-x" }) } as never);
    expect(res.status).toBe(422);
  });
});
