import { EventEmitter } from "node:events";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ask } from "@/lib/ask";

const SID = "3698e3a6-9b73-4b37-ab3a-368b169d0508";

/** A fake `8sync ccc term` bridge: prints ConPTY's cursor query, then `screen`, and records stdin. */
const bridge = vi.hoisted(() => ({ screen: "", writes: [] as string[], spawned: [] as unknown[][], killed: 0 }));
const fakeSpawn = vi.hoisted(() =>
  vi.fn((...args: unknown[]) => {
    bridge.spawned.push(args);
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: Object.assign(new EventEmitter(), { resume: () => {} }),
      stdin: { destroyed: false, write: (s: string) => bridge.writes.push(s), end: () => {} },
      kill: () => {
        bridge.killed++;
      },
    });
    setTimeout(() => proc.stdout.emit("data", Buffer.from("\x1b[6n")), 5);
    setTimeout(() => proc.stdout.emit("data", Buffer.from(bridge.screen)), 15);
    return proc;
  }),
);
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawn: fakeSpawn }));
const ask = vi.hoisted(() => ({ value: null as Ask | null }));
vi.mock("@/lib/server/ask", async (orig) => ({ ...(await orig<typeof import("@/lib/server/ask")>()), readAsk: () => ask.value }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [{ name: "dev", session_id: "3698e3a6-9b73-4b37-ab3a-368b169d0508", cwd: "/w/game", status: "needs_input", tmux: false }],
}));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST } from "@/app/api/sessions/[name]/answer/route";
import { AskPanel, oneTapKind, type AskRoom } from "@/components/hq/ask-panel";
import { permissionOnScreen, questionOnScreen, renderScreen } from "@/lib/screen";
import { CURSOR_REPLY, TIMING, keysFit } from "@/lib/server/answer";
import { getToken } from "@/lib/server/auth";
import { ORIGIN, req, tempHome } from "./helpers";

