import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendKeys = vi.hoisted(() => vi.fn<(session: string, text: string) => Promise<{ ok: boolean; stderr: string }>>(async () => ({ ok: true, stderr: "" })));
const merged = vi.hoisted(() => vi.fn());
const run = vi.hoisted(() => vi.fn(async () => ({ ok: false, stdout: "", stderr: "no 8sync in tests" })));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  sendKeys,
  run,
  mergedSessions: merged,
  capturePlain: async () => "❯ ",
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST as messagesPOST } from "@/app/api/messages/route";
import { GET as chiefGET, PUT as chiefPUT } from "@/app/api/chief/route";
import { GET as briefGET } from "@/app/api/brief/route";
import { getToken } from "@/lib/server/auth";
import { BRIEF_MAX, briefFrom, briefLength, editedFiles, findRoom, senderRoomOf, type Brief } from "@/lib/server/brief";
import { CHIEF_TEXT_MAX, chiefAsk, chiefPrompt, hqScript, normChief, readChief, rosterTable, writeChief } from "@/lib/server/chief";
import type { ActivityEvent, RoomLog } from "@/lib/server/activity";
import type { Room } from "@/lib/server/office";
import { contextLine, parseContextLine, stripContextLine, withContext } from "@/lib/room-context";
import { promptBody, turnsFrom } from "@/lib/room-turns";
import { ORIGIN, req, tempHome } from "./helpers";

const room = (o: Partial<Room> = {}): Room => ({
  key: "hq-core",
  name: "hq-core",
  session_id: "5d1c9f2e-1a2b-4c3d-8e9f-0123456789ab",
  label: "core",
  status: "running",
  waiting: null,
  ask: null,
  cwd: "/r/su-code",
  project: { root: "/r/su-code", name: "su-code", branch: "main" },
  delivery: "terminal",
  pending: 0,
  inboxLive: false,
  doing: "Sửa nút Giao",
  state: null,
  last_active: 1000,
  tokens: null,
  model: null,
  usage: null,
  seats: [],
  role: null,
  engine: "ccc",
  ...o,
});

const brief = (o: Partial<Brief> = {}): Brief => ({
  id: "hq-core",
  session_id: null,
  label: "core",
  engine: "claude",
  project: { root: "/r/su-code", name: "su-code", branch: "main" },
  cwd: "/r/su-code",
  status: "running",
  doing: "Sửa nút Giao",
  waiting: null,
  lastAsk: null,
  lastReply: null,
  files: [],
  updatedAt: null,
  ...o,
});

const log = (events: ActivityEvent[]): RoomLog => ({ events, turns: turnsFrom(events), rev: "1" });

describe("context line", () => {
  it("formats and parses back", () => {
    const line = contextLine({ label: "web", project: "su-code", doing: "sửa nút Giao" });
    expect(line).toBe("[từ phòng web · su-code · đang: sửa nút Giao]");
    expect(parseContextLine(line!)).toEqual({ label: "web", project: "su-code", doing: "sửa nút Giao" });
    expect(contextLine({ label: "su-code", project: "su-code", doing: null }), "project = label: said once").toBe("[từ phòng su-code]");
    expect(parseContextLine("[từ phòng web · đang: test]")).toEqual({ label: "web", project: null, doing: "test" });
    expect(parseContextLine("[phòng web]")).toBeNull();
    expect(contextLine({ label: " ", project: "x", doing: "y" })).toBeNull();
  });

  it("a field cannot close the line or start a new one", () => {
    const line = contextLine({ label: "web]\n[owner", project: "a · b", doing: "x".repeat(300) })!;
    expect(line.split("\n")).toHaveLength(1);
    expect(line.startsWith("[từ phòng web owner · a b · đang: ")).toBe(true);
    const c = parseContextLine(line)!;
    expect([...c.doing!].length).toBe(100);
    expect(c.doing!.endsWith("…")).toBe(true);
  });

  it("replaces the line a room typed itself, keeps the rest; promptBody drops HQ's frame and the line", () => {
    const c = { label: "web", project: "su-code", doing: "test" };
    expect(withContext("[từ phòng web] chạy test giúp", c)).toBe("[từ phòng web · su-code · đang: test]\nchạy test giúp");
    expect(withContext("[từ phòng cũ]\nviệc", c)).toBe("[từ phòng web · su-code · đang: test]\nviệc");
    expect(withContext("việc", null)).toBe("việc");
    expect(stripContextLine("việc [từ phòng x]")).toBe("việc [từ phòng x]");
    expect(promptBody("[phòng web → core · /r]\n[từ phòng web · su-code · đang: test]\nsửa nút")).toBe("sửa nút");
  });
});

