import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IDLE_STALE_MS, idleView, isStale, longRestCount, parseIdleRecord, roomOfDetail, sortMembers, teamOf } from "@/lib/idle";
import { readIdleStatus } from "@/lib/server/idle";
import { idleStatusDir } from "@/lib/server/paths";
import { GET as officeGET } from "@/app/api/office/route";
import { getToken } from "@/lib/server/auth";
import { req, tempHome } from "./helpers";

const NOW = 1_800_000_000_000;
const rec = (o: Record<string, unknown> = {}) => ({
  schema: 1,
  team: "session-abcdefgh",
  name: "be",
  state: "working",
  detail: "task 3",
  ts: NOW / 1000,
  ...o,
});

describe("idle: parse a status record", () => {
  it("accepts a schema-1 record and keeps one line of detail", () => {
    expect(parseIdleRecord(rec({ detail: "dòng một\ndòng hai" }))).toEqual({
      team: "session-abcdefgh",
      name: "be",
      state: "working",
      detail: "dòng một",
      ts: NOW / 1000,
    });
  });
  it("rejects unknown schema, state, unsafe names and bad ts", () => {
    expect(parseIdleRecord(rec({ schema: 2 }))).toBeNull();
    expect(parseIdleRecord(rec({ state: "sleeping" }))).toBeNull();
    expect(parseIdleRecord(rec({ name: "../x" }))).toBeNull();
    expect(parseIdleRecord(rec({ ts: "1" }))).toBeNull();
    expect(parseIdleRecord(null)).toBeNull();
    expect(parseIdleRecord("x")).toBeNull();
  });
  it("missing detail becomes empty", () => {
    expect(parseIdleRecord(rec({ detail: undefined }))?.detail).toBe("");
  });
});

describe("idle: state -> label, icon, tone", () => {
  it("maps every state with text, never colour only", () => {
    expect(idleView({ state: "working", detail: "" })).toEqual({ label: "đang làm", icon: "working", tone: "running" });
    expect(idleView({ state: "recall", detail: "" })).toEqual({ label: "đang hồi ức", icon: "recall", tone: "running" });
    expect(idleView({ state: "ask_lead", detail: "" })).toEqual({ label: "đang hỏi lead", icon: "ask", tone: "needs" });
    expect(idleView({ state: "rest", detail: "chạm trần $5.00/giờ" })).toEqual({ label: "nghỉ: chạm trần $5.00/giờ", icon: "rest", tone: "idle" });
    expect(idleView({ state: "rest", detail: "" }).label).toBe("nghỉ");
  });
  it("ask_room names the room from the hook's detail, else 'khác'", () => {
    const d = "Team hết việc. Phòng zus (ab12cd34) còn 3 task mở: tìm session đó bằng ListAgents";
    expect(roomOfDetail(d)).toBe("zus");
    expect(idleView({ state: "ask_room", detail: d }).label).toBe("đang hỏi phòng zus");
    expect(idleView({ state: "ask_room", detail: "gì đó" }).label).toBe("đang hỏi phòng khác");
  });
  it("stale after 6 h; long rest counts live rests over 10 min", () => {
    expect(isStale({ ts: (NOW - IDLE_STALE_MS - 1000) / 1000 }, NOW)).toBe(true);
    expect(isStale({ ts: (NOW - 60_000) / 1000 }, NOW)).toBe(false);
    const rs = [
      parseIdleRecord(rec({ state: "rest", ts: (NOW - 11 * 60_000) / 1000 }))!,
      parseIdleRecord(rec({ name: "fe", state: "rest", ts: (NOW - 60_000) / 1000 }))!,
      parseIdleRecord(rec({ name: "qa", state: "rest", ts: (NOW - 7 * 3600_000) / 1000 }))!,
      parseIdleRecord(rec({ name: "ops", state: "working", ts: (NOW - 30 * 60_000) / 1000 }))!,
    ];
    expect(longRestCount(rs, NOW)).toBe(1);
  });
  it("team name and member order follow the hook", () => {
    expect(teamOf("abcdefgh-1234")).toBe("session-abcdefgh");
    expect(teamOf(null)).toBeNull();
    expect(sortMembers([{ name: "fe" }, { name: "lead" }, { name: "be" }]).map((m) => m.name)).toEqual(["lead", "be", "fe"]);
  });
});

describe("idle: server reader", () => {
  it("returns [] when the status dir does not exist", () => {
    tempHome();
    expect(readIdleStatus()).toEqual([]);
  });
  it("reads valid files from ~/.local/state/8sync/ccc/idle/status, skips bad ones", () => {
    const home = tempHome();
    const dir = idleStatusDir();
    expect(dir).toBe(path.join(home, ".local", "state", "8sync", "ccc", "idle", "status"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session-abcdefgh__be.json"), JSON.stringify(rec({ ts: 100 })));
    fs.writeFileSync(path.join(dir, "session-abcdefgh__lead.json"), JSON.stringify(rec({ name: "lead", state: "rest", detail: "hết việc", ts: 200 })));
    fs.writeFileSync(path.join(dir, "broken.json"), "{not json");
    fs.writeFileSync(path.join(dir, "wrong.json"), JSON.stringify(rec({ state: "nope" })));
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    fs.mkdirSync(path.join(dir, "sub.json"));
    const rs = readIdleStatus();
    expect(rs.map((r) => `${r.name}:${r.state}`)).toEqual(["lead:rest", "be:working"]);
  });
  it("keeps the newest record when two files name the same member", () => {
    const dir = path.join(tempHome(), "s");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(rec({ ts: 10, state: "working" })));
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(rec({ ts: 20, state: "rest" })));
    expect(readIdleStatus(dir).map((r) => r.state)).toEqual(["rest"]);
  });
});

describe("idle: exposed through /api/office (the poll the office view already runs)", () => {
  it("returns the records under `idle`", async () => {
    tempHome();
    const dir = idleStatusDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session-abcdefgh__lead.json"), JSON.stringify(rec({ name: "lead", state: "ask_lead" })));
    const r = await officeGET(req("/api/office", { token: getToken() }));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { idle: { name: string; state: string }[] };
    expect(body.idle.map((m) => `${m.name}:${m.state}`)).toEqual(["lead:ask_lead"]);
  });
});
