// Artifacts: files a room made for the owner (a report, a PDF, a demo), registered by path in HQ's
// SQLite (lib/server/artifacts.ts). The bytes stay on the machine; HQ reads them when one is opened.
// Shared by the server and the view: the row shape and pure helpers.

import { rootKey } from "./preview";

export type ArtifactKind = "image" | "video" | "audio" | "pdf" | "office" | "html" | "markdown" | "text";

export type Artifact = {
  /** 32 hex, random; the only handle the file route takes. */
  id: string;
  /** Absolute path as the OS spells it. */
  path: string;
  /** Git root (or known project folder) the file sits in. */
  root: string;
  project: string;
  branch: string | null;
  /** The room that registered it (Claude session id, omp room id or hq-* name), when it said so. */
  session: string | null;
  title: string;
  note: string | null;
  kind: ArtifactKind;
  /** Content items (Nội dung `content_items.id`) this file is the result of: shown in their sheet. */
  content: number[];
  /** An https page the result lives at (the Meta scheduled post, later the permalink). */
  link: string | null;
  /** The project the file is about when it is not the repo it sits in (`--for`); groups it there. */
  for_root: string | null;
  for_project: string | null;
  created_at: number;
  /** Last registration; a re-register of the same path moves it to the top. */
  updated_at: number;
  /** Live from the file system on each list: gone → `missing`, size/mtime null. */
  missing: boolean;
  size: number | null;
  mtime: number | null;
};

/** What the list route hands the view: the row plus `src`, a signed URL `<video>`, `<audio>`, `<img>` and "Tải về" load without the token header. */
export type ArtifactView = Artifact & { src: string };

/** Claude session id, omp room id or hq-* name: what /api/messages addresses and `--session` takes. */
const ROOM_REF = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|omp-[0-9a-f]{16}|hq-[a-z0-9][a-z0-9-]{0,31})$/i;
export const isRoomRef = (v: unknown): v is string => typeof v === "string" && ROOM_REF.test(v);
/** `?session=` values one list takes: a room's names (hq name, Claude session id), never a long list. */
export const SESSION_PARAMS_MAX = 4;

/** The names a room may have registered its artifacts under, each once, only the ones `--session` takes. */
export const roomRefs = (room: { name: string; session_id: string | null }): string[] => [...new Set([room.name, room.session_id])].filter(isRoomRef);

const text = "text/plain; charset=utf-8";
/** Source code and config: shown as text, always served as text/plain (never run, never rendered as XML/HTML). */
const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".rb", ".php", ".swift", ".sh", ".ps1", ".bat", ".sql", ".xml", ".css", ".scss", ".ini", ".cfg", ".conf", ".diff", ".patch", ".srt", ".vtt"];

/**
 * Extension → kind and the type it is served with. Anything else is refused at registration. SVG is an
 * image shown through `<img>` (no script runs there) and served with a CSP sandbox (lib/server/artifacts.ts).
 */
