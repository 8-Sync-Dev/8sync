// Files the owner attaches in HQ's composer (owner 2026-10-18: "chắc chắn gửi là đọc được"). Two
// steps: POST /api/uploads stages one file under HQ's state dir; POST /api/targets (every room) or
// POST /api/messages (one room) with `files: [id]` copies each into the repo at
// `.claude/hq-uploads/<id>/<name>` (a `.gitignore` of `*` there, so it is never committed) and appends
// the absolute paths to the text, so the rooms open them with Claude Code's Read tool (images and PDFs included).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MediaKind } from "../attachments";
import { fileSecret, safeEqual } from "./auth";
import { mediaSecretPath, stateDir } from "./paths";

export const UPLOAD_MAX = 10 * 1024 * 1024;
export const FILES_PER_TASK = 5;
const ID = /^[0-9a-f]{32}$/;
const STAGE_TTL_MS = 24 * 3600 * 1000;

export const uploadsDir = () => path.join(stateDir(), "uploads");
export const isUploadId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

/** A file name safe on every OS: base name only, letters/digits/._- kept, no leading dot, ≤ 80 chars. */
export function safeName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = base.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+/, "");
  if (!clean) return "file";
  if (clean.length <= 80) return clean;
  const ext = path.extname(clean).slice(0, 12);
  return clean.slice(0, 80 - ext.length) + ext;
}

/** Stage one file; drops staged files older than a day. */
export function saveUpload(name: string, bytes: Buffer, dir = uploadsDir(), now = Date.now()): { id: string; name: string; size: number } {
  if (bytes.length === 0) throw new Error("file rỗng");
  if (bytes.length > UPLOAD_MAX) throw new Error(`file quá ${UPLOAD_MAX / 1024 / 1024} MB`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const old of fs.readdirSync(dir)) {
    const p = path.join(dir, old);
    try {
      if (ID.test(old) && now - fs.statSync(p).mtimeMs > STAGE_TTL_MS) fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* another request removed it */
    }
  }
  const id = crypto.randomBytes(16).toString("hex");
  const n = safeName(name);
  fs.mkdirSync(path.join(dir, id), { mode: 0o700 });
  fs.writeFileSync(path.join(dir, id, n), bytes, { mode: 0o600 });
  return { id, name: n, size: bytes.length };
}

/**
 * Copy staged files into `<root>/.claude/hq-uploads/`; returns their absolute paths. An id already
 * placed in this repo (a retried send) is reused, not copied again. Throws on an unknown id.
 */
export function placeUploads(ids: string[], root: string, dir = uploadsDir()): string[] {
  if (ids.length === 0) return [];
  const base = path.join(root, ".claude", "hq-uploads");
  fs.mkdirSync(base, { recursive: true });
  const ignore = path.join(base, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "# HQ attachments: local only\n*\n");
  return ids.map((id) => {
    if (!ID.test(id)) throw new Error("file đính kèm không hợp lệ");
    const to = path.join(base, id);
    const placed = fs.existsSync(to) ? fs.readdirSync(to)[0] : undefined;
    if (placed) return path.join(to, placed);
    const src = path.join(dir, id);
    const name = fs.existsSync(src) ? fs.readdirSync(src)[0] : undefined;
    if (!name) throw new Error("file đính kèm đã hết hạn, đính kèm lại");
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(path.join(src, name), path.join(to, name));
    return path.join(to, name);
  });
}

/** The task text with the attachment paths under it, one per line. */
export function withFiles(text: string, paths: string[]): string {
  if (paths.length === 0) return text;
  return `${text}\n\nFile đính kèm (mở bằng Read trước khi làm):\n${paths.map((p) => `- ${p}`).join("\n")}`;
}

/**
 * Types the file route serves inline, so `<img>`, `<video>` and `<audio>` play them. Anything else
 * (an .html or .svg included) goes out as `application/octet-stream` and always as a download, so no
 * attachment ever renders as a page on HQ's origin.
 */
const INLINE_TYPES: Record<string, { type: string; kind: MediaKind }> = {
  ".png": { type: "image/png", kind: "image" },
  ".jpg": { type: "image/jpeg", kind: "image" },
  ".jpeg": { type: "image/jpeg", kind: "image" },
  ".webp": { type: "image/webp", kind: "image" },
  ".gif": { type: "image/gif", kind: "image" },
  ".mp4": { type: "video/mp4", kind: "video" },
  ".webm": { type: "video/webm", kind: "video" },
  ".mov": { type: "video/quicktime", kind: "video" },
  ".mp3": { type: "audio/mpeg", kind: "audio" },
  ".m4a": { type: "audio/mp4", kind: "audio" },
  ".wav": { type: "audio/wav", kind: "audio" },
  ".ogg": { type: "audio/ogg", kind: "audio" },
};

export type FoundUpload = { path: string; name: string; type: string; kind: MediaKind; size: number };

/**
 * The file an upload id names: the staged copy (composer, before sending) or the copy placed in one of
 * `roots` (`<root>/.claude/hq-uploads/<id>/`). Only the id picks the folder; the file inside is whatever
 * `saveUpload` wrote there. Null for a bad id or an unknown id.
 */
export function findUpload(id: unknown, roots: string[], dir = uploadsDir()): FoundUpload | null {
  if (!isUploadId(id)) return null;
  for (const base of [dir, ...roots.map((r) => path.join(r, ".claude", "hq-uploads"))]) {
    const folder = path.join(base, id);
    let name: string | undefined;
    try {
      name = fs.readdirSync(folder)[0];
    } catch {
      continue;
    }
    if (!name) continue;
    const known = INLINE_TYPES[path.extname(name).toLowerCase()] ?? { type: "application/octet-stream", kind: "file" as const };
    const p = path.join(folder, name);
    const st = fs.statSync(p);
    return st.isFile() ? { path: p, name, ...known, size: st.size } : null;
  }
  return null;
}

/** How long an upload URL stays good: a chat left open past that just needs a reload. */
export const UPLOAD_LINK_MS = 12 * 3600_000;
const SIG_HEX = /^[0-9a-f]{64}$/;

/** HMAC with the content media key; the leading "upload" keeps it apart from a content media signature. */
export function uploadSig(id: string, exp: number, secret = fileSecret(mediaSecretPath())): string {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(["upload", id, exp])).digest("hex");
}

/**
 * The file URL of `id` that works without `x-hq-token`: `<video src>` and the "Tải" link are plain
 * browser requests that cannot send the header (like publicMedia). The expiry is the next full hour
 * + 11 h, so the URL stays the same for an hour and a re-render never reloads a playing video.
 */
export function uploadLink(id: string, now = Date.now()): string {
  const hour = 3600_000;
  const exp = Math.ceil(now / hour) * hour + UPLOAD_LINK_MS - hour;
  return `/api/uploads/${id}/file?${new URLSearchParams({ e: String(exp), sig: uploadSig(id, exp) })}`;
}

/** True for a signature of exactly this id and expiry, not expired, at most UPLOAD_LINK_MS ahead; constant-time compare. */
export function uploadSigValid(sig: string, id: string, exp: number, now = Date.now()): boolean {
  if (!SIG_HEX.test(sig) || !Number.isSafeInteger(exp) || exp <= now || exp > now + UPLOAD_LINK_MS) return false;
  return safeEqual(sig, uploadSig(id, exp));
}
