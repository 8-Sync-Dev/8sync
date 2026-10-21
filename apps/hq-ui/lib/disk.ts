// Pure rules behind "Dung lượng dự án" (Máy tab): which sizes are abnormal and the cleanup message a
// room gets for them. No I/O (lib/server/disk.ts measures). Tested in tests/disk.test.ts.
//
// Owner (2026-10-19): "xem dung lượng các file dự án phình to … phân tích cảnh báo các thứ bất
// thường to … gửi tin nhắn cho phòng để dọn/check/clear/optimize luôn".
import { roomRole } from "./now";
import { leadOf, roomGroups } from "./room-send";
import { isSweepRoom } from "./sweep";

export const MB = 2 ** 20;
export const GB = 2 ** 30;

/** Named thresholds; `high` is the second step of the same rule. */
export const LIMITS = {
  /** A git-tracked file this big bloats every clone. */
  trackedFile: 5 * MB,
  trackedFileHigh: 50 * MB,
  /** Screenshots / UAT evidence in one preview folder. */
  evidence: 20 * MB,
  evidenceHigh: 200 * MB,
  /** `.claude/worktrees`: count, then size. */
  worktrees: 10,
  worktreesBytes: 2 * GB,
  /** Any one folder (top-level entry, .git, node_modules, build output). */
  dir: 1 * GB,
  dirHigh: 10 * GB,
  /** `.claude/hq-uploads/<id>` older than this is a leftover (rooms read attachments right away). */
  uploadsAgeMs: 24 * 3600_000,
} as const;

export type Sized = { path: string; bytes: number };

/** One project's sizes; paths are relative to `root`, with `/`. */
export type ProjectDisk = {
  root: string;
  name: string;
  total: number;
  /** Top-level entries, biggest first. */
  entries: (Sized & { dir: boolean })[];
  git: number | null;
  worktrees: { n: number; bytes: number } | null;
  /** Preview / evidence folders that exist. */
  evidence: Sized[];
  /** Outermost node_modules folders, biggest first. */
  nodeModules: Sized[];
  /** Build output folders (target, .next, dist…), outside node_modules, biggest first. */
  build: Sized[];
  uploads: { n: number; bytes: number; oldest: number | null } | null;
  /** Git-tracked files over LIMITS.trackedFile, biggest first. */
  tracked: Sized[];
  /** The time or entry cap stopped the walk: every size is at least this much. */
  truncated: boolean;
  error: string | null;
  at: number;
  ms: number;
  /** HQ's last auto clean of idle worktree build output (lib/server/disk-clean.ts), kept across scans. */
  cleaned?: Cleaned | null;
  /** Candidate build dirs HQ left because something uses them: never sent to a room to delete. */
  inUse?: string[];
  /** HQ's last removal of idle merged/closed card worktrees (lib/server/disk-clean.ts pruneWorktrees), kept across scans. */
  pruned?: Pruned | null;
  /** Why the card worktrees left after the last pass stayed (null: not evaluated). */
  wtKept?: WtKept | null;
};

/** What one HQ auto clean removed. */
export type Cleaned = { at: number; bytes: number; dirs: string[] };
/** What one HQ worktree prune removed (`names`: folder names under `.claude/worktrees`). */
export type Pruned = { at: number; n: number; names: string[] };
/** The worktrees a prune pass kept, by its first reason; `n`: how many it looked at. */
export type WtKept = { n: number; busy: number; recent: number; open: number; dirty: number; failed: number };
/** A card worktree written this recently belongs to work in progress: left alone. */
export const PRUNE_IDLE_MS = 3600_000;

/** "giữ 5: 2 đang dùng, 3 chưa merge/đóng" for the worktrees finding; "" when nothing was kept. */
export function keptText(k: WtKept): string {
  const why = [
    [k.busy, "đang dùng"],
    [k.recent, "mới sửa"],
    [k.open, "chưa merge/đóng"],
    [k.dirty, "chưa commit"],
    [k.failed, "git không xoá được"],
  ] as const;
  const kept = why.reduce((n, [c]) => n + c, 0);
  return kept ? `giữ ${kept}: ${why.filter(([c]) => c > 0).map(([c, t]) => `${c} ${t}`).join(", ")}` : "";
}

/**
 * Build output HQ removes by itself: `target` / `.next` anywhere in an agent's card worktree
 * (`src-tauri/target`, `apps/web/.next`); the next build makes it again. Group 1: the worktree.
 */
