// Nội dung › Tổng quan: the numbers a room read off a published post (`hq.mjs metrics add`). Stored in
// HQ's SQLite, not the content DB: that one belongs to content-post-agency and HQ adds no tables to it.
// A reading is never overwritten (numbers move by the hour); the view takes the newest per post+platform.
import type { DatabaseSync } from "node:sqlite";
import { METRIC_FIELDS, PLATFORM_RE, type MetricField, type MetricRow } from "../content-metrics";
import { isRoomRef, LINK_MAX } from "./artifacts";
import { stamp } from "./db";

/** A reading may be dated a little ahead (clock skew), never further. */
const FUTURE_SLACK_MS = 5 * 60_000;
const MAX_COUNT = 1e12;

export type MetricInput = Partial<Record<"content_id" | "platform" | "url" | "at" | "session" | MetricField, unknown>>;
export type MetricResult = { ok: true; metric: MetricRow } | { ok: false; status: number; error: string };

/** ms since epoch from a number or an ISO / "2026-11-05 21:30" string; null when it is not a time. */
export function timeOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (/^\d{10,13}$/.test(s)) return Number(s.length === 10 ? `${s}000` : s);
  const t = Date.parse(s.includes("T") || !/^\d{4}-\d{2}-\d{2} /.test(s) ? s : s.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

export function addMetric(db: DatabaseSync, input: MetricInput, now = Date.now()): MetricResult {
  const fail = (status: number, error: string): MetricResult => ({ ok: false, status, error });
  const id = typeof input.content_id === "string" && /^\d{1,12}$/.test(input.content_id) ? Number(input.content_id) : input.content_id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return fail(422, "content_id: id bài trong Nội dung");
  const platform = typeof input.platform === "string" ? input.platform.trim().toLowerCase() : "";
  if (!PLATFORM_RE.test(platform)) return fail(422, "platform: tên nền tảng chữ thường, vd facebook, tiktok, youtube");
  let url: string | null = null;
  if (input.url !== undefined && input.url !== null && input.url !== "") {
    let ok = false;
    try {
      ok = typeof input.url === "string" && input.url.length <= LINK_MAX && new URL(input.url).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) return fail(422, "url: link https của bài");
    url = (input.url as string).trim();
  }
  const at = input.at === undefined || input.at === null || input.at === "" ? now : timeOf(input.at);
  if (at === null) return fail(422, "at: giờ đọc số (ISO, \"2026-11-05 21:30\" hoặc ms)");
  if (at > now + FUTURE_SLACK_MS) return fail(422, "at: giờ đọc số ở tương lai");
  const nums = {} as Record<MetricField, number | null>;
  for (const f of METRIC_FIELDS) {
    const raw = input[f];
    if (raw === undefined || raw === null || raw === "") {
      nums[f] = null;
      continue;
    }
    const n = typeof raw === "string" && /^\d{1,13}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > MAX_COUNT) return fail(422, `${f}: số nguyên ≥ 0`);
    nums[f] = n;
  }
  if (METRIC_FIELDS.every((f) => nums[f] === null)) return fail(422, `cần ít nhất một số: ${METRIC_FIELDS.join(", ")}`);
  if (input.session !== undefined && input.session !== null && !isRoomRef(input.session)) return fail(422, "session: Claude session id, omp-<16hex> hoặc hq-<tên>");
  const session = isRoomRef(input.session) ? input.session : null;
  const r = db
    .prepare(
      `INSERT INTO content_metrics (content_id, platform, url, captured_at, reach, reactions, comments, shares, views, session, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, platform, url, at, nums.reach, nums.reactions, nums.comments, nums.shares, nums.views, session, stamp());
  const metric = latestMetrics(db, { content: id }).find((m) => m.platform === platform);
  // The newest row is this one unless an older-dated reading came in late: then the newer stays shown.
  return { ok: true, metric: metric ?? ({ id: Number(r.lastInsertRowid), content_id: id, platform, url, captured_at: at, session, readings: 1, ...nums } as MetricRow) };
}

/**
 * The newest reading of each post on each platform (ties on time: the later stored), with how many
 * readings it has. A url given once stays known: the newest non-null one is used.
 */
export function latestMetrics(db: DatabaseSync, opts: { content?: number | null } = {}): MetricRow[] {
  const where = opts.content ? "WHERE content_id = ?" : "";
  const args = opts.content ? [opts.content] : [];
  return db
    .prepare(
      `WITH ranked AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY content_id, platform ORDER BY captured_at DESC, id DESC) AS rn,
                COUNT(*) OVER (PARTITION BY content_id, platform) AS readings,
                FIRST_VALUE(url) OVER (PARTITION BY content_id, platform ORDER BY (url IS NULL), captured_at DESC, id DESC) AS any_url
         FROM content_metrics ${where}
       )
       SELECT id, content_id, platform, any_url AS url, captured_at, reach, reactions, comments, shares, views, session, readings
       FROM ranked WHERE rn = 1 ORDER BY captured_at DESC`,
    )
    .all(...args) as MetricRow[];
}
