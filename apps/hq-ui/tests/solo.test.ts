import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ rooms: [] as Record<string, unknown>[] }));
vi.mock("@/lib/server/proc", async (orig) => ({ ...(await orig<typeof import("@/lib/server/proc")>()), mergedSessions: async () => live.rooms }));
const sent = vi.hoisted(() => ({ calls: [] as { session: string; text: string }[], waiting: false }));
vi.mock("@/lib/server/deliver", async () => {
  // vi.mock factories run before the file's imports: the real class (the route checks instanceof) comes in here.
  const { SessionWaiting } = await import("@/lib/server/channel");
  return {
    deliverText: async (_db: unknown, session: string, text: string) => {
      if (sent.waiting) throw new SessionWaiting("permission prompt");
      sent.calls.push({ session, text });
      return { message: { id: 1 }, delivery: "terminal", error: null };
    },
  };
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST } from "@/app/api/solo/route";
import { SoloCard } from "@/components/hq/solo-card";
import { answerLine } from "@/lib/ask";
import { getToken } from "@/lib/server/auth";
import { readSolo } from "@/lib/server/solo";
import { criticIn, parseSoloMd, soloActive, soloMessage, soloOptions, soloState } from "@/lib/solo";
import { ORIGIN, req, tempHome } from "./helpers";

const T0 = Date.parse("2026-11-01T10:00:00Z");
const MD = [
  "Status: waiting",
  "Item: #41 retry cho webhook",
  "Question: Ship bản vá webhook bây giờ hay gộp với #42?",
  "Updated: 2026-11-01T10:00:00Z",
  "Deadline: 2026-11-01T10:20:00Z",
  "Options: Ship ngay | Gộp với #42",
  "",
  "- 2026-11-01T09:00:00Z item picked #40",
  '- 2026-11-01T09:10:00Z asked "Dùng Postgres hay SQLite?" options: Postgres (Recommended) | SQLite',
  '- 2026-11-01T09:30:00Z critic chose "Postgres": đã có pgvector trong stack',
  "- 2026-11-01T09:40:00Z PR #12 merged",
  "- 2026-11-01T09:41:00Z released v0.4.1",
  '- 2026-11-01T10:00:00Z asked "Ship bản vá webhook bây giờ hay gộp với #42?" options: Ship ngay (Recommended) | Gộp với #42',
].join("\n");

describe("parseSoloMd", () => {
  it("header (any order, CRLF) and the log, critic picks paired with the question they answered", () => {
    const s = parseSoloMd(MD.replace(/\n/g, "\r\n"))!;
    expect(s).toMatchObject({
      status: "waiting",
      item: "#41 retry cho webhook",
      question: "Ship bản vá webhook bây giờ hay gộp với #42?",
      options: ["Ship ngay", "Gộp với #42"],
      updated: T0,
      deadline: T0 + 20 * 60_000,
    });
    expect(s.log.map((l) => l.kind)).toEqual(["event", "asked", "critic", "event", "event", "asked"]);
    expect(s.log[2]).toMatchObject({ kind: "critic", label: "Postgres", reason: "đã có pgvector trong stack", question: "Dùng Postgres hay SQLite?", options: ["Postgres", "SQLite"] });
    expect(s.log[3]).toMatchObject({ text: "PR #12 merged", at: Date.parse("2026-11-01T09:40:00Z") });
  });

  it("no Options header: the last asked line carries them; '-' means none; no Status is not a SOLO.md", () => {
    const s = parseSoloMd(MD.replace("Options: Ship ngay | Gộp với #42", "Options: -"))!;
    expect(s.options).toEqual(["Ship ngay", "Gộp với #42"]);
    expect(parseSoloMd("Status: running\nItem: -\nQuestion: -\nDeadline: -\n")).toMatchObject({ status: "running", item: null, question: null, deadline: null, options: [], log: [] });
    expect(parseSoloMd("# notes\nItem: x\n")).toBeNull();
    expect(parseSoloMd("")).toBeNull();
    expect(parseSoloMd("Status: bogus\n")?.status).toBe("stopped");
  });

  it("text is masked: a log line may quote a secret", () => {
    const s = parseSoloMd(`Status: running\n\n- 2026-11-01T10:00:00Z ran psql --password ${"hunter"}2 -h db\n`)!;
    expect(s.log[0].text).toContain("--password ***");
    expect(s.log[0].text).not.toContain("hunter" + "2");
  });

  it("soloOptions drops the (Recommended) suffix and blanks", () => {
    expect(soloOptions("A (Recommended) | B |  | -")).toEqual(["A", "B"]);
    expect(soloOptions(null)).toEqual([]);
  });
});

describe("solo state, messages, countdown", () => {
  it("ACTIVE: `solo` on its own line; off the list a waiting file reads as stopped", () => {
    expect(soloActive("ship-x\nsolo\n")).toBe(true);
    expect(soloActive("solo-old\nsolos")).toBe(false);
    expect(soloActive(null)).toBe(false);
    const s = parseSoloMd(MD)!;
    expect(soloState(s, true)).toBe("waiting");
    expect(soloState(s, false)).toBe("stopped");
    expect(soloState(null, true)).toBe("stopped");
  });

  it("messages: /solo (told to read the skill through an inbox), dừng, solo: <answer>, solo: override <label>", () => {
    expect(soloMessage("start", "", "terminal")).toBe("/solo");
    expect(soloMessage("start", "", "inbox")).toMatch(/^\/solo\n.*~\/\.claude\/skills\/solo\/SKILL\.md/);
    expect(soloMessage("stop", "", "inbox")).toBe("dừng");
    expect(soloMessage("answer", "Ship ngay", "terminal")).toBe("solo: Ship ngay");
    expect(soloMessage("override", "SQLite", "inbox")).toBe("solo: override SQLite");
  });

  it("answerLine: one trimmed line, no control characters, at most 500", () => {
    expect(answerLine("  a\n b\t")).toBe("a b");
    expect(answerLine("x\u0007")).toBeNull();
    expect(answerLine("x".repeat(501))).toBeNull();
    expect(answerLine("   ")).toBeNull();
    expect(answerLine(5)).toBeNull();
  });

  it("criticIn: minutes, hours, nothing once passed", () => {
    expect(criticIn(T0 + 20 * 60_000, T0)).toBe("Critic sẽ chọn sau 20 phút");
    expect(criticIn(T0 + 30_000, T0)).toBe("Critic sẽ chọn sau 1 phút");
    expect(criticIn(T0 + 90 * 60_000, T0)).toBe("Critic sẽ chọn sau 1 giờ 30 phút");
    expect(criticIn(T0 + 120 * 60_000, T0)).toBe("Critic sẽ chọn sau 2 giờ");
    expect(criticIn(T0 - 1, T0)).toBeNull();
    expect(criticIn(null, T0)).toBeNull();
  });
});

describe("SoloCard", () => {
  const s = parseSoloMd(MD)!;
  const room = (name: string, last: number, engine = "ccc") => ({ key: name, name, label: name, status: "idle", engine, last_active: last, project: { root: "/w/shop", name: "shop", branch: "main" } });
  const render = (state: "waiting" | "stopped", rooms: unknown[]) =>
    renderToStaticMarkup(
      createElement(SoloCard, { root: "/w/shop", name: "shop", solo: { root: "/w/shop", name: "shop", state, active: state !== "stopped", solo: s }, rooms: rooms as never, token: "t", now: T0 }),
    );

  it("waiting: the question with the recommended option first, the countdown, the Critic's pick with Đổi, Dừng Solo into the newest room", () => {
    const html = render("waiting", [room("old", 1), room("new", 2), room("omp-x", 3, "omp")]);
    expect(html).toContain("Chờ anh chọn");
    expect(html).toContain("Ship bản vá webhook bây giờ hay gộp với #42?");
    expect(html).toMatch(/Ship ngay.*đề xuất/);
    expect(html).toContain("Critic sẽ chọn sau 20 phút");
    expect(html).toContain("Critic chọn");
    expect(html).toContain("đã có pgvector trong stack");
    expect(html).toContain("Đổi");
    expect(html).toContain("Dừng Solo");
    expect(html).toContain("Gửi vào phiên new");
    expect(html).not.toContain("omp-x");
  });

  it("stopped: Bật Solo, no override; no Claude Code room: the button is off and says why", () => {
    const html = render("stopped", [room("new", 2)]);
    expect(html).toContain("Bật Solo");
    expect(html).not.toContain("Đổi");
    expect(html).not.toContain("Critic sẽ chọn");
    const none = render("stopped", [room("omp-x", 3, "omp")]);
    expect(none).toContain("Mở một phiên Claude Code trong shop để bật Solo.");
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>.*?Bật Solo/);
  });
});