/** Rows drawn the way ConPTY does: absolute moves, colours, a cursor-forward for a run of spaces. */
const draw = (rows: string[]) => `\x1b[?25l\x1b[2J\x1b]0;claude\x07${rows.map((r, i) => `\x1b[${i + 3};1H\x1b[38;5;246m${r.replace("   ", "\x1b[3C")}\x1b[0m\x1b[K`).join("")}`;
const PERMISSION = [
  "╭──────────────────────────────────────────────╮",
  "│ Bash command                                 │",
  "│   pnpm vite preview --port 4173 --strictPort │",
  "│   Start the preview for UAT screenshots      │",
  "│                                              │",
  "│ Do you want to proceed?                      │",
  "│ ❯ 1. Yes                                     │",
  "│   2. Yes, and don't ask again for pnpm vite  │",
  "│   3. No, and tell Claude what to do (esc)    │",
  "╰──────────────────────────────────────────────╯",
];
const QUESTION = ["☐ Ship", "", "Merge card-46 vào main bây giờ hay đợi QA lần nữa?", "", "❯ 1. Merge ngay", "    Card đã qua QA và review", "  2. Đợi QA lần nữa", "  3. Type something."];
const ASK: Ask = {
  kind: "question",
  at: 1,
  questions: [{ header: "Ship", question: "Merge card-46 vào main bây giờ hay đợi QA lần nữa?", multi: false, options: [{ label: "Merge ngay", description: "Card đã qua QA và review" }, { label: "Đợi QA lần nữa", description: null }] }],
};

describe("renderScreen + dialog checks", () => {
  it("renders cursor moves, erases and colours to plain lines", () => {
    const lines = renderScreen("\x1b[2;3Hab\x1b[5Ccd\x1b[1;1Hzz\x1b[31mq\x1b[0m\rX\x1b]8;;http://x\x1b\\", 20, 4);
    expect(lines).toEqual(["Xzq", "  ab     cd", "", ""]);
    expect(renderScreen("hello\x1b[1;3H\x1b[K", 10, 1)).toEqual(["he"]);
  });

  it("finds the permission dialog with its exact command, and whether Enter means Yes", () => {
    const p = permissionOnScreen(renderScreen(draw(PERMISSION)));
    expect(p?.yes).toBe(true);
    expect(p?.text).toContain("pnpm vite preview --port 4173 --strictPort");
    expect(p?.text).toContain("Do you want to proceed?");
    const moved = PERMISSION.map((l) => l.replace("❯ 1. Yes", "  1. Yes").replace("  2. Yes,", "❯ 2. Yes,"));
    expect(permissionOnScreen(renderScreen(draw(moved)))?.yes).toBe(false);
    expect(permissionOnScreen(renderScreen(draw(["> ", "? for shortcuts"])))).toBeNull();
  });

  it("finds a question only while its text and every option show", () => {
    const lines = renderScreen(draw(QUESTION));
    const q = ASK.kind === "question" ? ASK.questions[0] : null;
    expect(questionOnScreen(lines, q!.question, ["Merge ngay", "Đợi QA lần nữa"])).toBe("Merge card-46 vào main bây giờ hay đợi QA lần nữa?");
    expect(questionOnScreen(lines, "Câu khác?", ["Merge ngay"])).toBeNull();
    expect(questionOnScreen(lines, q!.question, ["Merge ngay", "Bỏ card"])).toBeNull();
  });

  it("keys: an allowlist, and only what fits the dialog", () => {
    const perm = { kind: "permission" } as const;
    const quest = { kind: "question", question: "q", options: ["a", "b"] } as const;
    expect(keysFit(["\r"], perm)).toBe(true);
    expect(keysFit(["\u001b"], perm)).toBe(true);
    expect(keysFit(["1", "\r"], perm)).toBe(false);
    expect(keysFit(["2", "\r"], quest)).toBe(true);
    expect(keysFit(["3", "\r"], quest)).toBe(false);
    expect(keysFit(["\r"], quest)).toBe(false);
    for (const bad of [["y"], ["\u0003"], ["\r\n"], ["rm -rf /\r"], ["1", "1"], []]) expect(keysFit(bad, quest)).toBe(false);
  });
});

describe("POST /api/sessions/:id/answer", () => {
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    // Real (shrunk) timers: the route awaits the fake bridge's output events; tens of ms per call.
    Object.assign(TIMING, { settleMin: 40, quiet: 10, settleMax: 300, keyGap: 5, afterKeys: 10, deadline: 2000 });
  });
  beforeEach(() => {
    bridge.writes = [];
    bridge.spawned = [];
    bridge.killed = 0;
    ask.value = null;
  });
  const post = (name: string, body: unknown, o: { token?: string | null; origin?: string | null } = {}) =>
    POST(req(`/api/sessions/${name}/answer`, { method: "POST", token: o.token === undefined ? token : o.token, origin: o.origin === undefined ? ORIGIN : o.origin, body }), {
      params: Promise.resolve({ name }),
    } as never);
  const typed = () => bridge.writes.map((w) => JSON.parse(w).i);

  it("refuses no token, a foreign or missing Origin, a bad session id, bad keys: nothing is spawned", async () => {
    const body = { kind: "permission", keys: ["\r"] };
    expect((await post(SID, body, { token: null })).status).toBe(401);
    expect((await post(SID, body, { origin: "http://evil.test" })).status).toBe(403);
    expect((await post(SID, body, { origin: null })).status).toBe(403);
    expect((await post("--help", body)).status).toBe(422);
    expect((await post("hq-dev", body)).status).toBe(422);
    expect((await post(SID, { kind: "permission", keys: ["y"] })).status).toBe(422);
    expect((await post(SID, { kind: "permission", keys: ["\r", "\r", "\r"] })).status).toBe(422);
    expect((await post(SID, { kind: "permission", keys: ["1", "\r"] })).status).toBe(422);
    expect((await post(SID, { kind: "bash", keys: [] })).status).toBe(422);
    expect(bridge.spawned).toEqual([]);
  });

  it("peek: reads the dialog through `8sync ccc term <id> --cols 120 --rows 34`, types only the cursor reply", async () => {
    bridge.screen = draw(PERMISSION);
    const res = await post(SID, { kind: "permission", keys: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dialog).toMatchObject({ kind: "permission", yes: true });
    expect(body.dialog.text).toContain("pnpm vite preview --port 4173 --strictPort");
    expect(bridge.spawned[0][0]).toBe("8sync");
    expect(bridge.spawned[0][1]).toEqual(["ccc", "term", SID, "--cols", "120", "--rows", "34"]);
    expect(typed()).toEqual([CURSOR_REPLY]);
    expect(bridge.killed).toBeGreaterThan(0);
  });

  it("Cho phép sends exactly Enter after the cursor reply; Từ chối exactly Esc", async () => {
    bridge.screen = draw(PERMISSION);
    expect((await post(SID, { kind: "permission", keys: ["\r"] })).status).toBe(200);
    expect(typed()).toEqual([CURSOR_REPLY, "\r"]);
    bridge.writes = [];
    expect((await post(SID, { kind: "permission", keys: ["\u001b"] })).status).toBe(200);
    expect(typed()).toEqual([CURSOR_REPLY, "\u001b"]);
  });

  it("409 when the screen no longer shows the dialog (or Yes is not highlighted): no key goes in", async () => {
    bridge.screen = draw(["> ", "? for shortcuts"]);
    const res = await post(SID, { kind: "permission", keys: ["\r"] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("màn hình đã đổi, mở terminal");
    expect(typed()).toEqual([CURSOR_REPLY]);
    bridge.writes = [];
    bridge.screen = draw(PERMISSION.map((l) => l.replace("❯ 1. Yes", "  1. Yes").replace("  2. Yes,", "❯ 2. Yes,")));
    expect((await post(SID, { kind: "permission", keys: ["\r"] })).status).toBe(409);
    expect(typed()).toEqual([CURSOR_REPLY]);
  });

  it("a question option: its number then Enter, checked against the room's own transcript question", async () => {
    ask.value = ASK;
    bridge.screen = draw(QUESTION);
    expect((await post(SID, { kind: "question", keys: ["2", "\r"] })).status).toBe(200);
    expect(typed()).toEqual([CURSOR_REPLY, "2", "\r"]);
    bridge.writes = [];
    expect((await post(SID, { kind: "question", keys: ["3", "\r"] })).status).toBe(422);
    bridge.screen = draw(PERMISSION);
    expect((await post(SID, { kind: "question", keys: ["1", "\r"] })).status).toBe(409);
    expect(typed()).toEqual([CURSOR_REPLY]);
    ask.value = null;
    expect((await post(SID, { kind: "question", keys: ["1", "\r"] })).status).toBe(409);
  });
});

describe("Anh cần trả lời: one-tap buttons", () => {
  const room = (over: Partial<AskRoom>): AskRoom => ({ key: "k", label: "dev", session_id: SID, project: "3d-game", waiting: null, ask: null, tmux: false, ...over });

  it("only background rooms with a permission prompt or one single-choice question", () => {
    expect(oneTapKind(room({ waiting: "permission prompt" }))).toBe("permission");
    expect(oneTapKind(room({ ask: { kind: "permission", tool: "Bash", what: "ls", at: 1 } }))).toBe("permission");
    expect(oneTapKind(room({ ask: ASK }))).toBe("question");
    expect(oneTapKind(room({ ask: ASK, tmux: true }))).toBeNull();
    const multi: Ask = { ...ASK, questions: [{ ...(ASK as Extract<Ask, { kind: "question" }>).questions[0], multi: true }] };
    expect(oneTapKind(room({ ask: multi }))).toBeNull();
    expect(oneTapKind(room({ waiting: "Trust this folder?" }))).toBeNull();
  });

  it("renders Cho phép / Từ chối, and one button per option, disabled until the screen is read", () => {
    const html = renderToStaticMarkup(
      createElement(AskPanel, { rooms: [room({ key: "a", waiting: "permission prompt" }), room({ key: "b", label: "lead", ask: ASK })], now: 0, token: "t", onOpen: () => {} }),
    );
    expect(html).toContain("Cho phép");
    expect(html).toContain("Từ chối");
    expect(html).toContain("Merge ngay");
    expect(html).toContain("Đợi QA lần nữa");
    expect(html).toContain("Đang đọc màn hình của phòng");
    expect(html).toContain('aria-label="Trả lời nhanh cho lead"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Cho phép/);
  });
});
