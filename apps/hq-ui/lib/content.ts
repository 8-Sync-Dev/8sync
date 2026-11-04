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
  // Migration 0064 (content-ai): absent on an older DB. The API hands them parsed (the DB keeps JSON text).
  /** Where the item goes; the DB defaults to Facebook only. */
  channels?: Channel[];
  /** Per-channel caption the owner wrote; a channel without one reads its section of `caption` (`captionFor`). */
  captions_json?: Captions | null;
  /** The owner's AI choice when approving: true = the worker turns on the platform's AI disclosure. */
  ai_label?: boolean;
};

/**
 * A file under `media_path` the view can show. `url` is a signed, expiring GET /api/content/media URL
 * (lib/server/content-media.ts publicMedia) the browser streams directly: Range for the player, `&dl=1`
 * for "Tải". No size cap: nothing is held whole in the page or the server.
 */
export type ContentMedia = {
  index: number;
  name: string;
  kind: "image" | "video";
  size: number;
  /** Why the file reads as AI-made (C2PA / IPTC), null = no mark found. */
  ai: string | null;
  url: string;
};

/** One row of the list: the DB row plus what HQ read from its media, and (0064) how each channel went. */
export type ContentRow = ContentItem & { media: ContentMedia[]; channel_posts?: ChannelPost[] };

// ── Channels (migration 0064): one item, scheduled on each platform's own scheduler by content-ai ──

export const CHANNELS = ["facebook", "linkedin", "threads", "youtube"] as const;
export type Channel = (typeof CHANNELS)[number];
export type Captions = Partial<Record<Channel, string>>;

export const CHANNEL_LABEL: Record<Channel, string> = { facebook: "Facebook", linkedin: "LinkedIn", threads: "Threads", youtube: "YouTube" };
/** The list row's compact form ("FB · LI · TH"). */
export const CHANNEL_SHORT: Record<Channel, string> = { facebook: "FB", linkedin: "LI", threads: "TH", youtube: "YT" };
/** Caption limits in characters (code points); YouTube's is the description, its title is the item title. */
export const CAPTION_LIMIT: Record<Channel, number> = { facebook: 63206, linkedin: 3000, threads: 500, youtube: 5000 };
export const YOUTUBE_TITLE_LIMIT = 100;

export const CHANNEL_STATES = ["scheduling", "scheduled", "published", "failed", "blocked", "cancelled"] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];
/** States the worker never retries on its own: HQ "Thử lại" deletes the row so the next pass plans it again. */
export const RETRYABLE_STATES: readonly ChannelState[] = ["failed", "blocked", "cancelled"];

/** A row of `content_channel_posts`; no row = the channel waits for the worker. */
export type ChannelPost = {
  item_id: number;
  channel: Channel;
  state: ChannelState;
  scheduled_for: number | null;
  permalink: string | null;
  published_at: number | null;
  error: string | null;
  attempts: number;
  updated_at: number;
};

export const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);

/** What a channel write answers on a DB before migration 0064. */
export const NO_CHANNELS = "DB chưa có migration 0064 (kênh đăng): mở app content-ai một lần để chạy migration.";

/** Characters as the platforms count them (code points, so an emoji is one). */
export const charCount = (s: string) => [...s].length;

const SECTION = /^===\s*([A-Za-z]+)\b[^\n]*===\s*$/;
const SECTION_CHANNEL: Record<string, Channel> = { FACEBOOK: "facebook", LINKEDIN: "linkedin", THREADS: "threads", YOUTUBE: "youtube" };

/**
 * The per-channel sections of a shared caption: a whole line `=== WORD ... ===` opens a section,
 * WORD names the channel (other words open a section that is dropped). Bodies are trimmed; an empty
 * body is no caption; the first section of a channel wins. `headers: false` = plain text, no sections.
 */
export function parseSections(caption: string): { headers: boolean; sections: Captions } {
  const sections: Captions = {};
  let headers = false;
  let open: Channel | null | undefined;
  let body: string[] = [];
  const close = () => {
    const text = body.join("\n").trim();
    if (open && text && sections[open] === undefined) sections[open] = text;
  };
  for (const line of caption.split("\n")) {
    const m = SECTION.exec(line);
    if (!m) {
      body.push(line);
      continue;
    }
    if (headers) close();
    headers = true;
    open = SECTION_CHANNEL[m[1].toUpperCase()] ?? null;
    body = [];
  }
  if (headers) close();
  return { headers, sections };
}

/**
 * The text a channel posts: the owner's own caption for it, else its section of `caption`, else (a
 * caption with no sections at all) the whole caption for Facebook only. Null = nothing to post.
 */
