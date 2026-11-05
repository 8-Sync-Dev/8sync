// The end-of-day numbers task (owner 2026-11-05): once the day's last scheduled post is DIGEST_DELAY
// old, HQ sends ONE message to the room that keeps the content book, asking it to read each post's
// numbers (ego profile "8sync FB") into Nội dung › Tổng quan. Strictly once per day: the day's row is
// written before the send (INSERT OR IGNORE), so a restart, a second tick or a second HQ cannot repeat it.
// No live room yet (machine asleep, room closed): nothing is written and the next tick tries again;
// a day that was never sent is dropped once a newer day goes out (no backlog burst in the morning).
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dayKey, type ContentItem } from "../content";
import type { FloorRow } from "../floor";
import { isInboxId, inboxLive, queueInbox } from "./inbox";
import { contentConfigPath, contentDbPath, listContent, openContent } from "./content";
import { getDb } from "./db";
import { expand, loadFloor } from "./floor";
import { listArtifacts } from "./artifacts";
import { ompRepoDir } from "./omp-sessions";
import { projectOf } from "./office";
import { ownerMessage } from "./queries";
import { rootKey } from "../preview";

export const DIGEST_EVERY_MS = 5 * 60_000;
export const DIGEST_DELAY_MIN = 120;
/** Room names asked, first live one wins (content-post-agency AGENTS.md: `8sync . cpa-live`, else its core room). */
export const DIGEST_ROOMS = ["cpa-live", "core"];
export const EGO_PROFILE = "8sync FB";

export type DigestConfig = { off: boolean; delayMin: number; rooms: string[] };

/** `digest` in ~/.config/8sync/hq/content.json: `{"off": true}`, `{"delay_min": 90}`, `{"rooms": ["cpa-live"]}`. */
export function digestConfig(file = contentConfigPath()): DigestConfig {
  const d: DigestConfig = { off: false, delayMin: DIGEST_DELAY_MIN, rooms: DIGEST_ROOMS };
  let v: unknown;
  try {
    v = (JSON.parse(fs.readFileSync(file, "utf8")) as { digest?: unknown }).digest;
  } catch {
    return d;
  }
  if (!v || typeof v !== "object") return d;
  const o = v as Record<string, unknown>;
  return {
    off: o.off === true,
    delayMin: typeof o.delay_min === "number" && o.delay_min >= 0 && o.delay_min <= 24 * 60 ? o.delay_min : d.delayMin,
    rooms: Array.isArray(o.rooms) && o.rooms.length && o.rooms.every((r) => typeof r === "string" && r.trim()) ? (o.rooms as string[]).map((r) => r.trim()) : d.rooms,
  };
}

type Item = Pick<ContentItem, "id" | "title" | "format" | "status" | "fb_page" | "fb_post_url" | "scheduled_at">;
export type Due = { day: string; items: Item[]; stale: string[] };

/**
 * The newest day (today or yesterday) whose last scheduled, not rejected post is `delayMs` old and
 * that has no row yet; `stale` = older unsent days the send drops. Null when nothing is due.
 */
export function dueDigest(items: readonly Item[], now: number, delayMs: number, done: ReadonlySet<string>): Due | null {
  const days = [dayKey(now), dayKey(now - 24 * 3600_000)];
  const due: Due[] = [];
  for (const day of days) {
    const of = items.filter((it) => it.scheduled_at != null && it.status !== "rejected" && dayKey(it.scheduled_at) === day);
    if (!of.length || done.has(day)) continue;
    const last = Math.max(...of.map((it) => it.scheduled_at as number));
    if (now >= last + delayMs) due.push({ day, items: of.sort((a, b) => (a.scheduled_at as number) - (b.scheduled_at as number)), stale: [] });
  }
  if (!due.length) return null;
  return { ...due[0], stale: due.slice(1).map((d) => d.day) };
}

/** The room to ask: in `names` order, live, polling its inbox, and working in the content repo. */
export function pickRoom(rows: readonly FloorRow[], repo: string, names: readonly string[], live: (id: string) => boolean = inboxLive): FloorRow | null {
  const key = rootKey(repo);
  const here = rows.filter((r) => {
    if (!r.live || !isInboxId(r.inbox_id) || !live(r.inbox_id) || !r.repo) return false;
    const dir = r.engine === "omp" ? (ompRepoDir(expand(r.repo)) ?? expand(r.repo)) : expand(r.repo);
    return rootKey(projectOf(dir)?.root ?? dir) === key;
  });
  for (const n of names) {
    const hit = here.find((r) => r.name === n || r.title === n);
    if (hit) return hit;
  }
  return null;
}

const hm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