export const AUTO_DIR = /^(\.claude\/worktrees\/[^/]+)\/(?:[^/]+\/)*(?:target|\.next)$/;
/** A build dir written this recently belongs to work in progress: left alone. */
export const AUTO_IDLE_MS = 3600_000;

/** Flagged build dirs (over LIMITS.dir) HQ may remove without asking a room. */
export function autoCandidates(p: Pick<ProjectDisk, "build">): Sized[] {
  return p.build.filter((b) => b.bytes > LIMITS.dir && AUTO_DIR.test(b.path));
}

/** What the cleanup mail lists: the findings minus the build dirs HQ kept because they are in use. */
export function sendable(p: { findings: Finding[]; inUse?: string[] }): Finding[] {
  return p.inUse?.length ? p.findings.filter((f) => !p.inUse!.includes(f.path)) : p.findings;
}

/** The scan result once `gone` (from autoCandidates) is deleted, without walking again. */
export function withoutDirs(p: ProjectDisk, gone: Sized[]): ProjectDisk {
  if (!gone.length) return p;
  const n = gone.reduce((a, g) => a + g.bytes, 0);
  const paths = new Set(gone.map((g) => g.path));
  const less = (v: number) => Math.max(0, v - n);
  return {
    ...p,
    total: less(p.total),
    entries: p.entries.map((e) => (e.path === ".claude" ? { ...e, bytes: less(e.bytes) } : e)),
    worktrees: p.worktrees && { ...p.worktrees, bytes: less(p.worktrees.bytes) },
    build: p.build.filter((b) => !paths.has(b.path)),
  };
}

export type Severity = "high" | "warn";
export type Finding = { id: string; severity: Severity; path: string; bytes: number; why: string };

/** "dưới 1 KB", "512 KB", "12 MB", "3.2 GB". */
export function bytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
  if (n >= MB) return `${Math.round(n / MB)} MB`;
  return n < 1024 ? "dưới 1 KB" : `${Math.round(n / 1024)} KB`;
}

const size = (lim: number, high: number, n: number): Severity | null => (n > high ? "high" : n > lim ? "warn" : null);

/** Every abnormal item of one project, high first, then biggest. */
export function findings(p: ProjectDisk, now: number): Finding[] {
  const out: Finding[] = [];
  for (const t of p.tracked.slice(0, 10)) {
    const s = size(LIMITS.trackedFile, LIMITS.trackedFileHigh, t.bytes);
    if (s) out.push({ id: `tracked:${t.path}`, severity: s, path: t.path, bytes: t.bytes, why: `file đã commit lớn hơn ${bytes(s === "high" ? LIMITS.trackedFileHigh : LIMITS.trackedFile)}` });
  }
  for (const e of p.evidence) {
    const s = size(LIMITS.evidence, LIMITS.evidenceHigh, e.bytes);
    if (s) out.push({ id: `evidence:${e.path}`, severity: s, path: e.path, bytes: e.bytes, why: `ảnh bằng chứng hơn ${bytes(s === "high" ? LIMITS.evidenceHigh : LIMITS.evidence)}` });
  }
  const w = p.worktrees;
  if (w && (w.n > LIMITS.worktrees || w.bytes > LIMITS.worktreesBytes)) {
    const why = [w.n > LIMITS.worktrees && `${w.n} worktree (ngưỡng ${LIMITS.worktrees})`, w.bytes > LIMITS.worktreesBytes && `chiếm hơn ${bytes(LIMITS.worktreesBytes)}`].filter(Boolean).join(", ");
    // What HQ's own prune could not take (pruneWorktrees): the room gets told why, not just "too many".
    const kept = p.wtKept ? keptText(p.wtKept) : "";
    out.push({ id: "worktrees", severity: w.n > 2 * LIMITS.worktrees || w.bytes > 2 * LIMITS.worktreesBytes ? "high" : "warn", path: ".claude/worktrees", bytes: w.bytes, why: kept ? `${why} · HQ ${kept}` : why });
  }
  if (p.uploads && p.uploads.n > 0 && p.uploads.oldest != null && now - p.uploads.oldest > LIMITS.uploadsAgeMs) {
    out.push({ id: "uploads", severity: "warn", path: ".claude/hq-uploads", bytes: p.uploads.bytes, why: `${p.uploads.n} file đính kèm HQ còn sót, cũ hơn 1 ngày` });
  }
  const dirs: Sized[] = [...(p.git != null ? [{ path: ".git", bytes: p.git }] : []), ...p.nodeModules, ...p.build];
  for (const d of dirs) {
    const s = size(LIMITS.dir, LIMITS.dirHigh, d.bytes);
    if (s && !out.some((f) => f.path === d.path)) out.push({ id: `dir:${d.path}`, severity: s, path: d.path, bytes: d.bytes, why: `thư mục hơn ${bytes(s === "high" ? LIMITS.dirHigh : LIMITS.dir)}` });
  }
  // A top-level folder only when nothing flagged inside it already explains most of its size.
  for (const e of p.entries.filter((x) => x.dir)) {
    const s = size(LIMITS.dir, LIMITS.dirHigh, e.bytes);
    const inside = out.filter((f) => f.path === e.path || f.path.startsWith(`${e.path}/`)).reduce((n, f) => n + f.bytes, 0);
    if (s && inside < e.bytes / 2) out.push({ id: `dir:${e.path}`, severity: s, path: e.path, bytes: e.bytes, why: `thư mục hơn ${bytes(s === "high" ? LIMITS.dirHigh : LIMITS.dir)}` });
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.bytes - a.bytes : a.severity === "high" ? -1 : 1));
}

