// Files the owner attaches in the "Gửi cho mọi phòng" composer (owner 2026-10-18: "chắc chắn gửi là
// đọc được"). Two steps: POST /api/uploads stages one file under HQ's state dir; POST /api/targets with
// `files: [id]` copies each into the chosen repo at `.claude/hq-uploads/<id>/<name>` (a `.gitignore`
// of `*` there, so it is never committed) and appends the absolute paths to the task, so every room
// opens them with Claude Code's Read tool (images and PDFs included).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./paths";

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

/** Copy staged files into `<root>/.claude/hq-uploads/`; returns their absolute paths. Throws on an unknown id. */
export function placeUploads(ids: string[], root: string, dir = uploadsDir()): string[] {
  if (ids.length === 0) return [];
  const base = path.join(root, ".claude", "hq-uploads");
  fs.mkdirSync(base, { recursive: true });
  const ignore = path.join(base, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "# HQ attachments: local only\n*\n");
  return ids.map((id) => {
    if (!ID.test(id)) throw new Error("file đính kèm không hợp lệ");
    const src = path.join(dir, id);
    const name = fs.existsSync(src) ? fs.readdirSync(src)[0] : undefined;
    if (!name) throw new Error("file đính kèm đã hết hạn, đính kèm lại");
    const to = path.join(base, id);
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
