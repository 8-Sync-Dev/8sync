// Numbers a room read off a published post (Nội dung › Tổng quan). Every reading is kept (lib/server/
// content-metrics.ts); the view shows each post's newest reading per platform and sums those.
// Shared by the server and the view: the row shape and pure helpers.

import type { Artifact } from "./artifacts";

export const METRIC_FIELDS = ["reach", "reactions", "comments", "shares", "views"] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

export const METRIC_LABEL: Record<MetricField, string> = {
  reach: "Tiếp cận",
  reactions: "Cảm xúc",
  comments: "Bình luận",
  shares: "Chia sẻ",
  views: "Lượt xem",
};

export type MetricRow = {
  id: number;
  content_id: number;
  /** "facebook", "tiktok", "youtube"…: lower case, as the room wrote it. */
  platform: string;
  url: string | null;
  /** When the numbers were read (ms), not when HQ stored them. */
  captured_at: number;
  session: string | null;
  /** How many readings this post has on this platform (the row is the newest). */
  readings: number;
} & Record<MetricField, number | null>;

/** The end-of-day task HQ sent (or dropped) for one day. */
export type DigestRow = { day: string; session: string | null; status: "sending" | "sent" | "skipped"; at: number };

/** `GET /api/content/results`: what the rooms reported back for the content book (owner only). */
export type ContentResults = { artifacts: Artifact[]; metrics: MetricRow[]; digest: DigestRow[]; at: number };

export const PLATFORM_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export const PLATFORM_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", threads: "Threads", linkedin: "LinkedIn", x: "X", zalo: "Zalo" };
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p;

export type PlatformTotal = { platform: string; posts: number; last: number } & Record<MetricField, number | null>;

/**
 * One line per platform: how many posts have a reading and the sum of each field over their newest
 * reading. A field no post reported stays null ("—"), not 0: unread is not zero.
 * `keep` narrows to the posts in view (a date range); `latest` holds one row per post and platform.
 */
export function totalsByPlatform(latest: readonly MetricRow[], keep: (r: MetricRow) => boolean = () => true): PlatformTotal[] {
  const by = new Map<string, PlatformTotal>();
  for (const r of latest) {
    if (!keep(r)) continue;
    let t = by.get(r.platform);
    if (!t) {
      t = { platform: r.platform, posts: 0, last: 0, reach: null, reactions: null, comments: null, shares: null, views: null };
      by.set(r.platform, t);
    }
    t.posts++;
    t.last = Math.max(t.last, r.captured_at);
    for (const f of METRIC_FIELDS) {
      const v = r[f];
      if (v !== null) t[f] = (t[f] ?? 0) + v;
    }
  }
  return [...by.values()].sort((a, b) => b.posts - a.posts || a.platform.localeCompare(b.platform));
}

/** 12 345 → "12,3K"; null → "—". */
export function shortNumber(n: number | null): string {
  if (n === null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(".", ",").replace(/,0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(".", ",").replace(/,0$/, "")}M`;
}