describe("brief", () => {
  it("shape and budget from a transcript tail", () => {
    const events: ActivityEvent[] = [
      { kind: "prompt", at: 2000, text: `[owner → core · /r/su-code]\n${"làm tiếp phần brief ".repeat(30)}` },
      { kind: "tool", at: 2100, text: "/r/su-code/apps/hq-ui/lib/server/brief.ts", tool: "Edit", status: "ok" },
      { kind: "tool", at: 2200, text: "Chạy test", tool: "Bash", status: "ok" },
      { kind: "tool", at: 2300, text: "C:\\other\\repo\\x.rs", tool: "Write", status: "ok" },
      { kind: "tool", at: 2350, text: "/r/su-code/apps/hq-ui/lib/server/brief.ts", tool: "Edit", status: "ok" },
      { kind: "tool", at: 2360, text: "Sửa kiểu lỗi", tool: "edit", status: "ok" },
      { kind: "text", at: 2400, text: `Xong. ${"Kết quả dài. ".repeat(60)}` },
    ];
    const b = briefFrom(room({ status: "needs_input", ask: { kind: "question", questions: [{ header: null, question: "Chọn A hay B?", options: [], multi: false }], at: 1 } }), log(events));
    expect(b).toMatchObject({ id: "hq-core", label: "core", engine: "claude", status: "needs_input", doing: "Sửa nút Giao", waiting: "Chọn A hay B?", updatedAt: 2400 });
    expect(b.project).toEqual({ root: "/r/su-code", name: "su-code", branch: "main" });
    expect(b.lastAsk!.startsWith("làm tiếp phần brief")).toBe(true);
    expect(b.lastReply!.startsWith("Xong.")).toBe(true);
    expect(b.files, "outside the project: its last two parts").toEqual(["apps/hq-ui/lib/server/brief.ts", "repo/x.rs"]);
    expect(briefLength(b)).toBeLessThanOrEqual(BRIEF_MAX);
    expect(b.lastReply!.endsWith("…")).toBe(true);
  });

  it("every field at its cap still fits", () => {
    const long = "chữ ".repeat(400);
    const files = Array.from({ length: 6 }, (_, i): ActivityEvent => ({ kind: "tool", at: i, text: `/r/su-code/${"d".repeat(70)}/${i}.ts`, tool: "Edit", status: "ok" }));
    const b = briefFrom(
      room({ label: long, doing: long, waiting: long, project: { root: "/r/su-code", name: long, branch: long } }),
      log([{ kind: "prompt", at: 1, text: long }, ...files, { kind: "text", at: 9, text: long }]),
    );
    expect(briefLength(b)).toBeLessThanOrEqual(BRIEF_MAX);
    expect(b.files.length).toBeGreaterThanOrEqual(1);
  });

  it("no transcript: the office row alone; omp engine; idle needs nothing", () => {
    const b = briefFrom(room({ engine: "omp", name: "omp-0123456789abcdef", session_id: "omp-0123456789abcdef", status: "idle", doing: null, last_active: null }), null);
    expect(b).toMatchObject({ id: "omp-0123456789abcdef", engine: "omp", doing: null, waiting: null, lastAsk: null, lastReply: null, files: [], updatedAt: null });
  });

  it("edited files: only edit tools with a path, newest first, failed ones skipped", () => {
    const ev = (text: string, tool = "Edit", status: ActivityEvent["status"] = "ok"): ActivityEvent => ({ kind: "tool", at: 1, text, tool, status });
    expect(editedFiles([ev("/r/a.ts"), ev("/r/b.ts", "Read"), ev("/r/c.ts", "Edit", "error"), ev("Viết test"), ev("Adding app status/open subcommand", "edit"), ev("/r/d/e.ts")], "/r")).toEqual(["d/e.ts", "a.ts"]);
    expect(editedFiles([ev("lib/x.ts", "edit"), ev("README.md", "write")], "/r")).toEqual(["README.md", "lib/x.ts"]);
  });

  it("finds a room by address, session id, or a unique label; the sender by session, else its folder", () => {
    const rooms = [room(), room({ name: "hq-web", key: "hq-web", session_id: null, label: "web", cwd: "/r/shop" }), room({ name: "hq-web2", key: "hq-web2", session_id: null, label: "web", cwd: "/r/shop2" })];
    expect(findRoom(rooms, "hq-core")?.name).toBe("hq-core");
    expect(findRoom(rooms, "5d1c9f2e-1a2b-4c3d-8e9f-0123456789ab")?.name).toBe("hq-core");
    expect(findRoom(rooms, "CORE")?.name).toBe("hq-core");
    expect(findRoom(rooms, "web"), "two rooms called web").toBeUndefined();
    expect(senderRoomOf(rooms, { session: "5d1c9f2e-1a2b-4c3d-8e9f-0123456789ab" }, "hq-web")?.name).toBe("hq-core");
    expect(senderRoomOf(rooms, { cwd: "/r/shop/" }, "hq-core")?.name).toBe("hq-web");
    expect(senderRoomOf(rooms, { cwd: "/r/shop" }, "hq-web"), "never the recipient").toBeNull();
    expect(senderRoomOf(rooms, { cwd: "/nowhere" }, "hq-core")).toBeNull();
  });
});

