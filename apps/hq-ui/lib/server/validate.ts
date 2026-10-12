import fs from "node:fs";
import path from "node:path";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** User-facing session name (without the `hq-` prefix). */
export const SESSION_NAME_RE = /^[a-z0-9-]{1,32}$/;
/** Full tmux session name. The only shape we ever pass to tmux. */
export const TMUX_NAME_RE = /^hq-[a-z0-9-]{1,32}$/;

export function isTmuxName(name: unknown): name is string {
  return typeof name === "string" && TMUX_NAME_RE.test(name);
}

/** Accepts "api" or "hq-api" and returns the tmux name "hq-api". */
export function toTmuxName(input: unknown): Result<string> {
  if (typeof input !== "string") return { ok: false, error: "name must be a string" };
  const bare = input.startsWith("hq-") ? input.slice(3) : input;
  if (!SESSION_NAME_RE.test(bare)) {
    return { ok: false, error: "name: 1-32 chars, lowercase letters, digits or '-'" };
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
 * Channel flags come from the owner's environment, never from a request, but
 * they still end up in a tmux shell command, so only allow a conservative set.
 */
export const CHANNEL_FLAGS_RE = /^[A-Za-z0-9@:/._=, -]*$/;

export function clampText(text: unknown, max = 4000): Result<string> {
  if (typeof text !== "string") return { ok: false, error: "text must be a string" };
  const t = text.trim();
  if (!t) return { ok: false, error: "text is empty" };
  return { ok: true, value: Array.from(t).slice(0, max).join("") };
}
