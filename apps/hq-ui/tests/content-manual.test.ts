import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { channelGroup, manualLine, type ChannelPost, type ChannelState } from "@/lib/content";
import type { FloorRow } from "@/lib/floor";
import { getDb } from "@/lib/server/db";
import {
  claimRow,
  dueManual,
  MANUAL_KEEP_MS,
  MANUAL_LEAD_MS,
  MANUAL_STALE_MS,
  manualConfig,
  manualKey,
  manualRoom,
  manualStatuses,
  manualText,
  manualTick,
  pruneManualState,
  releaseRow,
  readManualState,
  writeManualState,
  type ManualConfig,
  type ManualItem,
} from "@/lib/server/content-manual";
import { inboxDir, inboxFile } from "@/lib/server/inbox";

const T = new Date(2026, 10, 6, 18, 0).getTime();
const MIN = 60_000;

const post = (channel: ChannelPost["channel"], state: ChannelState, extra: Partial<ChannelPost> = {}): ChannelPost => ({
  item_id: 7,
  channel,
  state,
  scheduled_for: null,
  permalink: null,
  published_at: null,
  error: null,
  attempts: 1,
  updated_at: T - 3600_000,
  ...extra,
});

const item = (extra: Partial<ManualItem> = {}): ManualItem => ({
  id: 7,
  title: "C++ bài 1",
  fb_page: "8syncdev",
  status: "approved",
  caption: "Caption chung",
  captions_json: { threads: "Cap Threads\ndòng 2" },
  media_path: "C:/media/7.mp4",
  channels: ["facebook", "threads", "linkedin"],
  scheduled_at: T,
  assignee_session: null,
  assignee_base: null,
  channel_posts: [
    post("facebook", "scheduled", { scheduled_for: T, permalink: "https://business.facebook.com/x" }),
    post("threads", "failed", { error: "Threads chưa đăng nhập" }),
  ],
  ...extra,
});

const cfg: ManualConfig = { off: false, room: null };
const AI_WORDS = /nhãn AI|ai_label|aiLabel|AI label|Có AI/i;

describe("channel groups (sheet)", () => {
  it("scheduled/published → Đã lên lịch, failed/blocked → Không lên lịch được, the rest → Chưa lên lịch", () => {
    expect(channelGroup(undefined)).toBe("waiting");
    expect(channelGroup({ state: "scheduling" })).toBe("waiting");
    expect(channelGroup({ state: "cancelled" })).toBe("waiting");
    expect(channelGroup({ state: "scheduled" })).toBe("scheduled");
    expect(channelGroup({ state: "published" })).toBe("scheduled");
    expect(channelGroup({ state: "failed" })).toBe("failed");
    expect(channelGroup({ state: "blocked" })).toBe("failed");
  });

  it("words the fallback status; a guest sees no room name", () => {
    const now = T - 3600_000;
    expect(manualLine({ kind: "planned", room: "cpa-live", at: T }, now)).toBe("Sẽ giao phòng cpa-live tự đăng lúc 18:00");
    expect(manualLine({ kind: "dispatched", room: null, at: T - 2 * MIN }, now)).toBe("Đã giao phòng đăng lúc 17:58");
    expect(manualLine({ kind: "noroom" }, now)).toBe("Chưa có phòng — chọn phòng giao việc");
    expect(manualLine({ kind: "planned", room: "core", at: T + 86_400_000 }, now)).toMatch(/lúc 18:00 07\/11$/);
  });
});

