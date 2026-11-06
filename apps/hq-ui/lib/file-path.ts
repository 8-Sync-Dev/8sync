// An inline-code span in a room reply that names one file by its absolute path (owner 2026-11-06: "có path
// file mà sao không open xem được"): the chat turns it into a button that opens the file in HQ's viewer
// (components/hq/path-open.tsx). Pure, tested in tests/file-path.test.ts.

/** Longer than any real path: a code span this long is prose, not a path. */
const PATH_MAX = 1024;

/**
 * The absolute file path `code` is, or null. Windows (`C:\x\a.pdf`, `C:/x/a.pdf`), POSIX (`/x/a.ts`) and
 * home (`~/x/a.md`); spaces inside are kept (a code span is one path). Surrounding quotes/backticks, trailing
 * `.,;:!?)»` and a `:line[:col]` suffix are dropped. The last segment must be a name with an extension that
 * holds a letter, so folders, routes like `/api/files` and versions like `/v1.2` stay plain code. URLs, UNC
 * shares, globs and multi-line spans are refused.
 */
export function absFilePath(code: string): string | null {
  let p = code.trim();
  if (!p || p.length > PATH_MAX || /[\n\r\t\0]/.test(p)) return null;
  p = p.replace(/^["'`‘“]+|["'`’”]+$/g, "").trim();
  p = p.replace(/[.,;:!?)»]+$/, "").replace(/:\d+(?::\d+)?$/, "");
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(p) || /[*?<>|"]/.test(p)) return null;
  if (!/^(?:[A-Za-z]:[\\/]|\/(?!\/)|~[\\/])/.test(p)) return null;
  const { name } = splitFilePath(p);
  // At least one character before the last dot (so `.env` is not "a file with extension env"), and an
  // extension of 1–10 letters/digits with a letter in it.
  return /^\S(?:.*\S)?\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,10}$/.test(name) ? p : null;
}

/** `p` (an absFilePath result) as its folder and file name: `C:\a\b.pdf` → `C:\a` + `b.pdf`, `/b.pdf` → `/` + `b.pdf`. */
export function splitFilePath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const dir = p.slice(0, i);
  // Keep a root's separator: "C:" alone is "the current folder on C", "" is no folder at all.
  return { dir: /^[A-Za-z]:$/.test(dir) || dir === "" || dir === "~" ? p.slice(0, i + 1) : dir, name: p.slice(i + 1) };
}
