// The media of a content item (`media_path`: one file or a folder of them) for the "Nội dung" sheet:
// which files can be shown. Only paths already in the DB are read; nothing comes from a request.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ContentMedia } from "../content";
import { fileSecret, safeEqual } from "./auth";
import { mediaSecretPath } from "./paths";

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

export type MediaFile = Omit<ContentMedia, "url"> & { path: string; type: string };

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
    out.push({ index: out.length, name: path.basename(file), kind: t.kind, size, path: file, type: t.type });
    if (out.length === MEDIA_MAX) break;
  }
  return out;
}

/**
 * The view's half of a file (no local path) plus its signed URL. `<video src>`, `<img src>` and the
 * "Tải" link are plain browser requests that cannot send `x-hq-token`, so the URL carries its own lock:
 * an HMAC over item, index, name, size and expiry (like the play links). The expiry is the next full
 * hour + 11 h, so the URL stays the same for an hour and a list poll never reloads a playing video.
 */
export function publicMedia(item: number, { index, name, kind, size }: MediaFile, now = Date.now()): ContentMedia {
  const hour = 3600_000;
  const exp = Math.ceil(now / hour) * hour + MEDIA_LINK_MS - hour;
  const q = new URLSearchParams({ id: String(item), i: String(index), n: name, s: String(size), e: String(exp), sig: mediaSig(item, index, name, size, exp) });
  return { index, name, kind, size, url: `/api/content/media?${q}` };
}

/** How long a media URL stays good: a sheet left open past that just needs a reload. */
export const MEDIA_LINK_MS = 12 * 3600_000;
const SIG_HEX = /^[0-9a-f]{64}$/;

export function mediaSig(item: number, index: number, name: string, size: number, exp: number, secret = fileSecret(mediaSecretPath())): string {
  return crypto.createHmac("sha256", secret).update(JSON.stringify([item, index, name, size, exp])).digest("hex");
}

/** True for a signature of exactly these values, not expired, at most MEDIA_LINK_MS ahead; constant-time compare. */
export function mediaSigValid(sig: string, item: number, index: number, name: string, size: number, exp: number, now = Date.now()): boolean {
  if (!SIG_HEX.test(sig) || !Number.isSafeInteger(exp) || exp <= now || exp > now + MEDIA_LINK_MS) return false;
  return safeEqual(sig, mediaSig(item, index, name, size, exp));
}
