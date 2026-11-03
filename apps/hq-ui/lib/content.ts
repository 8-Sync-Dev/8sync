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
};

/** Text fields the owner edits in place (status, approval and the `*_at` stamps go through their own actions). */
export const CONTENT_TEXT_FIELDS = ["title", "brief", "caption", "media_path", "fb_page", "source_url", "check_note", "news_url", "fb_post_url"] as const;
export type ContentTextField = (typeof CONTENT_TEXT_FIELDS)[number];

/** GET /api/content. `configured: false` = no DB path set (the view is hidden); `ready: false` = path set but no registry in it. */
export type ContentList =
  | { configured: false }
  | { configured: true; ready: false; error: string }
  | { configured: true; ready: true; items: ContentItem[]; pages: string[] };

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
