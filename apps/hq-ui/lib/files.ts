// Room "Thư mục" panel (components/hq/files-sheet.tsx): the room's repo as a file tree, a file viewer
// and a small editor. Shared by the routes (app/api/files/**, lib/server/files.ts) and the view.
import type { ArtifactKind } from "./artifacts";

/** Read as text (and shown) up to this size; bigger files are offered as a download. */
export const FILES_TEXT_MAX = 2 * 1024 * 1024;
/** Edited (and saved) up to this size. */
export const FILES_EDIT_MAX = 1024 * 1024;
/** Entries one folder lists at most; the rest is cut (`more`). */
export const FILES_LIST_MAX = 1000;
/** Never listed: version-control internals and dependency/build dumps. */
export const FILES_HIDDEN: Readonly<Record<string, true>> = { ".git": true, node_modules: true, target: true };
export const FILES_CONFLICT = "file vừa đổi trên máy, tải lại";

export type FileEntry = { name: string; dir: boolean; size: number | null; mtime: number | null };
/** GET /api/files: one folder of the tree, `path` relative to `root` with `/` ("" = the root). */
export type DirListing = { root: string; path: string; entries: FileEntry[]; more: boolean };

/** `binary`: no type HQ previews and not readable as UTF-8 text: download only. */
export type FileKind = ArtifactKind | "binary";
/**
 * GET /api/files/file: one file. Text kinds carry `text` and the `hash` (sha256 hex of the bytes on disk)
 * a save must send back; `src` is a signed URL for `<img>`/`<video>`/`<audio>` and "Tải về".
 */
export type FileView = {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  mtime: number;
  src: string;
  /** Present for text kinds within FILES_TEXT_MAX. */
  text?: string;
  hash?: string;
  /** A text file within FILES_EDIT_MAX. */
  editable: boolean;
  /** A text kind past FILES_TEXT_MAX: not shown, download only. */
  big: boolean;
};
/** PUT /api/files/file body. */
export type FileSave = { root: string; path: string; text: string; hash: string };
export type FileSaved = { ok: true; hash: string; mtime: number; size: number };

/** POST /api/files/locate: at most this many paths, each at most FILES_REF_MAX characters. */
export const FILES_LOCATE_MAX = 40;
export const FILES_REF_MAX = 1024;
/** POST /api/files/locate body: paths a room's reply names (absolute, relative to `base`, or a bare name) and the room's folder. */
export type FileLocate = { base: string | null; paths: string[] };
/**
 * Where one named path is, as the viewer opens it (`root` = the file's real folder, `rel` = its name), or
 * why not (404 not there, 403 outside the projects HQ knows or a secret, 422 not a usable path).
 */
export type FileSpot = { path: string; ok: true; root: string; rel: string; kind: FileKind | null; size: number } | { path: string; ok: false; status: number; error: string };
export type FileSpots = { files: FileSpot[] };

const q = (root: string, rel: string) => `root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`;
export const filesListUrl = (root: string, rel: string) => `/api/files?${q(root, rel)}`;
export const filesFileUrl = (root: string, rel: string) => `/api/files/file?${q(root, rel)}`;
export const filesRawUrl = (root: string, rel: string) => `/api/files/raw?${q(root, rel)}`;
export const filesPdfUrl = (root: string, rel: string) => `/api/files/pdf?${q(root, rel)}`;

/** "docs/a.md" from "docs" + "a.md"; the name alone at the root. */
export const relJoin = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/**
 * A link written in a markdown file, resolved against that file's folder: the repo-relative path for a
 * relative link inside the repo ("../README.md#x" from "docs/a.md" → "README.md"); null for an absolute
 * URL, an anchor, or one that climbs out of the root.
 */
export function relLink(fromFile: string, href: string): string | null {
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const clean = decodeSafe(href.replace(/[?#].*$/, ""));
  if (!clean) return null;
  const parts = clean.startsWith("/") ? [] : fromFile.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]}]+/g;

/** `text` cut into plain runs and http(s) URLs (a trailing `.`/`,`/`:`/`;` stays text): what the text view makes clickable. */
export function splitLinks(text: string): (string | { url: string })[] {
  const out: (string | { url: string })[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,:;!?]+$/, "");
    const i = m.index;
    if (i > at) out.push(text.slice(at, i));
    out.push({ url });
    at = i + url.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Folders first, then files; by name, numbers in order, case-insensitive. */
export function sortEntries<T extends { name: string; dir: boolean }>(list: T[]): T[] {
  return list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}