describe("auto-post fallback: due window, rooms, text", () => {
  it("is due from 2 min before the post time, stale after 12 h, never twice", () => {
    const items = [item()];
    expect(dueManual(items, T - MANUAL_LEAD_MS - 1, new Set()).due).toHaveLength(0);
    const at = dueManual(items, T - MANUAL_LEAD_MS, new Set());
    expect(at.due.map((c) => [c.channel, c.key])).toEqual([["threads", manualKey(7, "threads", T)]]);
    expect(dueManual(items, T + MANUAL_STALE_MS, new Set()).due).toHaveLength(1);
    const late = dueManual(items, T + MANUAL_STALE_MS + 1, new Set());
    expect(late.due).toHaveLength(0);
    expect(late.stale.map((c) => c.channel)).toEqual(["threads"]);
    expect(dueManual(items, T, new Set([manualKey(7, "threads", T)])).due).toHaveLength(0);
  });

  it("uses the row's own time before the item's; no time, no dispatch; only approved items and their channels", () => {
    const own = item({ channel_posts: [post("threads", "blocked", { scheduled_for: T + 3600_000 })] });
    expect(dueManual([own], T, new Set()).due).toHaveLength(0);
    expect(dueManual([own], T + 3600_000 - MANUAL_LEAD_MS, new Set()).due[0].key).toBe(manualKey(7, "threads", T + 3600_000));
    expect(dueManual([item({ scheduled_at: null })], T, new Set()).due).toHaveLength(0);
    expect(dueManual([item({ status: "checked" })], T, new Set()).due).toHaveLength(0);
    // A failed row of a channel the item no longer has is not posted.
    expect(dueManual([item({ channels: ["facebook"] })], T, new Set()).due).toHaveLength(0);
  });

  it("room: the item's posting room, else manual.room, else the first digest room", () => {
    expect(manualRoom({ assignee_session: "omp-0123456789abcdef", assignee_base: "mkt · cpa" }, { off: false, room: "core" })).toEqual({ session: "omp-0123456789abcdef", label: "mkt · cpa" });
    expect(manualRoom({ assignee_session: null, assignee_base: null }, { off: false, room: "core" })).toEqual({ name: "core", label: "core" });
    expect(manualRoom({ assignee_session: null, assignee_base: null }, cfg)).toEqual({ name: "cpa-live", label: "cpa-live" });
  });

  it("reads manual from content.json", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hq-manual-cfg-")), "content.json");
    expect(manualConfig(file)).toEqual({ off: false, room: null });
    fs.writeFileSync(file, JSON.stringify({ db: "C:/x.db", manual: { room: " cpa-live ", off: true } }));
    expect(manualConfig(file)).toEqual({ off: true, room: "cpa-live" });
  });

  it("the task: the post, its caption as data, the reason, how to post and write back; no AI-label wording", () => {
    const c = dueManual([item()], T, new Set()).due[0];
    const text = manualText(c, "C:/repo/cpa", "C:/repo/cpa/daily-dev.db", T - MANUAL_LEAD_MS);
    expect(text).toContain("[Nội dung #7]");
    expect(text).toContain("Kênh Threads của bài #7 không lên lịch được");
    expect(text).toContain("«Threads chưa đăng nhập»");
    expect(text).toContain("«Cap Threads\ndòng 2»");
    expect(text).toContain("C:/media/7.mp4");
    expect(text).toContain("ego-browser");
    expect(text).toContain("UPDATE content_channel_posts SET state = 'published', permalink = '<link bài>'");
    expect(text).toContain("WHERE item_id = 7 AND channel = 'threads'");
    expect(text).toContain("state = 'failed', error = '<lý do>'");
    expect(text).toContain("C:/repo/cpa");
    expect(text).not.toMatch(AI_WORDS);
  });

  it("statuses for the sheet: planned, dispatched, stale, no room, no time; none when off; a guest sees no room", () => {
    const st = { dispatched: {}, noroom: {} };
    expect(manualStatuses(item(), st, cfg, T - 3600_000)).toEqual({ threads: { kind: "planned", room: "cpa-live", at: T } });
    expect(manualStatuses(item(), st, cfg, T - 3600_000, true)).toEqual({ threads: { kind: "planned", room: null, at: T } });
    const key = manualKey(7, "threads", T);
    expect(manualStatuses(item(), { dispatched: { [key]: { room: "core", at: T - MIN } }, noroom: {} }, cfg, T)).toEqual({ threads: { kind: "dispatched", room: "core", at: T - MIN } });
    expect(manualStatuses(item(), { dispatched: {}, noroom: { [key]: T } }, cfg, T)).toEqual({ threads: { kind: "noroom" } });
    expect(manualStatuses(item(), st, cfg, T + MANUAL_STALE_MS + 1)).toEqual({ threads: { kind: "stale", at: T } });
    expect(manualStatuses(item({ scheduled_at: null }), st, cfg, T)).toEqual({ threads: { kind: "notime" } });
    expect(manualStatuses(item(), st, { off: true, room: null }, T)).toBeUndefined();
    expect(manualStatuses(item({ channel_posts: [] }), st, cfg, T)).toBeUndefined();
  });

  it("prunes dispatch records after 3 days; a broken file reads as empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-manual-state-"));
    const file = path.join(dir, "content-manual.json");
    const s = { dispatched: { old: { room: "a", at: T - MANUAL_KEEP_MS - 1 }, edge: { room: "b", at: T - MANUAL_KEEP_MS } }, noroom: { gone: T - MANUAL_KEEP_MS - 1, kept: T } };
    expect(pruneManualState(s, T)).toEqual({ dispatched: { edge: { room: "b", at: T - MANUAL_KEEP_MS } }, noroom: { kept: T } });
    writeManualState(s, T, file);
    expect(readManualState(file)).toEqual({ dispatched: { edge: { room: "b", at: T - MANUAL_KEEP_MS } }, noroom: { kept: T } });
    fs.writeFileSync(file, "{not json");
    expect(readManualState(file)).toEqual({ dispatched: {}, noroom: {} });
  });
});