describe("chief", () => {
  it("roster table: one line per room, the chief left out", () => {
    const t = rosterTable(
      [brief(), brief({ id: "omp-0123456789abcdef", label: "web | ui", project: null, status: "idle", doing: null, waiting: "Chọn A?" }), brief({ id: "hq-chief", label: "chief" })],
      "hq-chief",
    );
    expect(t).toBe(["- hq-core · core · su-code · running · Sửa nút Giao", "- omp-0123456789abcdef · web ui · - · idle (đang chờ owner) · -"].join("\n"));
    expect(rosterTable([brief({ id: "hq-chief" })], "hq-chief")).toBe("(không có phòng nào khác đang mở)");
  });

  it("prompt: owner's words, the rooms, the rule with the installed script; long lists cut to fit", () => {
    const script = hqScript("/home/me");
    expect(script).toBe("/home/me/.omp/skills/hq-control/scripts/hq.mjs");
    const p = chiefPrompt("sửa nút Giao", [brief()], "hq-chief", script);
    expect(p.startsWith("sửa nút Giao\n\nCác phòng đang mở")).toBe(true);
    expect(p).toContain("- hq-core · core · su-code · running · Sửa nút Giao");
    expect(p).toContain(`Bạn là Chief of Staff: chia việc cho đúng phòng bằng \`node ${script} send <room> …\`, theo dõi, kiểm kết quả, chỉ báo owner khi cần quyết.`);
    const many = Array.from({ length: 200 }, (_, i) => brief({ id: `hq-r${i}`, label: `r${i}`, doing: "x".repeat(80) }));
    const cut = chiefPrompt("a".repeat(CHIEF_TEXT_MAX), many, "hq-chief", script);
    expect([...cut].length).toBeLessThanOrEqual(4000);
    expect(cut).toContain(`node ${script} roster`);
    expect(cut.endsWith("chỉ báo owner khi cần quyết. Trước khi giao: `node /home/me/.omp/skills/hq-control/scripts/hq.mjs brief <room>`.")).toBe(true);
  });

  it("chief.json validation", () => {
    const sid = "5d1c9f2e-1a2b-4c3d-8e9f-0123456789ab";
    expect(normChief({ room: "hq-core" })).toEqual({ ok: true, value: { room: "hq-core", on: false } });
    expect(normChief({ room: sid, on: true })).toEqual({ ok: true, value: { room: sid, on: true } });
    expect(normChief({ room: "omp-0123456789abcdef" }, { room: null, on: true })).toEqual({ ok: true, value: { room: "omp-0123456789abcdef", on: true } });
    expect(normChief({ on: false }, { room: "hq-core", on: true })).toEqual({ ok: true, value: { room: "hq-core", on: false } });
    expect(normChief({ room: null }, { room: "hq-core", on: true }), "clearing the room turns it off").toEqual({ ok: true, value: { room: null, on: false } });
    for (const bad of [{ room: "../x" }, { room: 7 }, { room: "core; rm" }, { on: "yes" }, { on: true }, null, [], "x"]) expect(normChief(bad).ok, JSON.stringify(bad)).toBe(false);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hq-chief-")), "chief.json");
    expect(readChief(f)).toEqual({ room: null, on: false });
    writeChief({ room: "hq-core", on: true }, f);
    expect(readChief(f)).toEqual({ room: "hq-core", on: true });
    fs.writeFileSync(f, '{"room":"../etc","on":true}');
    expect(readChief(f), "a hand-edited bad file reads as off").toEqual({ room: null, on: false });
  });

  it("ask: sends once to the live chief with the composed text; refuses when off, gone or bad", async () => {
    const send = vi.fn<(room: string, text: string) => Promise<{ delivery: string }>>(async () => ({ delivery: "inbox" }));
    const rooms = async () => [brief(), brief({ id: "hq-chief", session_id: "s-chief", label: "chief" })];
    const deps = (cfg: { room: string | null; on: boolean }) => ({ cfg, roster: rooms, send, script: "/h/hq.mjs" });
    expect(await chiefAsk("x", deps({ room: "hq-chief", on: false }))).toMatchObject({ status: 409 });
    expect(await chiefAsk("x", deps({ room: null, on: true }))).toMatchObject({ status: 409 });
    expect(await chiefAsk("x", deps({ room: "hq-gone", on: true }))).toMatchObject({ status: 409 });
    expect(await chiefAsk("  ", deps({ room: "hq-chief", on: true }))).toMatchObject({ status: 422 });
    expect(await chiefAsk("a".repeat(CHIEF_TEXT_MAX + 1), deps({ room: "hq-chief", on: true }))).toMatchObject({ status: 422 });
    expect(send).not.toHaveBeenCalled();
    const r = await chiefAsk(" sửa nút Giao ", deps({ room: "s-chief", on: true }));
    expect(r).toEqual({ status: 201, room: "hq-chief", result: { delivery: "inbox" } });
    expect(send).toHaveBeenCalledTimes(1);
    const [to, text] = send.mock.calls[0];
    expect(to).toBe("hq-chief");
    expect(text).toBe(chiefPrompt("sửa nút Giao", await rooms(), "hq-chief", "/h/hq.mjs"));
    expect(text).not.toContain("- hq-chief");
  });
});

