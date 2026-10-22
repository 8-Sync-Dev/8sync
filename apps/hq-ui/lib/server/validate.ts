import fs from "node:fs";
import path from "node:path";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** User-facing session name (without the `hq-` prefix). */
export const SESSION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Full tmux session name. The only shape we ever pass to tmux. */
export const TMUX_NAME_RE = /^hq-[a-z0-9][a-z0-9-]{0,31}$/;

export function isTmuxName(name: unknown): name is string {
  return typeof name === "string" && TMUX_NAME_RE.test(name);
}

/** Accepts "api" or "hq-api" and returns the tmux name "hq-api". */
export function toTmuxName(input: unknown): Result<string> {
  if (typeof input !== "string") return { ok: false, error: "name must be a string" };
  const bare = input.startsWith("hq-") ? input.slice(3) : input;
  if (!SESSION_NAME_RE.test(bare)) {
    return { ok: false, error: "name: 1-32 chars: lowercase letters, digits or '-'" };
  }
  return { ok: true, value: `hq-${bare}` };
}

/**
 * A project path must be absolute, contain no `..` segment, and resolve to an
 * existing directory. Returns the canonical (realpath) form.
 */
export function validateProjectPath(input: unknown): Result<string> {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, error: "path is required" };
  }
  const p = input.trim();
  if (p.length > 4096 || p.includes("\0")) return { ok: false, error: "path is invalid" };
  if (!path.isAbsolute(p)) return { ok: false, error: "path must be absolute" };
  if (p.split(/[\\/]+/).includes("..")) return { ok: false, error: "path must not contain '..'" };
  let real: string;
  try {
    real = fs.realpathSync(p);
  } catch {
    return { ok: false, error: "path does not exist" };
  }
  try {
    if (!fs.statSync(real).isDirectory()) return { ok: false, error: "path is not a directory" };
  } catch {
    return { ok: false, error: "path is not readable" };
  }
  return { ok: true, value: real };
}

/**
 * Channel flags come from the owner's environment, never from a request. They
 * are passed as argv (no shell), but stay conservative anyway.
 */
export const CHANNEL_FLAGS_RE = /^[A-Za-z0-9@:/._=,~ -]*$/;

/** C0 controls except \t and \n, DEL, and C1 (U+0080-U+009F). Includes ESC, so `ESC[201~` too. */
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
const PASTE_END = "\x1b[201~";

/** Owner text typed into a pane must not carry keys or terminal escapes (it could end a bracketed paste early). */
export function hasControlChars(text: string): boolean {
  return CONTROL_RE.test(text) || text.includes(PASTE_END);
}

export function clampText(text: unknown, max = 4000, allowControls = false): Result<string> {
  if (typeof text !== "string") return { ok: false, error: "text must be a string" };
  // CRLF from a browser textarea is just a newline; normalise before the control check.
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return { ok: false, error: "text is empty" };
  if (!allowControls && hasControlChars(t)) return { ok: false, error: "text must not contain control characters" };
  return { ok: true, value: Array.from(t).slice(0, max).join("") };
}

/**
 * A folder to create for a new project (owner 2026-10-22: "không có nút tạo dự án"): absolute, no
 * "..", not a drive or filesystem root, not there yet (or an empty folder), under an existing parent.
 * Returns the normalized path; creating it is the caller's job.
 */
export function validateNewProjectPath(input: unknown): Result<string> {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, error: "path is required" };
  const p = path.normalize(input.trim()).replace(/[\\/]+$/, "");
  if (p.length > 4096 || p.includes("\0")) return { ok: false, error: "path is invalid" };
  if (!path.isAbsolute(p)) return { ok: false, error: "path must be absolute" };
  if (input.split(/[\\/]+/).includes("..")) return { ok: false, error: "path must not contain '..'" };
  if (path.dirname(p) === p || /^[a-zA-Z]:$/.test(p)) return { ok: false, error: "không tạo dự án ở gốc ổ đĩa" };
  if (fs.existsSync(p)) {
    try {
      if (!fs.statSync(p).isDirectory()) return { ok: false, error: "path is a file" };
      if (fs.readdirSync(p).length > 0) return { ok: false, error: "thư mục đã có và không trống: dùng “Thêm thư mục có sẵn”" };
    } catch {
      return { ok: false, error: "path is not readable" };
    }
  }
  let parent = path.dirname(p);
  while (!fs.existsSync(parent)) {
    const up = path.dirname(parent);
    if (up === parent) return { ok: false, error: "không có thư mục cha nào tồn tại" };
    parent = up;
  }
  if (!fs.statSync(parent).isDirectory()) return { ok: false, error: "thư mục cha là một file" };
  return { ok: true, value: p };
}