export function captionFor(it: Pick<ContentItem, "caption" | "captions_json">, ch: Channel): string | null {
  const own = it.captions_json?.[ch]?.trim();
  if (own) return own;
  if (!it.caption) return null;
  const { headers, sections } = parseSections(it.caption);
  if (sections[ch]) return sections[ch];
  if (!headers && ch === "facebook") return it.caption.trim() || null;
  return null;
}

const VIDEO_PATH = /\.(mp4|mov|webm)$/i;

/**
 * Why the item cannot be approved for its channels (contract 0064): every channel needs a caption
 * within its limit; YouTube needs a video file as `media_path` and a title. `media`, when given, is
 * what HQ found on disk (a missing file is no video). Null = fine, or a DB without 0064.
 */
export function channelGate(it: Pick<ContentItem, "title" | "caption" | "captions_json" | "channels" | "media_path"> & { media?: Pick<ContentMedia, "kind">[] }): string | null {
  if (it.channels === undefined) return null;
  if (it.channels.length === 0) return "Chưa chọn kênh đăng";
  const why: string[] = [];
  for (const ch of it.channels) {
    const text = captionFor(it, ch);
    if (text == null) why.push(`Thiếu caption ${CHANNEL_LABEL[ch]}`);
    else if (charCount(text) > CAPTION_LIMIT[ch]) why.push(`${CHANNEL_LABEL[ch]} quá ${CAPTION_LIMIT[ch]} ký tự`);
  }
  if (it.channels.includes("youtube")) {
    const video = !!it.media_path && VIDEO_PATH.test(it.media_path) && (it.media === undefined || it.media.some((m) => m.kind === "video"));
    const title = it.title.trim();
    if (!video || !title) why.push("YouTube cần video (.mp4, .mov, .webm) và tiêu đề");
    else if (charCount(title) > YOUTUBE_TITLE_LIMIT) why.push(`Tiêu đề YouTube quá ${YOUTUBE_TITLE_LIMIT} ký tự`);
  }
  return why.length ? why.join("; ") : null;
}