/** Same findings, same fingerprint: the loop sends a set once per day, not every 6 h. */
export const fingerprint = (fs: Finding[]) => fs.map((f) => f.id).sort().join("|");

const MAX_LINES = 12;

/** The prepared message: what was found, what to do, and the rules that keep work safe. */
export function cleanupText(p: Pick<ProjectDisk, "root" | "name" | "truncated">, fs: Finding[]): string {
  const sev = (s: Severity) => (s === "high" ? "cao" : "chú ý");
  const lines = fs.slice(0, MAX_LINES).map((f) => `- [${sev(f.severity)}] ${f.path} ${p.truncated ? "≥ " : ""}${bytes(f.bytes)}: ${f.why}`);
  if (fs.length > MAX_LINES) lines.push(`- và ${fs.length - MAX_LINES} mục nữa`);
  return [
    `Dọn dung lượng dự án ${p.name} (${p.root}). HQ đo thấy:`,
    ...(lines.length ? lines : ["- không có mục nào vượt ngưỡng; kiểm tra nhanh rồi tối ưu nếu thấy chỗ đáng"]),
    "",
    "Kiểm tra từng mục, dọn hoặc tối ưu cái nào đáng, rồi báo lại đã giải phóng bao nhiêu và còn gì để lại vì sao.",
    "Luật:",
    "- Không xoá việc chưa commit hoặc chưa push: xem git status và git log @{u}.. trước; worktree còn thay đổi thì để nguyên.",
    "- Asset hoặc bằng chứng mà dự án ghi là chỉ owner được xoá: hỏi anh bằng AskUserQuestion trước khi xoá.",
    "- File đã commit: ưu tiên git rm (hoặc nén, chuyển sang LFS) trong một commit qua PR; không viết lại lịch sử git.",
    "- Thư mục build (target, .next, node_modules): dọn bằng lệnh của công cụ (cargo clean, xoá rồi cài lại) khi không phòng nào đang build.",
    "- Số HQ báo là phần xoá lấy lại được: node_modules của pnpm/bun là hardlink vào store, xoá gần như không lấy lại chỗ, đừng xoá chỉ để lấy chỗ.",
  ].join("\n");
}

type CleanRoom = Parameters<typeof leadOf>[0][number];

/**
 * One project folder whatever its slashes, case or `\\?\` prefix. Not folded into its repo (unlike
 * preview's rootKey): a worktree with its own rooms is its own project in the sidebar.
 */
export const diskKey = (p: string) =>
  p
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();

/** The room a project's cleanup goes to: its live sweep room (lib/sweep.ts), else its lead, else a dev room, else any room of it. */
export function cleanupRoom<T extends CleanRoom>(rooms: T[], root: string): T | null {
  const rs = projectRooms(rooms, root);
  return rs.find((r) => isSweepRoom(r.label)) ?? leadOf(rs) ?? rs.find((r) => (roomRole(r.label) ?? roomRole(r.name))?.seat === "dev") ?? rs[0] ?? null;
}

/** Rooms of that project a cleanup can go to (the picker). */
export function projectRooms<T extends CleanRoom>(rooms: T[], root: string): T[] {
  return roomGroups(rooms).find((x) => diskKey(x.root) === diskKey(root))?.rooms ?? [];
}
