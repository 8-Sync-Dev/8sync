// The media of a content item (`media_path`: one file or a folder of them) for the "Nội dung" sheet:
// which files can be shown, and whether a file carries an AI mark Meta reads to label a post
// "AI info" (owner rule 2026-11-04). Only paths already in the DB are read; nothing comes from a request.
import fs from "node:fs";
import path from "node:path";
import type { ContentMedia } from "../content";

const TYPES: Record<string, { type: string; kind: ContentMedia["kind"] }> = {
  ".png": { type: "image/png", kind: "image" },
  ".jpg": { type: "image/jpeg", kind: "image" },
  ".jpeg": { type: "image/jpeg", kind: "image" },
  ".webp": { type: "image/webp", kind: "image" },
  ".gif": { type: "image/gif", kind: "image" },
  ".mp4": { type: "video/mp4", kind: "video" },
  ".webm": { type: "video/webm", kind: "video" },
  ".mov": { type: "video/quicktime", kind: "video" },
};
/** Files shown per item (a folder of renders keeps the sheet light). */
export const MEDIA_MAX = 12;
/**
 * Bytes read at each end of a file looking for marks: a C2PA manifest / XMP packet sits in a box or
 * segment at the head (JPEG APP11, PNG before IDAT, MP4 before mdat) or the tail (MP4 after mdat).
 * The list poll scans every file of every item, so a 2 GB render must not be read whole.
 */
const SCAN_WINDOW = 8 * 1024 * 1024;
const CHUNK = 2 * 1024 * 1024;

export type MediaFile = ContentMedia & { path: string; type: string };

/** The media files of `media_path`, in name order; [] when unset, relative, missing or unreadable. */
export function mediaFiles(mediaPath: string | null): MediaFile[] {
  if (!mediaPath || !path.isAbsolute(mediaPath)) return [];
  let st: fs.Stats;
  try {
    st = fs.statSync(mediaPath);
  } catch {
    return [];
  }
  let files: string[];
  if (st.isFile()) files = [mediaPath];
  else if (st.isDirectory()) {
    try {
      files = fs
        .readdirSync(mediaPath, { withFileTypes: true })
        .filter((e) => e.isFile() && TYPES[path.extname(e.name).toLowerCase()])
        .map((e) => path.join(mediaPath, e.name))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  } else return [];
  const out: MediaFile[] = [];
  for (const file of files) {
    const t = TYPES[path.extname(file).toLowerCase()];
    if (!t) continue;
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    out.push({ index: out.length, name: path.basename(file), kind: t.kind, size, ai: aiMark(file), path: file, type: t.type });
    if (out.length === MEDIA_MAX) break;
  }
  return out;
}

/** The view's half of a file (no local path). */
export const publicMedia = ({ index, name, kind, size, ai }: MediaFile): ContentMedia => ({ index, name, kind, size, ai });

// Byte patterns, case-insensitive where the spec spells them in mixed case.
// IPTC digital source type (XMP, or a C2PA assertion): trainedAlgorithmicMedia,
// compositeWithTrainedAlgorithmicMedia, algorithmicMedia all end in "algorithmicmedia".
const IPTC_AI = Buffer.from("algorithmicmedia");
// C2PA (Content Credentials): the claim's JUMBF label; generative tools (OpenAI, Adobe Firefly, Google) write it.
const C2PA = [Buffer.from("c2pa.claim"), Buffer.from("c2pa.actions")];
const LONGEST = Math.max(IPTC_AI.length, ...C2PA.map((b) => b.length));

const cache = new Map<string, { key: string; mark: string | null }>();

/** Why a file reads as AI-made, or null. Cached by size + mtime: a poll never rescans an unchanged file. */
export function aiMark(file: string): string | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cache.get(file);
  if (hit?.key === key) return hit.mark;
  const mark = scan(file, st.size);
  cache.set(file, { key, mark });
  return mark;
}

function scan(file: string, size: number): string | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  const windows: [number, number][] = size <= 2 * SCAN_WINDOW ? [[0, size]] : [[0, SCAN_WINDOW], [size - SCAN_WINDOW, size]];
  const iptcText = IPTC_AI.toString("latin1");
  try {
    const buf = Buffer.alloc(CHUNK + LONGEST);
    for (const [start, end] of windows) {
      let carry = 0;
      for (let pos = start; pos < end; ) {
        const n = fs.readSync(fd, buf, carry, Math.min(CHUNK, end - pos), pos);
        if (n <= 0) break;
        const view = buf.subarray(0, carry + n);
        // First mark wins: either one is enough to flag the file.
        if (view.toString("latin1").toLowerCase().includes(iptcText)) return "media khai nguồn AI (IPTC digitalSourceType)";
        if (C2PA.some((p) => view.includes(p))) return "media có Content Credentials (C2PA), Meta đọc được để gắn nhãn AI";
        // Keep the tail so a pattern split across two reads is still seen.
        carry = Math.min(LONGEST - 1, view.length);
        view.copy(buf, 0, view.length - carry);
        pos += n;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}
