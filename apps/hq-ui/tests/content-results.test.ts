import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as metricsGet, POST as metricsPost } from "@/app/api/content/metrics/route";
import { totalsByPlatform, shortNumber, type MetricRow } from "@/lib/content-metrics";
import type { FloorRow } from "@/lib/floor";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { digestConfig, digestTick, dueDigest, pickRoom, type DigestConfig } from "@/lib/server/content-digest";
import { inboxDir, inboxFile } from "@/lib/server/inbox";
import { ORIGIN, req } from "./helpers";

const add = (body: unknown) => metricsPost(req("/api/content/metrics", { method: "POST", token: getToken(), origin: ORIGIN, body }));
const latest = async (q = "") => ((await (await metricsGet(req(`/api/content/metrics${q}`, { token: getToken() }))).json()) as { metrics: MetricRow[] }).metrics;

describe("content metrics", () => {
  it("keeps every reading; the newest per post and platform is shown, with the url it ever had", async () => {
    expect((await add({ content_id: 38, platform: "Facebook", url: "https://facebook.com/p/38", at: "2025-11-05 20:00", reach: 100, reactions: 4 })).status).toBe(201);
    expect((await add({ content_id: 38, platform: "facebook", at: "2025-11-05T23:00:00", reach: 250, reactions: 9, comments: 1 })).status).toBe(201);
    // Read late but dated earlier: stored, the 23:00 reading stays the one shown.
    expect((await add({ content_id: 38, platform: "facebook", at: "2025-11-05 21:00", reach: 180 })).status).toBe(201);
    expect((await add({ content_id: 16, platform: "facebook", at: "2025-11-05 23:00", views: 40 })).status).toBe(201);
    const rows = await latest("?content=38");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ content_id: 38, platform: "facebook", reach: 250, reactions: 9, comments: 1, shares: null, readings: 3, url: "https://facebook.com/p/38" });

    const t = totalsByPlatform(await latest());
    expect(t).toEqual([expect.objectContaining({ platform: "facebook", posts: 2, reach: 250, views: 40, shares: null })]);
  });

  it("refuses a reading with no number, a negative count, a future time or a bad platform", async () => {
    expect((await add({ content_id: 38, platform: "facebook" })).status).toBe(422);
    expect((await add({ content_id: 38, platform: "facebook", reach: -1 })).status).toBe(422);
    expect((await add({ content_id: 38, platform: "facebook", reach: 1, at: Date.now() + 3600_000 })).status).toBe(422);
    expect((await add({ content_id: 38, platform: "face book", reach: 1 })).status).toBe(422);
    expect((await add({ content_id: 0, platform: "facebook", reach: 1 })).status).toBe(422);
    expect((await add({ content_id: 38, platform: "facebook", reach: 1, url: "http://x" })).status).toBe(422);
  });

  it("short numbers", () => {
    expect([shortNumber(null), shortNumber(999), shortNumber(1200), shortNumber(12_345), shortNumber(2_000_000)]).toEqual(["—", "999", "1,2K", "12K", "2M"]);
  });
});

const at = (s: string) => new Date(s).getTime();
const item = (id: number, when: string, status = "approved") => ({ id, title: `bài ${id}`, format: "clip", status, fb_page: "8syncdev", fb_post_url: null, scheduled_at: at(when) }) as never;

