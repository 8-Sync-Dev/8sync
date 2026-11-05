// Artifacts: files a room made for the owner (a report, a PDF, a demo), registered by path in HQ's
// SQLite (lib/server/artifacts.ts). The bytes stay on the machine; HQ reads them when one is opened.
// Shared by the server and the view: the row shape and pure helpers.

import { rootKey } from "./preview";

export type ArtifactKind = "image" | "video" | "pdf" | "html" | "markdown" | "text";

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

/** Extension → kind and the type it is served with. Anything else is refused at registration. */
export const ARTIFACT_TYPES: Record<string, { kind: ArtifactKind; type: string }> = {
  ".png": { kind: "image", type: "image/png" },
  ".jpg": { kind: "image", type: "image/jpeg" },
  ".jpeg": { kind: "image", type: "image/jpeg" },
  ".webp": { kind: "image", type: "image/webp" },
  ".gif": { kind: "image", type: "image/gif" },
  ".svg": { kind: "image", type: "image/svg+xml" },
  ".mp4": { kind: "video", type: "video/mp4" },
  ".webm": { kind: "video", type: "video/webm" },
  ".pdf": { kind: "pdf", type: "application/pdf" },
  ".html": { kind: "html", type: "text/html; charset=utf-8" },
  ".htm": { kind: "html", type: "text/html; charset=utf-8" },
  ".md": { kind: "markdown", type: "text/markdown; charset=utf-8" },
  ".txt": { kind: "text", type: "text/plain; charset=utf-8" },
  ".log": { kind: "text", type: "text/plain; charset=utf-8" },
  ".json": { kind: "text", type: "application/json; charset=utf-8" },
  ".csv": { kind: "text", type: "text/csv; charset=utf-8" },
  ".tsv": { kind: "text", type: "text/tab-separated-values; charset=utf-8" },
  ".yaml": { kind: "text", type: "text/yaml; charset=utf-8" },
  ".yml": { kind: "text", type: "text/yaml; charset=utf-8" },
  ".toml": { kind: "text", type: "text/plain; charset=utf-8" },
};

/** ".pdf" from "C:\\x\\Báo cáo.PDF". */
export const extOf = (p: string): string => {
  const m = /\.[^.\\/]+$/.exec(p);
  return m ? m[0].toLowerCase() : "";
};

/** "Báo cáo.pdf" from either slash style. */
export const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/** Videos are bigger than the rest; a text file past TEXT_INLINE_MAX is offered as a download only. */
export const ARTIFACT_MAX_BYTES = 30 * 1024 * 1024;
export const ARTIFACT_VIDEO_MAX_BYTES = 60 * 1024 * 1024;
export const TEXT_INLINE_MAX = 2 * 1024 * 1024;
export const maxArtifactBytes = (kind: ArtifactKind): number => (kind === "video" ? ARTIFACT_VIDEO_MAX_BYTES : ARTIFACT_MAX_BYTES);

/** `/api/artifacts/<id>/file`, `?download=1` for an attachment. */
export const artifactFileUrl = (id: string, download = false) => `/api/artifacts/${id}/file${download ? "?download=1" : ""}`;

export const KIND_LABEL: Record<ArtifactKind, string> = {
  image: "Ảnh",
  video: "Video",
  pdf: "PDF",
  html: "HTML",
  markdown: "Markdown",
  text: "Văn bản",
};

export type ArtifactGroup = { key: string; root: string; project: string; items: Artifact[] };

/** One block per project root (case/slash-insensitive). `list` comes newest first, so blocks and their items do too. */
export function groupArtifacts(list: Artifact[]): ArtifactGroup[] {
  const by = new Map<string, ArtifactGroup>();
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