describe("routes", () => {
  const SID = "5d1c9f2e-1a2b-4c3d-8e9f-0123456789ab";
  let token = "";
  let shop = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    shop = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "hq-brief-")));
    // A git root, so a room in a sub-folder names the repo as its project.
    fs.mkdirSync(path.join(shop, ".git"));
    fs.writeFileSync(path.join(shop, ".git", "HEAD"), "ref: refs/heads/main\n");
  });
  beforeEach(() => {
    sendKeys.mockClear();
    merged.mockResolvedValue([
      { name: "hq-web", label: "web", session_id: null, cwd: shop, status: "running", tmux: true, source: "tmux", detail: "Viết brief", inbox_live: false },
      { name: SID, label: "core", session_id: SID, cwd: path.join(shop, "core"), status: "idle", tmux: false, source: "claude", detail: null, inbox_live: false },
    ]);
  });

  it("a room's send carries its context line under its source line; the owner's does not", async () => {
    const post = (body: Record<string, unknown>, ui = false) => messagesPOST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body, ui }));
    const r = await post({ session: "hq-web", text: "[từ phòng core] chạy test", from: "core", from_session: SID, from_cwd: "/elsewhere" });
    expect(r.status).toBe(201);
    const project = path.basename(shop);
    // An idle room's step is the office's idle caption (lib/floor.ts).
    expect(sendKeys.mock.calls.at(-1)?.[1]).toBe(`[phòng core]\n[từ phòng core · ${project} · đang: Đang nghỉ]\nchạy test`);
    await post({ session: SID, text: "xem giúp", from: "x", from_cwd: shop });
    const sent = (await (await messagesPOST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body: { session: "hq-web", text: "y", from: "x", from_cwd: path.join(shop, "core") } }))).json()).message.text;
    expect(sent).toBe(`[phòng x]\n[từ phòng core · ${project} · đang: Đang nghỉ]\ny`);
    await post({ session: "hq-web", text: "việc", from: "core", from_session: SID }, true);
    expect(sendKeys.mock.calls.at(-1)?.[1], "the owner's words go in as typed").toBe("việc");
    await post({ session: "hq-web", text: "việc", from: "web", from_cwd: shop });
    expect(sendKeys.mock.calls.at(-1)?.[1], "the only room in that folder is the recipient: no line").toBe("[phòng web]\nviệc");
  });

  it("GET /api/brief: every live room, or one", async () => {
    const all = await (await briefGET(req("/api/brief", { token }))).json();
    expect(all.rooms.map((b: Brief) => [b.id, b.label, b.status, b.doing])).toEqual([
      ["hq-web", "web", "running", "Viết brief"],
      [SID, "core", "idle", "Đang nghỉ"],
    ]);
    const one = await briefGET(req("/api/brief?room=core", { token }));
    expect((await one.json()).brief.id).toBe(SID);
    expect((await briefGET(req("/api/brief?room=nope", { token }))).status).toBe(404);
  });

  it("/api/chief round trip: 422 not a room id, 409 not live, then saved and read back", async () => {
    const put = (body: unknown) => chiefPUT(req("/api/chief", { method: "PUT", token, origin: ORIGIN, body }));
    expect((await put({ room: "../x" })).status).toBe(422);
    expect((await put({ on: true })).status).toBe(422);
    expect((await put({ room: "hq-gone", on: true })).status).toBe(409);
    const ok = await put({ room: SID, on: true });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ cfg: { room: SID, on: true }, live: true });
    const got = await (await chiefGET(req("/api/chief", { token }))).json();
    expect(got.cfg).toEqual({ room: SID, on: true });
    expect(got.rooms.map((r: { id: string }) => r.id)).toEqual(["hq-web", SID]);
    merged.mockResolvedValue([]);
    expect((await put({ on: false })).status, "a closed chief can always be turned off").toBe(200);
  });
});