describe("end-of-day digest", () => {
  it("is due only after the day's last non-rejected post plus the delay, newest unsent day first", () => {
    const items = [item(1, "2026-11-05T11:30:00"), item(2, "2026-11-05T21:30:00"), item(3, "2026-11-05T23:50:00", "rejected")];
    const H = 3600_000;
    expect(dueDigest(items, at("2026-11-05T23:00:00"), 2 * H, new Set())).toBeNull();
    expect(dueDigest(items, at("2026-11-05T23:31:00"), 2 * H, new Set())?.items.map((i) => i.id)).toEqual([1, 2]);
    expect(dueDigest(items, at("2026-11-05T23:31:00"), 2 * H, new Set(["2026-11-05"]))).toBeNull();
    // Machine was off all night: the morning after, yesterday is still sent.
    expect(dueDigest(items, at("2026-11-06T09:00:00"), 2 * H, new Set())?.day).toBe("2026-11-05");
    const two = [...items, item(4, "2026-11-06T08:00:00")];
    expect(dueDigest(two, at("2026-11-06T10:30:00"), 2 * H, new Set())).toMatchObject({ day: "2026-11-06", stale: ["2026-11-05"] });
  });

  let repo = "";
  const floor = (rows: Partial<FloorRow>[]) => async () => rows.map((r, i) => ({ id: `r${i}`, name: "x", title: "x", last_active: null, hq: false, live: true, engine: "ccc", ...r }) as FloorRow);
  const cfg: DigestConfig = { off: false, delayMin: 120, rooms: ["cpa-live", "core"] };
  const ROOM = "omp-0123456789abcdef";
  const OTHER = "omp-fedcba9876543210";

  beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-digest-")));
    fs.mkdirSync(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.mkdirSync(inboxDir(), { recursive: true });
    for (const id of [ROOM, OTHER]) fs.writeFileSync(path.join(inboxDir(), `${id}.live`), "");
  });

  it("picks the first named room that is live, polling and in the content repo", () => {
    const rows = [
      { id: "a", name: "core", title: "core", last_active: null, hq: false, live: true, engine: "ccc", inbox_id: OTHER, repo },
      { id: "b", name: "cpa-live", title: "cpa-live", last_active: null, hq: false, live: true, engine: "ccc", inbox_id: ROOM, repo: os.tmpdir() },
    ] as unknown as FloorRow[];
    // cpa-live works elsewhere: core in the content repo answers.
    expect(pickRoom(rows, repo, cfg.rooms)?.inbox_id).toBe(OTHER);
    expect(pickRoom([{ ...rows[0], live: false }], repo, cfg.rooms)).toBeNull();
    expect(pickRoom(rows, repo, cfg.rooms, () => false)).toBeNull();
  });

  it("sends once per day to one live room, waits while none is live, and never repeats", async () => {
    const db = getDb();
    db.exec("DELETE FROM content_digest");
    const items = [item(38, "2026-11-05T11:30:00"), item(16, "2026-11-05T18:00:00")];
    const content = () => ({ items, repo });
    const now = at("2026-11-05T20:30:00");
    expect(await digestTick(db, now, { content, cfg, floor: floor([{ name: "core", inbox_id: ROOM, repo, live: false }]) })).toMatchObject({ skipped: expect.any(String) });
    expect(fs.existsSync(inboxFile(ROOM))).toBe(false);

    const live = floor([{ name: "core", inbox_id: ROOM, repo }]);
    expect(await digestTick(db, now, { content, cfg, floor: live })).toEqual({ sent: "2026-11-05", session: ROOM });
    expect(await digestTick(db, now + 600_000, { content, cfg, floor: live })).toBeNull();
    const lines = fs.readFileSync(inboxFile(ROOM), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const text = (JSON.parse(lines[0]) as { text: string }).text;
    expect(text).toContain("#38 11:30");
    expect(text).toContain('"8sync FB"');
    expect(text).toContain("metrics add --content <id>");

    expect(await digestTick(db, now, { content, cfg: { ...cfg, off: true }, floor: live })).toBeNull();
  });

  it("reads its settings from content.json and falls back on bad values", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hq-dcfg-")), "content.json");
    fs.writeFileSync(f, JSON.stringify({ db: "x", digest: { delay_min: 90, rooms: ["cpa-live"] } }));
    expect(digestConfig(f)).toEqual({ off: false, delayMin: 90, rooms: ["cpa-live"] });
    fs.writeFileSync(f, JSON.stringify({ db: "x", digest: { delay_min: -5, rooms: [], off: "yes" } }));
    expect(digestConfig(f)).toEqual({ off: false, delayMin: 120, rooms: ["cpa-live", "core"] });
  });
});
