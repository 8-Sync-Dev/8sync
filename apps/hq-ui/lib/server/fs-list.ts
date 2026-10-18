// Folder listing for the "@path" picker and the send-time expansion (lib/mention.ts). Names only, never
// file contents. `..` may leave the project on purpose (owner 2026-10-18); the API is behind the HQ token,
// the same trust as the web terminal.
import fs from "node:fs";
import path from "node:path";
import type { Entry } from "../mention";

export const LIST_MAX = 300;

/** Absolute dir for `rel` under `base` ("" = base itself); null when it is not a readable folder. */
export function resolveDir(base: string, rel: string): string | null {
  if (!path.isAbsolute(base) || rel.length > 1024 || rel.includes("\0") || base.includes("\0")) return null;
  const dir = path.resolve(base, rel || ".");
  try {
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/** Folders first, then files, by name; `.git` hidden; at most LIST_MAX. */
export function listDir(dir: string): Entry[] {
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return names
    .filter((d) => d.name !== ".git")
    .map((d) => {
      let isDir = d.isDirectory();
      if (d.isSymbolicLink()) {
        try {
          isDir = fs.statSync(path.join(dir, d.name)).isDirectory();
        } catch {
          isDir = false;
        }
      }
      return { name: d.name, dir: isDir };
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
    .slice(0, LIST_MAX);
}

/**
 * Each "@rel" that names an existing file or folder under `base` becomes "@<absolute path>" (forward
 * slashes), so a room in a worktree or any cwd opens the same file. Unknown tokens, e-mail addresses
 * and absolute paths stay as typed.
 */
export function expandMentions(text: string, base: string | null): string {
  if (!base || !path.isAbsolute(base)) return text;
  return text.replace(/(^|\s)@([^\s@]+)/g, (all, lead: string, rel: string) => {
    if (path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) return all;
    const clean = rel.replace(/[),.;:!?]+$/, "");
    const abs = path.resolve(base, clean);
    if (!fs.existsSync(abs)) return all;
    return `${lead}@${abs.replace(/\\/g, "/")}${rel.slice(clean.length)}`;
  });
}
