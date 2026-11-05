// The "Nội dung" view's own preferences, kept by the HQ server (not the browser) so every device
// and every reload sees the same: `~/.config/8sync/hq/content-prefs.json` =
// `{ "assign": { "session": "<omp room id | Claude session id>", "base": "<its label>" } }`,
// the session "Duyệt" sends the posting task to by default (owner 2026-11-04).
import fs from "node:fs";
import path from "node:path";
import type { AssignPref } from "../content";
import { isInboxId } from "./inbox";
import { configDir } from "./paths";

export const contentPrefsPath = () => path.join(configDir(), "content-prefs.json");

const BASE_MAX = 200;

/** An `assign` value: a valid pref, null (none), or undefined when it is not one. */
export function parseAssignPref(v: unknown): AssignPref | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const { session, base } = v as Record<string, unknown>;
  if (!isInboxId(session)) return undefined;
  if (base != null && (typeof base !== "string" || base.length > BASE_MAX)) return undefined;
  return { session, base: typeof base === "string" && base.trim() ? base.trim() : null };
}

function readAll(): Record<string, unknown> {
  try {
    const v = JSON.parse(fs.readFileSync(contentPrefsPath(), "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The saved default session; a missing or unreadable file is none. */
export function readAssignPref(): AssignPref | null {
  return parseAssignPref(readAll().assign) ?? null;
}

/** Save (or with null, forget) the default session; other keys in the file are kept. Write-then-rename. */
export function saveAssignPref(p: AssignPref | null): void {
  const all = readAll();
  if (p) all.assign = p;
  else delete all.assign;
  const file = contentPrefsPath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