export const ARTIFACT_TYPES: Record<string, { kind: ArtifactKind; type: string }> = {
  ".png": { kind: "image", type: "image/png" },
  ".jpg": { kind: "image", type: "image/jpeg" },
  ".jpeg": { kind: "image", type: "image/jpeg" },
  ".webp": { kind: "image", type: "image/webp" },
  ".gif": { kind: "image", type: "image/gif" },
  ".avif": { kind: "image", type: "image/avif" },
  ".bmp": { kind: "image", type: "image/bmp" },
  ".ico": { kind: "image", type: "image/x-icon" },
  ".svg": { kind: "image", type: "image/svg+xml" },
  ".mp4": { kind: "video", type: "video/mp4" },
  ".m4v": { kind: "video", type: "video/mp4" },
  ".webm": { kind: "video", type: "video/webm" },
  ".mov": { kind: "video", type: "video/quicktime" },
  ".mkv": { kind: "video", type: "video/x-matroska" },
  ".ogv": { kind: "video", type: "video/ogg" },
  ".mp3": { kind: "audio", type: "audio/mpeg" },
  ".wav": { kind: "audio", type: "audio/wav" },
  ".ogg": { kind: "audio", type: "audio/ogg" },
  ".oga": { kind: "audio", type: "audio/ogg" },
  ".opus": { kind: "audio", type: "audio/ogg" },
  ".m4a": { kind: "audio", type: "audio/mp4" },
  ".flac": { kind: "audio", type: "audio/flac" },
  ".aac": { kind: "audio", type: "audio/aac" },
  ".weba": { kind: "audio", type: "audio/webm" },
  ".pdf": { kind: "pdf", type: "application/pdf" },
  ".docx": { kind: "office", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ".xlsx": { kind: "office", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ".pptx": { kind: "office", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  ".doc": { kind: "office", type: "application/msword" },
  ".xls": { kind: "office", type: "application/vnd.ms-excel" },
  ".ppt": { kind: "office", type: "application/vnd.ms-powerpoint" },
  ".odt": { kind: "office", type: "application/vnd.oasis.opendocument.text" },
  ".ods": { kind: "office", type: "application/vnd.oasis.opendocument.spreadsheet" },
  ".odp": { kind: "office", type: "application/vnd.oasis.opendocument.presentation" },
  ".html": { kind: "html", type: "text/html; charset=utf-8" },
  ".htm": { kind: "html", type: "text/html; charset=utf-8" },
  ".md": { kind: "markdown", type: "text/markdown; charset=utf-8" },
  ".txt": { kind: "text", type: text },
  ".log": { kind: "text", type: text },
  ".json": { kind: "text", type: "application/json; charset=utf-8" },
  ".csv": { kind: "text", type: "text/csv; charset=utf-8" },
  ".tsv": { kind: "text", type: "text/tab-separated-values; charset=utf-8" },
  ".yaml": { kind: "text", type: "text/yaml; charset=utf-8" },
  ".yml": { kind: "text", type: "text/yaml; charset=utf-8" },
  ".toml": { kind: "text", type: text },
  ...Object.fromEntries(CODE_EXTS.map((e) => [e, { kind: "text" as const, type: text }])),
};

/** Kind and served type of a file by its extension (case-insensitive), or null when HQ does not show it. */
export const fileType = (p: string): { kind: ArtifactKind; type: string } | null => ARTIFACT_TYPES[extOf(p)] ?? null;

/** Which Office family a file is: what the preview parses it as. Old binary formats (doc/xls/ppt) only convert through LibreOffice. */
export type OfficeFamily = "doc" | "sheet" | "slides";
const OFFICE_FAMILY: Record<string, OfficeFamily> = { ".docx": "doc", ".doc": "doc", ".odt": "doc", ".xlsx": "sheet", ".xls": "sheet", ".ods": "sheet", ".pptx": "slides", ".ppt": "slides", ".odp": "slides" };
export const officeFamily = (p: string): OfficeFamily | null => OFFICE_FAMILY[extOf(p)] ?? null;
/** The zip-based formats the browser can read itself when LibreOffice is not installed. */
export const officeReadable = (p: string): boolean => [".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"].includes(extOf(p));

/** ".pdf" from "C:\\x\\Báo cáo.PDF". */
export const extOf = (p: string): string => {
  const m = /\.[^.\\/]+$/.exec(p);
  return m ? m[0].toLowerCase() : "";
};

/** "Báo cáo.pdf" from either slash style. */
export const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/** Media streams with Range (no whole-file fetch), so it may be big; a text file past TEXT_INLINE_MAX is offered as a download only. */
export const ARTIFACT_MAX_BYTES = 30 * 1024 * 1024;
export const ARTIFACT_MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const TEXT_INLINE_MAX = 2 * 1024 * 1024;
export const maxArtifactBytes = (kind: ArtifactKind): number => (kind === "video" || kind === "audio" ? ARTIFACT_MEDIA_MAX_BYTES : ARTIFACT_MAX_BYTES);

/** "C:\\x\\out" from "C:\\x\\out\\a.pdf" (either slash style); the path itself when it has no folder part. */
export const dirOf = (p: string): string => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? (i === 2 && /^[A-Za-z]:/.test(p) ? p.slice(0, 3) : p.slice(0, i)) : p;
};

/** `/api/artifacts/<id>/file`, `?download=1` for an attachment. */
export const artifactFileUrl = (id: string, download = false) => `/api/artifacts/${id}/file${download ? "?download=1" : ""}`;

export const KIND_LABEL: Record<ArtifactKind, string> = {
  image: "Ảnh",
  video: "Video",
  audio: "Âm thanh",
  pdf: "PDF",
  office: "Office",
  html: "HTML",
  markdown: "Markdown",
  text: "Văn bản",
};

export type ArtifactGroup<A extends Artifact = Artifact> = { key: string; root: string; project: string; items: A[] };

/** One block per project root (case/slash-insensitive). `list` comes newest first, so blocks and their items do too. */
export function groupArtifacts<A extends Artifact>(list: A[]): ArtifactGroup<A>[] {
  const by = new Map<string, ArtifactGroup<A>>();
  for (const a of list) {
    const root = a.for_root ?? a.root;
    const key = rootKey(root);
    const g = by.get(key);
    if (g) g.items.push(a);
    else by.set(key, { key, root, project: a.for_project ?? a.project, items: [a] });
  }
  return [...by.values()];
}

/** Ids of content items, at most this many per artifact. */
export const CONTENT_LINKS_MAX = 20;

/** "38,16" / [38, 16] / 38 → [16, 38]; null when any part is not a positive id. */
export function parseContentIds(v: unknown): number[] | null {
  const parts = Array.isArray(v) ? v : typeof v === "number" ? [v] : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (!parts || parts.length > CONTENT_LINKS_MAX) return null;
  const out = new Set<number>();
  for (const p of parts) {
    const n = typeof p === "number" ? p : typeof p === "string" && /^\d{1,12}$/.test(p) ? Number(p) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** "Meta Business Suite" for business.facebook.com, else the host: what a link button says. */
export function linkLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
  if (host === "business.facebook.com") return "Meta Business Suite";
  if (host === "facebook.com" || host === "m.facebook.com" || host === "fb.com") return "Facebook";
  return host;
}

/** The link when it is https, else null: the only kind a report button opens. */
export function httpsLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const META_HOSTS: Record<string, true> = { "facebook.com": true, "m.facebook.com": true, "business.facebook.com": true, "fb.com": true, "fb.watch": true, "instagram.com": true, "threads.net": true, "threads.com": true };

/** What a report's open button says: "Mở trên Meta" for Facebook/Instagram/Threads, else "Mở trên <host>". */
export function openLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Mở link";
  }
  return Object.hasOwn(META_HOSTS, host) ? "Mở trên Meta" : `Mở trên ${host}`;
}

/**
 * One posting report in a room's Báo cáo: the files registered for the same post (same `--link`) under
 * the newest one's title, link and note; a file without a link is a report of its own.
 */
export type Report<A extends Artifact = Artifact> = {
  key: string;
  title: string;
  /** Newest registration of any of its files. */
  at: number;
  link: string | null;
  /** The newest note any of its files has. */
  note: string | null;
  /** Content items it reports on, ascending, each once. */
  content: number[];
  /** Images on disk: the proof screenshots. */
  proofs: A[];
  /** Everything else (other kinds, or a file gone from disk). */
  files: A[];
};

/** `list` newest first (as /api/artifacts hands it) → reports newest first. */
export function reportsOf<A extends Artifact>(list: readonly A[]): Report<A>[] {
  const out = new Map<string, Report<A>>();
  for (const a of list) {
    const link = httpsLink(a.link);
    const key = link ? `link:${link}` : `id:${a.id}`;
    let r = out.get(key);
    if (!r) {
      r = { key, title: a.title, at: a.updated_at, link, note: null, content: [], proofs: [], files: [] };
      out.set(key, r);
    }
    r.at = Math.max(r.at, a.updated_at);
    r.note ??= a.note;
    for (const id of a.content) if (!r.content.includes(id)) r.content.push(id);
    (a.kind === "image" && !a.missing ? r.proofs : r.files).push(a);
  }
  return [...out.values()].map((r) => ({ ...r, content: r.content.sort((x, y) => x - y) })).sort((x, y) => y.at - x.at);
}

/**
 * An image in a markdown result may load only from `data:image/…` or HQ's own origin; null for anything
 * else. A remote `![](https://…)` would tell that server the owner opened the file, from where, and when.
 */
export function safeImageSrc(src: unknown, origin: string): string | null {
  if (typeof src !== "string" || !src.trim()) return null;
  const s = src.trim();
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(s)) return s;
  try {
    const u = new URL(s, origin);
    return u.origin === origin && (u.protocol === "http:" || u.protocol === "https:") ? u.href : null;
  } catch {
    return null;
  }
}
