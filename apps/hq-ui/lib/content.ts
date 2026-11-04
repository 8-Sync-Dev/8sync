// "Nội dung" view: the content registry of content-post-agency (`content_items`, its migration 0062).
// Pure rules shared by the API (lib/server/content.ts) and the view (components/hq/content-view.tsx).
// The publish gate itself lives in that DB's triggers, not here.

export const CONTENT_FORMATS = ["text", "infographic", "course_video", "ai_video", "asmr", "clip", "other"] as const;
export const CONTENT_STATUSES = ["ordered", "drafted", "checked", "approved", "published", "rejected"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const FORMAT_LABEL: Record<ContentFormat, string> = {
  text: "Bài thường",
  infographic: "Infographic",
  course_video: "Video khoá học",
  ai_video: "AI video",
  asmr: "ASMR",
  clip: "Clip",
  other: "Khác",
};

export const STATUS_LABEL: Record<ContentStatus, string> = {
  ordered: "Đã đặt",
  drafted: "Đã soạn",
  checked: "Đã check",
  approved: "Đã duyệt",
  published: "Đã đăng",
  rejected: "Bỏ",
};

export type ContentItem = {
  id: number;
  format: ContentFormat;
  title: string;
  brief: string | null;
  caption: string | null;
  media_path: string | null;
  fb_page: string;
  source_url: string | null;
  source_approved_by: string | null;
  source_approved_at: number | null;
  check_note: string | null;
  checked_at: number | null;
  news_url: string | null;
  fb_post_url: string | null;
  published_at: number | null;
  status: ContentStatus;
  created_at: number;
  updated_at: number;
  // Migration 0063 (content-ai): absent on an older DB (`schedule: false` in the list).
  /** Planned post time, ms. */
  scheduled_at?: number | null;
  /** The HQ session holding the work (omp room id or Claude session id), saved when a task is sent. */
  assignee_session?: string | null;
  /** Its label as the owner saw it, e.g. "core · su-code". */
  assignee_base?: string | null;
  assigned_at?: number | null;
};

/** A file under `media_path` the view can show (served by GET /api/content/media). */
export type ContentMedia = { index: number; name: string; kind: "image" | "video"; size: number; /** Why the file reads as AI-made (C2PA / IPTC), null = no mark found. */ ai: string | null };

/** One row of the list: the DB row plus what HQ read from its media. */
export type ContentRow = ContentItem & { media: ContentMedia[] };

/** Text fields the owner edits in place (status, approval and the `*_at` stamps go through their own actions). */
export const CONTENT_TEXT_FIELDS = ["title", "brief", "caption", "media_path", "fb_page", "source_url", "check_note", "news_url", "fb_post_url"] as const;
export type ContentTextField = (typeof CONTENT_TEXT_FIELDS)[number];

/** GET /api/content. `configured: false` = no DB path set (the view is hidden); `ready: false` = path set but no registry in it. */
export type ContentList =
  | { configured: false }
  | { configured: true; ready: false; error: string }
  | { configured: true; ready: true; items: ContentRow[]; pages: string[]; /** Migration 0063 is in: schedule + assignee columns exist. */ schedule: boolean };

/** What the calendar and the sheet say when the DB predates migration 0063. */
export const NO_SCHEDULE = "DB nội dung chưa có cột lịch đăng (migration 0063): mở app content-ai một lần để chạy migration.";

export const isFormat = (v: unknown): v is ContentFormat => typeof v === "string" && (CONTENT_FORMATS as readonly string[]).includes(v);
export const isStatus = (v: unknown): v is ContentStatus => typeof v === "string" && (CONTENT_STATUSES as readonly string[]).includes(v);

const FLOW: readonly ContentStatus[] = ["ordered", "drafted", "checked", "approved", "published"];

/** The status buttons on a row: the next step of the flow, then "Bỏ"; a rejected item can be reopened. */
export function nextStatuses(s: ContentStatus): ContentStatus[] {
  if (s === "rejected") return ["ordered"];
  const i = FLOW.indexOf(s);
  const next = FLOW[i + 1];
  return s === "published" ? [] : next ? [next, "rejected"] : ["rejected"];
}

/**
 * Why a 1-tap step would only meet the DB trigger's refusal (0062: approved needs an approved
 * source, published also needs the news and Facebook links). Null = the step can go.
 */
export function stepHint(it: Pick<ContentItem, "source_approved_at" | "news_url" | "fb_post_url">, s: ContentStatus): string | null {
  if (s !== "approved" && s !== "published") return null;
  if (it.source_approved_at == null) return "Duyệt nguồn trước";
  if (s === "published" && (!it.news_url || !it.fb_post_url)) return "Điền link tin news và bài FB trước";
  return null;
}

/** The red flag on a row: a post is on Facebook but the item misses what the gate asks of it. Null = fine. */
export function contentWarning(it: Pick<ContentItem, "fb_post_url" | "news_url" | "source_approved_at" | "source_url">): string | null {
  if (!it.fb_post_url) return null;
  const miss: string[] = [];
  if (!it.news_url) miss.push("thiếu tin news");
  if (!it.source_url) miss.push("thiếu nguồn");
  else if (it.source_approved_at == null) miss.push("nguồn chưa duyệt");
  return miss.length ? `Đã có bài FB nhưng ${miss.join(", ")}` : null;
}

/** The message the "Gửi task" box sends: which item, then what the owner typed. */
export function contentTaskText(it: Pick<ContentItem, "id" | "title" | "fb_page">, typed: string): string {
  return `[Nội dung #${it.id} · ${it.fb_page}] ${it.title}\n${typed.trim()}`;
}

/** Formats that are video: the course pipeline's lip-synced presenter and cloned voice carry no C2PA mark, yet Meta labelled reel 1.2 "AI". */
const VIDEO_FORMATS: readonly ContentFormat[] = ["course_video", "ai_video", "asmr", "clip"];

/**
 * Why an item may come out on Facebook as "AI info" (owner rule 2026-11-04: no post may carry Meta's
 * AI label): an AI video by format; any video (a lip-synced face or a cloned voice leaves no mark in
 * the file, so "no mark" is not "safe"); media carrying a C2PA manifest / an IPTC AI source type.
 * Approving it needs the reviewer's "không dùng hình/giọng AI photoreal" tick. Null = nothing to check.
 */
export function aiReason(it: Pick<ContentItem, "format"> & { media?: Pick<ContentMedia, "name" | "ai" | "kind">[] }): string | null {
  const why: string[] = [];
  const media = it.media ?? [];
  if (it.format === "ai_video") why.push("định dạng AI video");
  else if (VIDEO_FORMATS.includes(it.format) || media.some((m) => m.kind === "video"))
    why.push("video: mặt lip-sync hay giọng clone không để lại dấu trong file, phải nghe/xem lại");
  for (const m of media) if (m.ai) why.push(`${m.name}: ${m.ai}`);
  return why.length ? why.join("; ") : null;
}

/** The text a reviewer ticks before approving an item `aiReason` flags; sent as `no_ai_confirmed: true`. */
export const NO_AI_CONFIRM = "Tôi đã xem: bài không dùng hình/giọng AI photoreal (không để Meta gắn nhãn \"AI info\").";

// ── Calendar (local time: the owner plans posts by the wall clock of this machine) ──

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of a moment, local time. */
export function dayKey(d: Date | number): string {
  const x = typeof d === "number" ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** Local midnight of a "YYYY-MM-DD", or null when it is not one. */
export function parseDay(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d) === s ? d : null;
}

/** When an item sits on the calendar: its planned time, else when it went out; null = not on it. */
export const whenOf = (it: Pick<ContentItem, "scheduled_at" | "published_at">): number | null => it.scheduled_at ?? it.published_at ?? null;

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Monday of the week holding `d` (Vietnamese weeks start on Thứ Hai). */
export const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

/** The 6 × 7 days a month view shows: Monday of the first week, 42 days on. */
export function monthGrid(year: number, month: number): Date[] {
  const first = weekStart(new Date(year, month, 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export type CalendarMode = "day" | "week" | "month" | "year";

/** The cursor one step back (-1) or on (+1) in a mode. */
export function stepCursor(d: Date, mode: CalendarMode, dir: -1 | 1): Date {
  if (mode === "day") return addDays(d, dir);
  if (mode === "week") return addDays(d, 7 * dir);
  if (mode === "month") return new Date(d.getFullYear(), d.getMonth() + dir, 1);
  return new Date(d.getFullYear() + dir, 0, 1);
}

/** Items by local day key, each day sorted by time. Items with no time are left out. */
export function byDay<T extends Pick<ContentItem, "id" | "scheduled_at" | "published_at">>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const at = whenOf(it);
    if (at == null) continue;
    const k = dayKey(at);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  for (const list of out.values()) list.sort((a, b) => whenOf(a)! - whenOf(b)! || a.id - b.id);
  return out;
}

/** "HH:mm" local. */
export const timeOf = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The value of an `<input type="datetime-local">` for a moment, and back (local time). */
export const toLocalInput = (ms: number) => `${dayKey(ms)}T${timeOf(ms)}`;
export function fromLocalInput(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
