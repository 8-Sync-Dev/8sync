import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { channelGroup, HQ_CLAIM_PREFIX, hqClaimNote, hqClaimRoom, isHqClaim, MANUAL_CATCHUP_MS, manualLine, type ChannelPost, type ChannelState } from "@/lib/content";
import type { FloorRow } from "@/lib/floor";
import { getDb } from "@/lib/server/db";
import {
  claimRow,
  dueManual,
  MANUAL_KEEP_MS,
  MANUAL_LEAD_MS,
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
  type ManualCand,
  type ManualConfig,
  type ManualItem,
} from "@/lib/server/content-manual";
import { inboxDir, inboxFile } from "@/lib/server/inbox";

const T = new Date(2026, 10, 6, 18, 0).getTime();
const MIN = 60_000;
const HOUR = 3600_000;
const CLAIM = hqClaimNote("cpa-live", T);

const post = (channel: ChannelPost["channel"], state: ChannelState, extra: Partial<ChannelPost> = {}): ChannelPost => ({
  item_id: 7,
  channel,
  state,
  scheduled_for: null,
  permalink: null,
  published_at: null,
  error: null,
  attempts: 1,
  updated_at: T - HOUR,
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
  source_url: "https://example.com/nguon",
  fb_post_url: null,
  published_at: null,
  channels: ["facebook", "threads"],
  scheduled_at: T,
  assignee_session: null,
  assignee_base: null,
  channel_posts: [
    post("facebook", "scheduled", { scheduled_for: T, permalink: "https://business.facebook.com/x" }),
    post("threads", "failed", { error: "Threads chưa đăng nhập" }),
  ],
  ...extra,
});

/** An approved item whose LinkedIn channel has no row at all. */
const missing = (extra: Partial<ManualItem> = {}) => item({ channels: ["facebook", "linkedin"], channel_posts: [post("facebook", "scheduled", { scheduled_for: T })], ...extra });

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

  it("words the fallback status; a guest sees no room name; stale says it is past the catch-up window", () => {
    const now = T - HOUR;
    expect(manualLine({ kind: "planned", room: "cpa-live", at: T }, now)).toBe("Sẽ giao phòng cpa-live tự đăng lúc 18:00");
    expect(manualLine({ kind: "dispatched", room: null, at: T - 2 * MIN }, now)).toBe("Đã giao phòng đăng lúc 17:58");
    expect(manualLine({ kind: "noroom" }, now)).toBe("Chưa có phòng — chọn phòng giao việc");
    expect(manualLine({ kind: "planned", room: "core", at: T + 86_400_000 }, now)).toMatch(/lúc 18:00 07\/11$/);
    expect(manualLine({ kind: "stale", at: T }, T + MANUAL_CATCHUP_MS + HOUR)).toBe("Quá giờ đăng 18:00 06/11 hơn 72 tiếng, ngoài hạn HQ tự đăng bù: đăng tay hoặc dời giờ đăng");
  });

  it("HQ's claim on a row: blocked with the HQ prefix, its room readable back", () => {
    expect(CLAIM).toBe("HQ giao cpa-live lúc 18:00 06/11");
    expect(CLAIM.startsWith(HQ_CLAIM_PREFIX)).toBe(true);
    expect(isHqClaim({ state: "blocked", error: CLAIM })).toBe(true);
    expect(isHqClaim({ state: "failed", error: CLAIM })).toBe(false);
    expect(isHqClaim({ state: "blocked", error: "Threads chưa đăng nhập" })).toBe(false);
    expect(isHqClaim({ state: "blocked", error: null })).toBe(false);
    expect(isHqClaim(undefined)).toBe(false);
    expect(hqClaimRoom(hqClaimNote("core · content-post-agency", T))).toBe("core · content-post-agency");
    expect(hqClaimRoom("Threads chưa đăng nhập")).toBeNull();
  });
});