/** "HH:mm dd/MM" local. */
export const stampOf = (ms: number) => {
  const d = new Date(ms);
  return `${timeOf(ms)} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

/** How one channel of an item stands, in words; `retry` = HQ may delete the row ("Thử lại"). */
export type ChannelLine = { text: string; tone: "muted" | "busy" | "ok" | "bad"; link: string | null; retry: boolean };

export function channelLine(it: Pick<ContentItem, "status" | "scheduled_at">, post: ChannelPost | undefined): ChannelLine {
  const line = (text: string, tone: ChannelLine["tone"], link: string | null = null, retry = false): ChannelLine => ({ text, tone, link, retry });
  if (!post) {
    if (it.status === "published") return line("Chưa đăng kênh này", "muted");
    if (it.status !== "approved") return line("Chưa duyệt", "muted");
    if (it.scheduled_at == null) return line("Chưa có giờ đăng", "muted");
    return line("Chờ tới lượt đăng", "muted");
  }
  switch (post.state) {
    case "scheduling":
      return line("Đang lên lịch", "busy");
    case "scheduled":
      return line(post.scheduled_for != null ? `Đã lên lịch ${stampOf(post.scheduled_for)}` : "Đã lên lịch", "ok");
    case "published":
      return line(post.published_at != null ? `Đã đăng ${stampOf(post.published_at)}` : "Đã đăng", "ok", post.permalink);
    case "failed":
      return line(`Lỗi: ${post.error ?? "không rõ"}`, "bad", null, true);
    case "blocked":
      return line(`Bị chặn: ${post.error ?? "không rõ"}`, "bad", null, true);
    case "cancelled":
      return line("Đã huỷ lịch", "muted");
  }
}

/** Text fields the owner edits in place (status, approval and the `*_at` stamps go through their own actions). */
export const CONTENT_TEXT_FIELDS = ["title", "brief", "caption", "media_path", "fb_page", "source_url", "check_note", "news_url", "fb_post_url"] as const;
export type ContentTextField = (typeof CONTENT_TEXT_FIELDS)[number];

/** GET /api/content. `configured: false` = no DB path set (the view is hidden); `ready: false` = path set but no registry in it. */
export type ContentList =
  | { configured: false }
  | { configured: true; ready: false; error: string }
  | {
      configured: true;
      ready: true;
      items: ContentRow[];
      pages: string[];
      /** Migration 0063 is in: schedule + assignee columns exist. */
      schedule: boolean;
      /** The session "Duyệt" sends the posting task to unless the owner picks another (saved server-side). */
      assign: AssignPref | null;
    };

/** The default session for approve+send: an omp room id or Claude session id, and its label as the owner saw it. */
export type AssignPref = { session: string; base: string | null };

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
 * Why a 1-tap step would only meet a refusal: the DB trigger's (0062: approved needs an approved
 * source and a check time, published also needs the news and Facebook links), then, entering
 * approved on a 0064 DB, the channel rule HQ enforces (`channelGate`). Null = the step can go.
 */
export function stepHint(
  it: Pick<ContentItem, "source_approved_at" | "checked_at" | "news_url" | "fb_post_url"> &
    Partial<Pick<ContentItem, "title" | "caption" | "captions_json" | "channels" | "media_path">> & { media?: Pick<ContentMedia, "kind">[] },
  s: ContentStatus,
): string | null {
  if (s !== "approved" && s !== "published") return null;
  if (it.source_approved_at == null) return "Duyệt nguồn trước";
  if (it.checked_at == null) return "Mục chưa ghi giờ check (checked_at trống)";
  if (s === "published" && (!it.news_url || !it.fb_post_url)) return "Điền link tin news và bài FB trước";
  if (s === "approved" && it.channels !== undefined)
    return channelGate({ title: it.title ?? "", caption: it.caption ?? null, captions_json: it.captions_json ?? null, channels: it.channels, media_path: it.media_path ?? null, media: it.media });
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
 * Why an item may come out as AI-made (owner rule 2026-11-04, revised the same day: a course video
 * with a cloned voice or lip-sync MAY be posted, but with the platform's AI disclosure turned on):
 * an AI video by format; any video (a lip-synced face or a cloned voice leaves no mark in the file);
 * media carrying a C2PA manifest / an IPTC AI source type. Approving it needs the owner's explicit
 * choice, sent as `ai_label` (true = turn the AI label on). Null = nothing to choose.
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

/** The two answers to `aiReason`, in the order the sheet lists them; the value is `ai_label`. */
export const AI_CHOICES: readonly { value: boolean; label: string }[] = [
  { value: true, label: "Có AI (giọng clone, lip-sync, ảnh AI): bật nhãn AI khi đăng" },
  { value: false, label: "Không dùng AI" },
];

/** Full local stamp "HH:mm dd/MM/yyyy". */
export const fullStampOf = (ms: number) => `${stampOf(ms)}/${new Date(ms).getFullYear()}`;

/**
 * The task "Duyệt" sends to the chosen session: the AssignBox line naming the item, what to post
 * where and when, each channel's caption, then how to schedule it. Without migration 0064 the item
 * goes to Facebook with its caption. `cap` shortens each caption (the worker reads the full ones
 * from the DB); null = whole.
 */
export function publishTaskText(it: ContentItem, aiLabel: boolean, cap: number | null = null): string {
  const channels = it.channels ?? (["facebook"] as Channel[]);
  const caption = (ch: Channel) => {
    const text = (it.channels ? captionFor(it, ch) : it.caption) ?? "(chưa có caption)";
    const n = charCount(text);
    return cap != null && n > cap ? `${[...text].slice(0, cap).join("")}\n[cắt bớt: đủ ${n} ký tự trong DB]` : text;
  };
  const lines = [
    `Đã duyệt, lên lịch đăng bài này.`,
    `Định dạng: ${FORMAT_LABEL[it.format]}`,
    `Giờ đăng: ${it.scheduled_at != null ? `${fullStampOf(it.scheduled_at)} (${it.scheduled_at})` : "chưa có"}`,
    `Kênh: ${channels.map((c) => CHANNEL_LABEL[c]).join(", ")}`,
    `Nhãn AI: ${aiLabel ? "BẬT khi đăng" : "không"}`,
    `Media: ${it.media_path || "chưa có"}`,
    ...channels.flatMap((c) => [`--- ${CHANNEL_LABEL[c]} ---`, caption(c)]),
    `Lên lịch: trong content-post-agency chạy \`pnpm --dir apps/content-ai channels:tick --only ${it.id}\` (worker lên lịch native qua ego-browser) rồi kiểm trạng thái từng kênh trong HQ.`,
  ];
  return contentTaskText(it, lines.join("\n"));
}

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

/**
 * The chips a calendar cell shows and how many go behind its "+N" (which opens the day's sheet).
 * One extra item shows as a chip: a "+1" line would take the same room.
 */
export function capDay<T>(items: T[], max: number): { shown: T[]; more: number } {
  return items.length <= max + 1 ? { shown: items, more: 0 } : { shown: items.slice(0, max), more: items.length - max };
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
