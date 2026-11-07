// A file a room reply names (owner 2026-11-06: "có path file mà sao không open xem được"; 2026-11-07: "xem
// video path file linh hoạt"): an inline-code path, a markdown link to a local file, or a bare file name
// opens in HQ's viewer (components/hq/path-open.tsx). Pure, tested in tests/file-path.test.ts.

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
  const p = cleanRef(code);
  if (!p || !/^(?:[A-Za-z]:[\\/]|\/(?!\/)|~[\\/])/.test(p)) return null;
  return isFileName(splitFilePath(p).name) ? p : null;
}

/** `code` without surrounding quotes, trailing punctuation and a `:line[:col]` suffix; null for prose, URLs and globs. */
function cleanRef(code: string): string | null {
  let p = code.trim();
  if (!p || p.length > PATH_MAX || /[\n\r\t\0]/.test(p)) return null;
  p = p.replace(/^["'`‘“]+|["'`’”]+$/g, "").trim();
  p = p.replace(/[.,;:!?)»]+$/, "").replace(/:\d+(?::\d+)?$/, "");
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(p) || /[*?<>|"]/.test(p)) return null;
  return p || null;
}

/**
 * At least one character before the last dot (so `.env` is not "a file with extension env"), and an
 * extension of 1–10 letters/digits with a letter in it.
 */
const isFileName = (name: string) => /^\S(?:.*\S)?\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,10}$/.test(name);

/**
 * A path relative to the room's folder in a code span: `src/a.ts`, `./out/clip.mp4`, `..\b.md`. It holds a
 * folder and no space (a bare `a.ts` or a phrase stays plain code), and ends in a file name like absFilePath.
 */
export function relFilePath(code: string): string | null {
  const p = cleanRef(code);
  if (!p || /\s/.test(p) || /^(?:[\\/~]|[A-Za-z]:)/.test(p) || !/[\\/]/.test(p)) return null;
  return isFileName(splitFilePath(p).name) ? p : null;
}

/**
 * The local file a markdown link points at, or null for a web link, an anchor or a folder: `file:///C:/x/a%20b.mp4`
 * (decoded), an absolute path, or one relative to the room's folder (`out/clip.mp4`, `clip.mp4`; a `#…` or
 * `?…` tail dropped). Any other scheme (`https:`, `mailto:`) stays a web link.
 */
export function localLinkPath(href: string): string | null {
  let h = href.trim();
  if (!h || h.length > PATH_MAX || /[\n\r\t\0]/.test(h) || /^[#?]|^[\\/]{2}/.test(h)) return null;
  if (/^file:/i.test(h)) {
    // file:///x, file://localhost/x or file:/x: this machine; file://host/x (another machine) has no path here.
    const m = /^file:(?:\/\/(?:localhost)?(?=\/)|(?=\/))(.*)$/i.exec(h);
    if (!m) return null;
    try {
      h = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
    if (/^\/[A-Za-z]:[\\/]/.test(h)) h = h.slice(1);
    return /^[\\/]{2}/.test(h) ? null : absFilePath(h);
  }
  if (/^[a-z][a-z0-9+.-]+:/i.test(h)) return null;
  const abs = absFilePath(h);
  if (abs) return abs;
  if (/^(?:[\\/~]|[A-Za-z]:)/.test(h)) return null;
  const p = h.replace(/[#?].*$/, "");
  return p && !/[*<>|"]/.test(p) && isFileName(splitFilePath(p).name) ? p : null;
}

/**
 * Bare file names in code spans (`clip.mp4`, `report.pdf`): no folder, no space. The chips show one only
 * once it is found under the room's folder, so an unrelated `example.com` never shows up.
 */
export function bareFileNamesIn(text: string, max = 12): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\s\\/]{3,120})`/g)) {
    const p = cleanRef(m[1]);
    if (p && !/[\\/]/.test(p) && isFileName(p) && !out.includes(p) && out.length < max) out.push(p);
  }
  return out;
}

/**
 * What a local file link becomes before the markdown renderer's link hardening (which blocks `C:\…`,
 * `file:` and relative links as unsafe): a same-origin path that never loads anything, which the reply's
 * link component turns back into "open this file in the viewer" (fileLinkPath).
 */
export const FILE_LINK = "/hq-open-file?p=";

/** The file a rewritten link (FILE_LINK) names, or null for any other href. */
export function fileLinkPath(href: string | undefined): string | null {
  if (!href?.startsWith(FILE_LINK)) return null;
  try {
    return decodeURIComponent(href.slice(FILE_LINK.length)) || null;
  } catch {
    return null;
  }
}

type MdNode = { type: string; url?: string; children?: MdNode[] };

/** Remark plugin: every link and link definition to a local file (localLinkPath) points at FILE_LINK instead. */
export function remarkFileLinks() {
  const walk = (n: MdNode) => {
    if ((n.type === "link" || n.type === "definition") && typeof n.url === "string") {
      const p = localLinkPath(n.url);
      if (p) n.url = FILE_LINK + encodeURIComponent(p);
    }
    n.children?.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}

/** `p` (an absFilePath result) as its folder and file name: `C:\a\b.pdf` → `C:\a` + `b.pdf`, `/b.pdf` → `/` + `b.pdf`. */
export function splitFilePath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const dir = p.slice(0, i);
  // Keep a root's separator: "C:" alone is "the current folder on C", "" is no folder at all.
  return { dir: /^[A-Za-z]:$/.test(dir) || dir === "" || dir === "~" ? p.slice(0, i + 1) : dir, name: p.slice(i + 1) };
}