describe("auto-post fallback: due window, rooms, text", () => {
  it("a failed row is due from 2 min before the post time until 72 h after it, stale later, never twice", () => {
    const items = [item()];
    expect(dueManual(items, T - MANUAL_LEAD_MS - 1, new Set()).due).toHaveLength(0);
    const at = dueManual(items, T - MANUAL_LEAD_MS, new Set());
    expect(at.due.map((c) => [c.channel, c.key])).toEqual([["threads", manualKey(7, "threads", T)]]);
    expect(dueManual(items, T + 5 * HOUR, new Set()).due).toHaveLength(1);
    expect(dueManual(items, T + MANUAL_CATCHUP_MS, new Set()).due).toHaveLength(1);
    const late = dueManual(items, T + 73 * HOUR, new Set());
    expect(late.due).toHaveLength(0);
    expect(late.stale.map((c) => c.channel)).toEqual(["threads"]);
    expect(dueManual(items, T, new Set([manualKey(7, "threads", T)])).due).toHaveLength(0);
  });

  it("a channel with no row is due from its time (not before: the worker may still schedule it), never on a book before 0064", () => {
    expect(dueManual([missing()], T - MIN, new Set()).due).toHaveLength(0);
    const c = dueManual([missing()], T + MIN, new Set()).due;
    expect(c.map((x) => [x.channel, x.post, x.key])).toEqual([["linkedin", null, manualKey(7, "linkedin", T)]]);
    expect(dueManual([missing()], T + 73 * HOUR, new Set()).stale.map((x) => x.channel)).toEqual(["linkedin"]);
    expect(dueManual([missing({ channel_posts: undefined })], T + MIN, new Set()).due).toHaveLength(0);
  });

  it("a channel with no row is not handed over when the item shows it already went out (posted by hand, no row written)", () => {
    const bare = (extra: Partial<ManualItem> = {}) => item({ channels: ["facebook", "linkedin"], channel_posts: [], ...extra });
    const due = (it: ManualItem) => dueManual([it], T + MIN, new Set()).due.map((c) => c.channel);
    expect(due(bare())).toEqual(["facebook", "linkedin"]);
    // Posted somewhere: the item's own post time is set, so no channel without a row goes.
    expect(due(bare({ published_at: T - 5 * MIN }))).toEqual([]);
    // A Facebook post link only covers Facebook.
    expect(due(bare({ fb_post_url: "https://www.facebook.com/8syncdev/posts/1" }))).toEqual(["linkedin"]);
    expect(due(bare({ status: "published" }))).toEqual([]);
    // A row that says it failed still goes: the evidence is about rows nobody wrote.
    expect(due(bare({ published_at: T - 5 * MIN, channel_posts: [post("linkedin", "failed", { error: "x" })] }))).toEqual(["linkedin"]);
    // An older book without those columns reads them as undefined: no evidence.
    expect(due(bare({ published_at: undefined, fb_post_url: undefined }))).toEqual(["facebook", "linkedin"]);
    expect(manualStatuses(bare({ published_at: T - 5 * MIN }), { dispatched: {}, noroom: {} }, cfg, T + MIN)).toBeUndefined();
    expect(manualStatuses(bare({ fb_post_url: "https://www.facebook.com/8syncdev/posts/1" }), { dispatched: {}, noroom: {} }, cfg, T + MIN)).toEqual({
      linkedin: { kind: "planned", room: "cpa-live", at: T },
    });
  });

  it("a row HQ already handed to a room is not a candidate again, whatever the state file says", () => {
    const claimed = item({ channel_posts: [post("threads", "blocked", { error: CLAIM, scheduled_for: T })] });
    expect(dueManual([claimed], T + MIN, new Set()).due.map((c) => c.channel)).toEqual(["facebook"]);
    expect(dueManual([claimed], T + MIN, new Set()).due.map((c) => c.channel)).not.toContain("threads");
  });

  it("uses the row's own time before the item's; no time, no dispatch; only approved items and their channels", () => {
    const own = item({ channel_posts: [post("facebook", "scheduled"), post("threads", "blocked", { scheduled_for: T + HOUR })] });
    expect(dueManual([own], T, new Set()).due).toHaveLength(0);
    expect(dueManual([own], T + HOUR - MANUAL_LEAD_MS, new Set()).due[0].key).toBe(manualKey(7, "threads", T + HOUR));
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

  it("the task: the post, its caption as data, the reason, the claim to check, how to post and write back; no AI-label wording", () => {
    const c = dueManual([item()], T, new Set()).due[0];
    const text = manualText(c, "C:/repo/cpa", "C:/repo/cpa/daily-dev.db", T - MANUAL_LEAD_MS, CLAIM);
    expect(text).toContain("[Nội dung #7]");
    expect(text).toContain("Kênh Threads của bài #7 không lên lịch được");
    expect(text).not.toContain("ĐĂNG TRỄ");
    expect(text).toContain("«Threads chưa đăng nhập»");
    expect(text).toContain("«Cap Threads\ndòng 2»");
    expect(text).toContain("C:/media/7.mp4");
    expect(text).toContain("ego-browser");
    expect(text).toContain(`state = 'blocked', error = '${CLAIM}'`);
    expect(text).toContain("SELECT state, error FROM content_channel_posts WHERE item_id = 7 AND channel = 'threads'");
    expect(text).toContain("UPDATE content_channel_posts SET state = 'published', permalink = '<link bài>'");
    expect(text).toContain("updated_at = <ms bây giờ> WHERE item_id = 7 AND channel = 'threads';");
    expect(text).toContain("state = 'failed', error = '<lý do>'");
    expect(text).not.toContain("AND state =");
    expect(text).not.toContain("15 phút");
    expect(text).toContain("C:/repo/cpa");
    expect(text).toContain("2. Kiểm trên trang/kênh Threads thật (tab Đã đăng / Đã lên lịch) xem bài này đã lên chưa. Đã lên thì KHÔNG đăng lại");
    expect(text).toContain("SET state = 'scheduled', scheduled_for = <ms giờ hẹn>");
    expect(text).not.toMatch(AI_WORDS);
  });

  it("a late post: the first line says so, the caption gets no late note, only its time words fixed; a day late checks the topic", () => {
    const c = dueManual([item()], T + 5 * HOUR, new Set()).due[0];
    const text = manualText(c, "C:/repo/cpa", "C:/repo/cpa/daily-dev.db", T + 5 * HOUR, CLAIM);
    expect(text).toContain("ĐĂNG TRỄ 5 giờ: kênh Threads của bài #7");
    expect(text).toContain("KHÔNG thêm ghi chú \"đăng trễ\" nào vào caption");
    expect(text).toContain("published_at");
    expect(text).toContain("«Cap Threads\ndòng 2»");
    expect(text).not.toContain("Trễ hơn 24 giờ");
    expect(manualText(c, "r", "d", T + 10 * MIN, CLAIM)).not.toContain("ĐĂNG TRỄ");
    expect(manualText(c, "r", "d", T + 40 * MIN, CLAIM)).toContain("ĐĂNG TRỄ 40 phút");
    const day = manualText(c, "r", "d", T + 26 * HOUR + 30 * MIN, CLAIM);
    expect(day).toContain("ĐĂNG TRỄ 26 giờ 30 phút");
    expect(day).toContain("Trễ hơn 24 giờ");
    expect(day).toContain("«https://example.com/nguon»");
    expect(day).not.toMatch(AI_WORDS);
  });

  it("a channel with no row: the task says the row may never have existed", () => {
    const c = dueManual([missing()], T + MIN, new Set()).due[0];
    const text = manualText(c, "r", "d", T + MIN, CLAIM);
    expect(text).toContain("Kênh LinkedIn của bài #7 chưa được lên lịch");
    expect(text).toContain("có thể dòng chưa từng tồn tại");
    expect(text).toContain("UPDATE content_channel_posts SET state = 'published'");
    expect(text).toContain("WHERE item_id = 7 AND channel = 'linkedin'");
    expect(text).toContain("2. Kiểm trên trang/kênh LinkedIn thật (tab Đã đăng / Đã lên lịch)");
  });

  it("statuses for the sheet: planned, dispatched, stale, no room, no time; none when off; a guest sees no room", () => {
    const st = { dispatched: {}, noroom: {} };
    expect(manualStatuses(item(), st, cfg, T - HOUR)).toEqual({ threads: { kind: "planned", room: "cpa-live", at: T } });
    expect(manualStatuses(item(), st, cfg, T - HOUR, true)).toEqual({ threads: { kind: "planned", room: null, at: T } });
    const key = manualKey(7, "threads", T);
    expect(manualStatuses(item(), { dispatched: { [key]: { room: "core", at: T - MIN } }, noroom: {} }, cfg, T)).toEqual({ threads: { kind: "dispatched", room: "core", at: T - MIN } });
    expect(manualStatuses(item(), { dispatched: {}, noroom: { [key]: T } }, cfg, T)).toEqual({ threads: { kind: "noroom" } });
    expect(manualStatuses(item(), st, cfg, T + MANUAL_CATCHUP_MS)).toEqual({ threads: { kind: "planned", room: "cpa-live", at: T } });
    expect(manualStatuses(item(), st, cfg, T + MANUAL_CATCHUP_MS + 1)).toEqual({ threads: { kind: "stale", at: T } });
    expect(manualStatuses(item({ scheduled_at: null }), st, cfg, T)).toEqual({ threads: { kind: "notime" } });
    expect(manualStatuses(item(), st, { off: true, room: null }, T)).toBeUndefined();
    expect(manualStatuses(item({ channel_posts: [post("facebook", "scheduled"), post("threads", "published")] }), st, cfg, T)).toBeUndefined();
  });

  it("statuses for a channel with no row: planned before its time, then dispatched / no room / stale; nothing before 0064", () => {
    const st = { dispatched: {}, noroom: {} };
    const key = manualKey(7, "linkedin", T);
    expect(manualStatuses(missing(), st, cfg, T - HOUR)).toEqual({ linkedin: { kind: "planned", room: "cpa-live", at: T } });
    expect(manualStatuses(missing(), { dispatched: { [key]: { room: "cpa-live", at: T } }, noroom: {} }, cfg, T + MIN)).toEqual({ linkedin: { kind: "dispatched", room: "cpa-live", at: T } });
    expect(manualStatuses(missing(), { dispatched: {}, noroom: { [key]: T } }, cfg, T + MIN)).toEqual({ linkedin: { kind: "noroom" } });
    expect(manualStatuses(missing(), st, cfg, T + 73 * HOUR)).toEqual({ linkedin: { kind: "stale", at: T } });
    expect(manualStatuses(missing({ scheduled_at: null }), st, cfg, T)).toEqual({ linkedin: { kind: "notime" } });
    expect(manualStatuses(missing({ channel_posts: undefined }), st, cfg, T)).toBeUndefined();
    expect(manualStatuses(missing({ status: "checked" }), st, cfg, T)).toBeUndefined();
  });

  it("prunes dispatch records after the catch-up window plus two days; a broken file reads as empty", () => {
    expect(MANUAL_KEEP_MS).toBe(MANUAL_CATCHUP_MS + 2 * 24 * HOUR);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-manual-state-"));
    const file = path.join(dir, "content-manual.json");
    const s = { dispatched: { old: { room: "a", at: T - MANUAL_KEEP_MS - 1 }, edge: { room: "b", at: T - MANUAL_KEEP_MS } }, noroom: { gone: T - MANUAL_KEEP_MS - 1, kept: T } };
    expect(pruneManualState(s, T)).toEqual({ dispatched: { edge: { room: "b", at: T - MANUAL_KEEP_MS } }, noroom: { kept: T } });
    writeManualState(s, T, file);
    expect(readManualState(file)).toEqual({ dispatched: { edge: { room: "b", at: T - MANUAL_KEEP_MS } }, noroom: { kept: T } });
    fs.writeFileSync(file, "{not json");
    expect(readManualState(file)).toEqual({ dispatched: {}, noroom: {} });
  });

  it("never prunes a dispatch record while its key is still inside the catch-up window", () => {
    // The earliest a key is dispatched is MANUAL_LEAD_MS before its time; the last tick that could hand
    // it again runs MANUAL_CATCHUP_MS after its time. Every tick in between still finds the record.
    const key = manualKey(7, "threads", T);
    const s = { dispatched: { [key]: { room: "cpa-live", at: T - MANUAL_LEAD_MS } }, noroom: {} };
    for (let now = T - MANUAL_LEAD_MS; now <= T + MANUAL_CATCHUP_MS; now += HOUR) {
      const kept = pruneManualState(s, now);
      expect(kept.dispatched[key]).toBeDefined();
      expect(dueManual([item()], now, new Set(Object.keys(kept.dispatched))).due).toHaveLength(0);
    }
    expect(pruneManualState(s, T + MANUAL_CATCHUP_MS).dispatched[key]).toBeDefined();
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
  const sender = () => {
    const calls: { session: string; text: string }[] = [];
    const deliver = async (session: string, text: string) => (calls.push({ session, text }), { delivery: "inbox", error: null });
    return { calls, deliver };
  };

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
    const { calls, deliver: ok } = sender();
    expect(await manualTick(db, T, { ...book, content, cfg: { off: true, room: "core" }, stateFile: file, deliver: ok })).toBeNull();
    const fail = async () => ({ delivery: "failed", error: "x" });
    expect(await manualTick(db, T, { ...book, content, cfg, stateFile: file, deliver: fail })).toEqual({ sent: [], noroom: [manualKey(7, "threads", T)] });
    expect(readManualState(file).dispatched).toEqual({});
    expect(released).toContain(manualKey(7, "threads", T));
    expect(await manualTick(db, T, { ...book, content, cfg, stateFile: file, deliver: ok })).toMatchObject({ sent: [{ room: "mkt · cpa" }] });
    expect(calls.map((c) => c.session)).toEqual(["omp-fedcba9876543210"]);
  });

  it("a machine back 5 h after the post time hands it over once, as a late post", async () => {
    const db = getDb();
    const file = stateFile();
    const content = () => ({ items: [item({ assignee_session: "omp-fedcba9876543210" })], repo, dbFile: path.join(repo, "daily-dev.db") });
    const { calls, deliver } = sender();
    expect(await manualTick(db, T + 5 * HOUR, { ...book, content, cfg, stateFile: file, deliver })).toMatchObject({ sent: [{ key: manualKey(7, "threads", T) }] });
    expect(await manualTick(db, T + 5 * HOUR + MIN, { ...book, content, cfg, stateFile: file, deliver })).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("ĐĂNG TRỄ 5 giờ");
  });

  it("73 h late is not handed over: the sheet shows it as stale", async () => {
    const db = getDb();
    const file = stateFile();
    const content = () => ({ items: [item({ assignee_session: "omp-fedcba9876543210" })], repo, dbFile: path.join(repo, "daily-dev.db") });
    const { calls, deliver } = sender();
    expect(await manualTick(db, T + 73 * HOUR, { ...book, content, cfg, stateFile: file, deliver })).toBeNull();
    expect(calls).toEqual([]);
    expect(manualStatuses(item(), readManualState(file), cfg, T + 73 * HOUR)).toEqual({ threads: { kind: "stale", at: T } });
  });

  it("sends nothing when the row was taken first (Thử lại, the worker, Bỏ duyệt)", async () => {
    const db = getDb();
    const file = stateFile();
    const content = () => ({ items: [item({ assignee_session: "omp-fedcba9876543210" })], repo, dbFile: path.join(repo, "daily-dev.db") });
    const { calls, deliver } = sender();
    expect(await manualTick(db, T, { ...book, claim: () => false, content, cfg, stateFile: file, deliver })).toEqual({ sent: [], noroom: [] });
    expect(calls).toEqual([]);
    expect(readManualState(file).dispatched).toEqual({});
  });

  it("a channel with no row: not before its time; at it, the claim row is inserted and the room told once", async () => {
    const db = getDb();
    const file = stateFile();
    const b = bookDb();
    const it = missing({ assignee_session: "omp-fedcba9876543210", assignee_base: "cpa-live" });
    const content = () => ({ items: [it], repo, dbFile: path.join(repo, "daily-dev.db") });
    const deps = { claim: (c: ManualCand, claim: string, now: number) => claimRow(b, c, claim, now), release: (c: ManualCand, claim: string, now: number) => releaseRow(b, c, claim, now) };
    const { calls, deliver } = sender();
    expect(await manualTick(db, T - MIN, { ...deps, content, cfg, stateFile: file, deliver })).toBeNull();
    expect(rowOf(b, 7, "linkedin")).toBeUndefined();
    expect(await manualTick(db, T + MIN, { ...deps, content, cfg, stateFile: file, deliver })).toMatchObject({ sent: [{ key: manualKey(7, "linkedin", T) }] });
    expect(rowOf(b, 7, "linkedin")).toEqual({ state: "blocked", error: hqClaimNote("cpa-live", T + MIN), scheduled_for: T, updated_at: T + MIN, attempts: 0 });
    expect(await manualTick(db, T + 2 * MIN, { ...deps, content, cfg, stateFile: file, deliver })).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("có thể dòng chưa từng tồn tại");
  });

  it("the worker writes the row between HQ's read and its claim: the INSERT is ignored, nothing sent", async () => {
    const db = getDb();
    const file = stateFile();
    const b = bookDb();
    const it = missing({ assignee_session: "omp-fedcba9876543210" });
    // The tick read the book before the worker scheduled LinkedIn natively.
    const content = () => ({ items: [it], repo, dbFile: path.join(repo, "daily-dev.db") });
    b.exec(`INSERT INTO content_channel_posts (item_id, channel, state, scheduled_for) VALUES (7, 'linkedin', 'scheduled', ${T})`);
    const { calls, deliver } = sender();
    const deps = { claim: (c: ManualCand, claim: string, now: number) => claimRow(b, c, claim, now), release: (c: ManualCand, claim: string, now: number) => releaseRow(b, c, claim, now) };
    expect(await manualTick(db, T + MIN, { ...deps, content, cfg, stateFile: file, deliver })).toEqual({ sent: [], noroom: [] });
    expect(calls).toEqual([]);
    expect(readManualState(file).dispatched).toEqual({});
    expect(rowOf(b, 7, "linkedin")).toMatchObject({ state: "scheduled", error: null });
  });
});

/** A content book in memory with the real `content_channel_posts` schema (0065): never the owner's DB. */
function bookDb(): DatabaseSync {
  const b = new DatabaseSync(":memory:");
  b.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE content_items (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE content_channel_posts (
      item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK (channel IN ('facebook','linkedin','threads','youtube','tiktok','x','instagram','zalo')),
      state TEXT NOT NULL CHECK (state IN ('scheduling','scheduled','published','failed','blocked','cancelled')),
      scheduled_for INTEGER,
      permalink TEXT,
      published_at INTEGER,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (item_id, channel)
    );
    INSERT INTO content_items VALUES (7, 'approved'), (8, 'draft');
    INSERT INTO content_channel_posts (item_id, channel, state, error, updated_at) VALUES (7, 'threads', 'failed', 'chưa đăng nhập', 1), (8, 'threads', 'blocked', 'x', 1);`);
  return b;
}

const rowOf = (b: DatabaseSync, id: number, ch: string) =>
  b.prepare("SELECT state, error, scheduled_for, updated_at, attempts FROM content_channel_posts WHERE item_id = ? AND channel = ?").get(id, ch) as Record<string, unknown> | undefined;

describe("auto-post fallback: the claim in the book", () => {
  const cand = (id: number, state: ChannelState, error: string | null): ManualCand => ({ item: item({ id }), channel: "threads", post: post("threads", state, { item_id: id, error }), at: T, key: manualKey(id, "threads", T) });
  const none = (id: number, channel: ManualCand["channel"] = "linkedin"): ManualCand => ({ item: item({ id }), channel, post: null, at: T, key: manualKey(id, channel, T) });

  it("takes a failed row of an approved item once (blocked + HQ's claim), never an unapproved one, and gives it back unchanged", () => {
    const b = bookDb();
    const c = cand(7, "failed", "chưa đăng nhập");
    expect(claimRow(b, c, CLAIM, T)).toBe(true);
    expect(rowOf(b, 7, "threads")).toMatchObject({ state: "blocked", error: CLAIM, updated_at: T });
    expect(isHqClaim(rowOf(b, 7, "threads") as Pick<ChannelPost, "state" | "error">)).toBe(true);
    // Claimed already: not again, by this claim or another room's.
    expect(claimRow(b, c, CLAIM, T)).toBe(false);
    expect(claimRow(b, c, hqClaimNote("core", T + MIN), T + MIN)).toBe(false);
    releaseRow(b, c, CLAIM, T + MIN);
    expect(rowOf(b, 7, "threads")).toMatchObject({ state: "failed", error: "chưa đăng nhập" });
    expect(claimRow(b, cand(8, "blocked", "x"), CLAIM, T)).toBe(false);
    expect(rowOf(b, 8, "threads")).toMatchObject({ state: "blocked", error: "x" });
  });

  it("does not give back a row the room or someone else moved on after the claim", () => {
    const b = bookDb();
    const c = cand(7, "failed", "chưa đăng nhập");
    claimRow(b, c, CLAIM, T);
    b.exec("UPDATE content_channel_posts SET state = 'published', error = NULL WHERE item_id = 7");
    releaseRow(b, c, CLAIM, T + MIN);
    expect(rowOf(b, 7, "threads")).toMatchObject({ state: "published", error: null });
  });

  it("a missing row: inserted blocked with HQ's claim once, only for an approved item", () => {
    const b = bookDb();
    expect(claimRow(b, none(7), CLAIM, T + MIN)).toBe(true);
    expect(rowOf(b, 7, "linkedin")).toEqual({ state: "blocked", error: CLAIM, scheduled_for: T, updated_at: T + MIN, attempts: 0 });
    expect(claimRow(b, none(7), CLAIM, T + 2 * MIN)).toBe(false);
    expect(rowOf(b, 7, "linkedin")).toMatchObject({ updated_at: T + MIN });
    expect(claimRow(b, none(8), CLAIM, T)).toBe(false);
    expect(rowOf(b, 8, "linkedin")).toBeUndefined();
    expect(claimRow(b, none(9), CLAIM, T)).toBe(false);
  });

  it("releasing an inserted claim deletes only that row, and only while it still carries the claim", () => {
    const b = bookDb();
    claimRow(b, none(7), CLAIM, T);
    releaseRow(b, none(7), CLAIM, T + MIN);
    expect(rowOf(b, 7, "linkedin")).toBeUndefined();
    expect(rowOf(b, 7, "threads")).toMatchObject({ state: "failed" });
    // The room wrote its result first: kept.
    claimRow(b, none(7), CLAIM, T);
    b.exec("UPDATE content_channel_posts SET state = 'published', error = NULL WHERE item_id = 7 AND channel = 'linkedin'");
    releaseRow(b, none(7), CLAIM, T + MIN);
    expect(rowOf(b, 7, "linkedin")).toMatchObject({ state: "published" });
    // Another claim's row (other room, other minute): kept.
    const c = none(7, "youtube");
    claimRow(b, c, hqClaimNote("core", T), T);
    releaseRow(b, c, CLAIM, T + MIN);
    expect(rowOf(b, 7, "youtube")).toMatchObject({ state: "blocked", error: hqClaimNote("core", T) });
  });

  it("the sheet shows a claimed row as handed over, from the record or else from the row, never to a guest's eyes by name; nothing once unapproved", () => {
    const claimed = item({ channel_posts: [post("facebook", "scheduled"), post("threads", "blocked", { error: CLAIM, scheduled_for: T, updated_at: T })] });
    const state = { dispatched: { [manualKey(7, "threads", T)]: { room: "mkt · cpa", at: T - MIN } }, noroom: {} };
    expect(manualStatuses(claimed, state, cfg, T + MIN)).toEqual({ threads: { kind: "dispatched", room: "mkt · cpa", at: T - MIN } });
    expect(manualStatuses(claimed, state, cfg, T + MIN, true)).toEqual({ threads: { kind: "dispatched", room: null, at: T - MIN } });
    // The state file lost: still handed over, from the claim on the row.
    expect(manualStatuses(claimed, { dispatched: {}, noroom: {} }, cfg, T + MIN)).toEqual({ threads: { kind: "dispatched", room: "cpa-live", at: T } });
    expect(manualStatuses({ ...claimed, status: "checked" }, state, cfg, T + MIN)).toBeUndefined();
  });
});