describe("auto-post fallback: the tick", () => {
  const ROOM = "omp-0123456789abcdef";
  let repo = "";
  const floor = (rows: Partial<FloorRow>[]) => async () => rows.map((r, i) => ({ id: `r${i}`, name: "x", title: "x", last_active: null, hq: false, live: true, engine: "ccc", ...r }) as FloorRow);

  beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-manual-")));
    fs.mkdirSync(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.mkdirSync(inboxDir(), { recursive: true });
    fs.writeFileSync(path.join(inboxDir(), `${ROOM}.live`), "");
  });

  const stateFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hq-manual-tick-")), "content-manual.json");
  // The book's row claim, faked: the tick tests never touch a content DB.
  const released: string[] = [];
  const book = { claim: () => true, release: (c: { key: string }) => void released.push(c.key) };

  it("hands a due channel once to the named live room of the content repo, as HQ's own message", async () => {
    const db = getDb();
    const file = stateFile();
    const content = () => ({ items: [item()], repo, dbFile: path.join(repo, "daily-dev.db") });
    // No live room by that name: nothing sent, the sheet says no room, the next tick tries again.
    expect(await manualTick(db, T, { ...book, content, cfg, stateFile: file, floor: floor([{ name: "cpa-live", inbox_id: ROOM, repo, live: false }]) })).toEqual({ sent: [], noroom: [manualKey(7, "threads", T)] });
    expect(fs.existsSync(inboxFile(ROOM))).toBe(false);
    expect(manualStatuses(item(), readManualState(file), cfg, T)).toEqual({ threads: { kind: "noroom" } });

    const live = floor([{ name: "cpa-live", inbox_id: ROOM, repo }]);
    expect(await manualTick(db, T, { ...book, content, cfg, stateFile: file, floor: live })).toEqual({ sent: [{ key: manualKey(7, "threads", T), room: "cpa-live" }], noroom: [] });
    expect(await manualTick(db, T + MIN, { ...book, content, cfg, stateFile: file, floor: live })).toBeNull();
    const lines = fs.readFileSync(inboxFile(ROOM), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const { text, by } = JSON.parse(lines[0]) as { text: string; by: unknown };
    expect(by).toBe("auto");
    expect(text).toContain("bài #7");
    expect(text).not.toMatch(AI_WORDS);
    expect(manualStatuses(item(), readManualState(file), cfg, T + MIN)).toEqual({ threads: { kind: "dispatched", room: "cpa-live", at: T } });
  });

  it("goes to the item's posting room first; a failed send is not recorded; off sends nothing", async () => {
    const db = getDb();
    const file = stateFile();
    const it = item({ assignee_session: "omp-fedcba9876543210", assignee_base: "mkt · cpa" });
    const content = () => ({ items: [it], repo, dbFile: path.join(repo, "daily-dev.db") });
    const calls: string[] = [];
    const ok = async (session: string) => {
      calls.push(session);
      return { delivery: "inbox", error: null };
    };
    expect(await manualTick(db, T, { ...book, content, cfg: { off: true, room: "core" }, stateFile: file, deliver: ok })).toBeNull();
    const fail = async () => ({ delivery: "failed", error: "x" });
    expect(await manualTick(db, T, { ...book, content, cfg, stateFile: file, deliver: fail })).toEqual({ sent: [], noroom: [manualKey(7, "threads", T)] });
    expect(readManualState(file).dispatched).toEqual({});
    expect(released).toContain(manualKey(7, "threads", T));
    expect(await manualTick(db, T, { ...book, content, cfg, stateFile: file, deliver: ok })).toMatchObject({ sent: [{ room: "mkt · cpa" }] });
    expect(calls).toEqual(["omp-fedcba9876543210"]);
    // Stale: 12 h late is not posted any more.
    const late = stateFile();
    expect(await manualTick(db, T + MANUAL_STALE_MS + 1, { ...book, content, cfg, stateFile: late, deliver: ok })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("sends nothing when the row was taken first (Thử lại, the worker, Bỏ duyệt)", async () => {
    const db = getDb();
    const file = stateFile();
    const content = () => ({ items: [item({ assignee_session: "omp-fedcba9876543210" })], repo, dbFile: path.join(repo, "daily-dev.db") });
    const calls: string[] = [];
    const ok = async (session: string) => (calls.push(session), { delivery: "inbox", error: null });
    expect(await manualTick(db, T, { ...book, claim: () => false, content, cfg, stateFile: file, deliver: ok })).toEqual({ sent: [], noroom: [] });
    expect(calls).toEqual([]);
    expect(readManualState(file).dispatched).toEqual({});
  });
});

describe("auto-post fallback: the row claim in the book", () => {
  const book = () => {
    const b = new DatabaseSync(":memory:");
    b.exec(`CREATE TABLE content_items (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE content_channel_posts (item_id INTEGER, channel TEXT, state TEXT, error TEXT, updated_at INTEGER, PRIMARY KEY (item_id, channel));
      INSERT INTO content_items VALUES (7, 'approved'), (8, 'draft');
      INSERT INTO content_channel_posts VALUES (7, 'threads', 'failed', 'chưa đăng nhập', 1), (8, 'threads', 'blocked', 'x', 1);`);
    return b;
  };
  const row = (b: DatabaseSync, id: number) => b.prepare("SELECT state, error FROM content_channel_posts WHERE item_id = ?").get(id);
  const cand = (id: number, state: ChannelState, error: string) => ({ item: item({ id }), channel: "threads" as const, post: post("threads", state, { item_id: id, error }), at: T, key: manualKey(id, "threads", T) });

  it("takes a failed row of an approved item once, never an unapproved one, and gives it back unchanged", () => {
    const b = book();
    const c = cand(7, "failed", "chưa đăng nhập");
    expect(claimRow(b, c, T)).toBe(true);
    expect(row(b, 7)).toMatchObject({ state: "scheduling" });
    expect(claimRow(b, c, T)).toBe(false);
    releaseRow(b, c, T + MIN);
    expect(row(b, 7)).toMatchObject({ state: "failed", error: "chưa đăng nhập" });
    expect(claimRow(b, cand(8, "blocked", "x"), T)).toBe(false);
    expect(row(b, 8)).toMatchObject({ state: "blocked" });
  });

  it("does not give back a row someone moved on after the claim", () => {
    const b = book();
    const c = cand(7, "failed", "chưa đăng nhập");
    claimRow(b, c, T);
    b.exec("UPDATE content_channel_posts SET state = 'published' WHERE item_id = 7");
    releaseRow(b, c, T + MIN);
    expect(row(b, 7)).toMatchObject({ state: "published" });
  });

  it("the sheet keeps 'Đã giao phòng' on a claimed row, hides the room from a guest, and drops it once the item is unapproved", () => {
    const claimed = item({ channel_posts: [post("threads", "scheduling")] });
    const state = { dispatched: { [manualKey(7, "threads", T)]: { room: "cpa-live", at: T } }, noroom: {} };
    expect(manualStatuses(claimed, state, cfg, T + MIN)).toEqual({ threads: { kind: "dispatched", room: "cpa-live", at: T } });
    expect(manualStatuses(claimed, state, cfg, T + MIN, true)).toEqual({ threads: { kind: "dispatched", room: null, at: T } });
    // A worker's own `scheduling` (no dispatch record) is not the room's.
    expect(manualStatuses(claimed, { dispatched: {}, noroom: {} }, cfg, T + MIN)).toBeUndefined();
    expect(manualStatuses({ ...claimed, status: "checked" }, state, cfg, T + MIN)).toBeUndefined();
  });
});