function repo(prefix: string): string {
  const root = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  return root;
}

describe("readSolo + POST /api/solo", () => {
  let root = "";
  let other = "";
  let token = "";
  const ship = () => path.join(root, "su-code", "ship");
  beforeAll(() => {
    tempHome();
    token = getToken();
    root = repo("hq-solo-");
    other = repo("hq-solo-other-");
    fs.mkdirSync(path.join(ship(), "solo"), { recursive: true });
  });
  beforeEach(() => {
    fs.writeFileSync(path.join(ship(), "solo", "SOLO.md"), MD);
    fs.writeFileSync(path.join(ship(), "ACTIVE"), "solo\n");
    sent.calls = [];
    sent.waiting = false;
    live.rooms = [
      { name: "dev", session_id: "3698e3a6-9b73-4b37-ab3a-368b169d0508", cwd: root, status: "running", tmux: true },
      { name: "omp-0123456789abcdef", session_id: null, cwd: root, status: "running", tmux: false, engine: "omp" },
      { name: "far", session_id: "9f0e3a6b-9b73-4b37-ab3a-368b169d0508", cwd: other, status: "running", tmux: true },
    ];
  });
  const post = (body: unknown, t: string | null = token) => POST(req("/api/solo", { method: "POST", token: t, origin: ORIGIN, body }));

  it("readSolo: the file and the ACTIVE line; null where /solo never ran; a big log keeps its header", () => {
    expect(readSolo(root)).toMatchObject({ root, state: "waiting", active: true, solo: { question: "Ship bản vá webhook bây giờ hay gộp với #42?" } });
    expect(readSolo(other)).toBeNull();
    const filler = Array.from({ length: 900 }, (_, i) => `- 2026-11-01T09:00:00Z step ${i} ${"x".repeat(40)}`).join("\n");
    fs.writeFileSync(path.join(ship(), "solo", "SOLO.md"), `${MD.split("\n\n")[0]}\n\n${filler}\n- 2026-11-01T10:00:00Z released v9`);
    const big = readSolo(root)!;
    expect(big.solo).toMatchObject({ status: "waiting", options: ["Ship ngay", "Gộp với #42"] });
    expect(big.solo!.log.at(-1)!.text).toBe("released v9");
    fs.writeFileSync(path.join(ship(), "ACTIVE"), "ship-x\n");
    expect(readSolo(root)?.state).toBe("stopped");
  });

  it("start / answer / override / stop go to the picked Claude Code room of that project, text built here", async () => {
    expect((await post({ root, session: "dev", action: "start" })).status).toBe(201);
    expect((await post({ root: root.toUpperCase(), session: "3698e3a6-9b73-4b37-ab3a-368b169d0508", action: "answer", answer: " Ship ngay " })).status).toBe(201);
    expect((await post({ root, session: "dev", action: "override", answer: "SQLite" })).status).toBe(201);
    expect((await post({ root, session: "dev", action: "stop" })).status).toBe(201);
    expect(sent.calls).toEqual([
      { session: "dev", text: "/solo" },
      { session: "dev", text: "solo: Ship ngay" },
      { session: "dev", text: "solo: override SQLite" },
      { session: "dev", text: "dừng" },
    ]);
  });

  it("refuses: no token, bad body, unknown project, a room of another project, an omp room, an answer when nothing waits", async () => {
    expect((await post({ root, session: "dev", action: "start" }, null)).status).toBe(401);
    expect((await post({ root, session: "dev", action: "rm" })).status).toBe(422);
    expect((await post({ root, session: "dev", action: "answer", answer: "a\u0003" })).status).toBe(422);
    expect((await post({ root, action: "start" })).status).toBe(422);
    expect((await post({ session: "dev", action: "start" })).status).toBe(422);
    expect((await post({ root: path.join(os.tmpdir(), "nope"), session: "dev", action: "start" })).status).toBe(409);
    expect((await post({ root, session: "far", action: "start" })).status).toBe(404);
    expect((await post({ root, session: "omp-0123456789abcdef", action: "start" })).status).toBe(404);
    fs.writeFileSync(path.join(ship(), "solo", "SOLO.md"), MD.replace("Status: waiting", "Status: running"));
    expect((await post({ root, session: "dev", action: "answer", answer: "Ship ngay" })).status).toBe(409);
    expect(sent.calls).toEqual([]);
  });

  it("a room stopped on a dialog: 409 session-waiting, nothing typed", async () => {
    sent.waiting = true;
    const res = await post({ root, session: "dev", action: "stop" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("session-waiting");
  });
});