/** The task text. `links`: per item, the result links rooms registered (`hq.mjs artifact add --link`). */
export function digestText(d: Due, links: ReadonlyMap<number, string[]>, repo: string): string {
  const [y, m, dd] = d.day.split("-");
  const lines = d.items.map((it) => {
    const where = it.fb_post_url || links.get(it.id)?.[0] || "chưa có link bài";
    return `- #${it.id} ${hm(it.scheduled_at as number)} ${it.format} (${it.status}${it.fb_page ? `, ${it.fb_page}` : ""}): ${it.title} — ${where}`;
  });
  return [
    `[HQ, việc cuối ngày ${dd}/${m}/${y}, gửi 1 lần] Đọc số liệu các bài đã lên lịch hôm đó và ghi vào Nội dung › Tổng quan.`,
    ...lines,
    "",
    `1. Mở ego-browser profile "${EGO_PROFILE}". Facebook: Meta Business Suite › Nội dung › Đã đăng (latest/posts/published_posts) và Insights. Bài chưa lên thì ghi lại là chưa lên, không đoán số.`,
    `2. Mỗi bài, mỗi nền tảng: node ~/.omp/skills/hq-control/scripts/hq.mjs metrics add --content <id> --platform facebook --url <permalink> --at "<giờ đọc>" --reach N --reactions N --comments N --shares N --views N (số nào không thấy thì bỏ cờ đó; mỗi lần đọc là một dòng mới, không ghi đè).`,
    `3. Ảnh chụp số liệu / bài đã lên: hq.mjs artifact add <file> --content <id,...> --link <permalink> --for <thư mục dự án của trang> (link lên lịch cũ đổi thành permalink: chạy lại artifact add cùng file).`,
    "Không sửa hàng content_items đã approved/published/rejected. Không ghi chữ về nhãn AI vào sheet. Xong thì báo một dòng tổng.",
    `(Sổ nội dung: ${repo})`,
  ].join("\n");
}

type Result = { sent: string; session: string } | { skipped: string } | null;

export type DigestDeps = { content: () => { items: Item[]; repo: string } | null; floor: () => Promise<FloorRow[]>; cfg: DigestConfig };

/** The content book's items and the repo it lives in, or null when none is configured / readable. */
function loadContent(): { items: Item[]; repo: string } | null {
  const dbPath = contentDbPath();
  if (!dbPath || "error" in dbPath) return null;
  const c = openContent();
  if (!("db" in c)) return null;
  const dir = path.dirname(dbPath.path);
  return { items: listContent(c.db).items, repo: projectOf(dir)?.root ?? dir };
}

/** One tick. Exported for the test; the timer calls it every DIGEST_EVERY_MS. */
export async function digestTick(db: DatabaseSync, now = Date.now(), deps: Partial<DigestDeps> = {}): Promise<Result> {
  const cfg = deps.cfg ?? digestConfig();
  if (cfg.off) return null;
  const book = (deps.content ?? loadContent)();
  if (!book) return null;
  const done = new Set((db.prepare("SELECT day FROM content_digest").all() as { day: string }[]).map((r) => r.day));
  const due = dueDigest(book.items, now, cfg.delayMin * 60_000, done);
  if (!due) return null;
  const repo = book.repo;
  const room = pickRoom(await (deps.floor ?? (() => loadFloor(db)))(), repo, cfg.rooms);
  if (!room?.inbox_id) return { skipped: `${due.day}: chưa có phòng ${cfg.rooms.join("/")} đang live` };
  // Claim the day first: whoever inserts the row sends; everyone else stops here.
  if (db.prepare("INSERT OR IGNORE INTO content_digest (day, session, status, at) VALUES (?, ?, 'sending', ?)").run(due.day, room.inbox_id, now).changes !== 1) return null;
  for (const s of due.stale) db.prepare("INSERT OR IGNORE INTO content_digest (day, session, status, at) VALUES (?, NULL, 'skipped', ?)").run(s, now);
  const links = new Map<number, string[]>();
  for (const it of due.items) {
    const l = listArtifacts(db, { content: it.id, limit: 20 }).flatMap((a) => (a.link ? [a.link] : []));
    if (l.length) links.set(it.id, l);
  }
  const text = digestText(due, links, repo);
  queueInbox(room.inbox_id, text, now);
  ownerMessage(db, room.inbox_id, text, "inbox");
  db.prepare("UPDATE content_digest SET status = 'sent' WHERE day = ?").run(due.day);
  return { sent: due.day, session: room.inbox_id };
}

const g = globalThis as unknown as { __hqDigest?: { timer: NodeJS.Timeout | null; busy: boolean } };
const S = (g.__hqDigest ??= { timer: null, busy: false });

async function tick(): Promise<void> {
  if (S.busy) return;
  S.busy = true;
  try {
    const r = await digestTick(getDb());
    if (r && "sent" in r) console.log(`[hq] content digest ${r.sent} → ${r.session}`);
  } catch (e) {
    console.error("[hq] content digest", e);
  } finally {
    S.busy = false;
  }
}

/** Server start (instrumentation.ts): first look a minute in (8sync ls warm), then every DIGEST_EVERY_MS. */
export function startContentDigest(): void {
  if (S.timer) return;
  const first = setTimeout(() => void tick(), 60_000);
  first.unref?.();
  S.timer = setInterval(() => void tick(), DIGEST_EVERY_MS);
  S.timer.unref?.();
}
