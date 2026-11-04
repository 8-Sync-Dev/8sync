// A message the composer sent with files carries their absolute paths under the text (lib/server/uploads.ts
// `withFiles`), so the room can `Read` them. HQ shows the image ones as thumbnails: this splits the text
// back into the body and the attachments. Client and server safe (no node imports).

export const ATTACH_HEADER = "File đính kèm (mở bằng Read trước khi làm):";

/** Images the chat renders inline; anything else stays a path line. */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
export const isImageName = (name: string) => IMAGE_EXT.test(name);

export type MediaKind = "image" | "video" | "audio" | "file";
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg)$/i;
/** How the chat shows a file by its name; the same lists the upload route serves inline (lib/server/uploads.ts). */
export const mediaKind = (name: string): MediaKind => (IMAGE_EXT.test(name) ? "image" : VIDEO_EXT.test(name) ? "video" : AUDIO_EXT.test(name) ? "audio" : "file");

/** `1.2 MB`-style size for a file chip. */
export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** An http(s) URL in prose, up to whitespace or a quote/bracket that cannot be part of it. */
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
/** Punctuation that ends a sentence, not the URL (`xem https://a.b/c.png.`). */
const URL_TAIL = /[.,;:!?)\]}]+$/;

/** The text cut into plain runs and http(s) URLs, in order; a URL run never carries trailing punctuation. */
export function splitUrls(text: string): { text: string; url: boolean }[] {
  const out: { text: string; url: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(URL_TAIL, "");
    if (!isHttpUrl(url)) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), url: false });
    out.push({ text: url, url: true });
    last = m.index + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), url: false });
  return out;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * The http(s) URLs in `text` whose path ends in an image or video extension, the first `max` distinct
 * ones: the chat previews them in the browser (`<img>` / `<video>`). Nothing is fetched by HQ itself.
 */
export function mediaUrls(text: string | null | undefined, max = 4): { url: string; kind: "image" | "video" }[] {
  const seen = new Set<string>();
  const out: { url: string; kind: "image" | "video" }[] = [];
  for (const part of splitUrls(text ?? "")) {
    if (!part.url || seen.has(part.text)) continue;
    const kind = mediaKind(new URL(part.text).pathname);
    if (kind !== "image" && kind !== "video") continue;
    seen.add(part.text);
    out.push({ url: part.text, kind });
    if (out.length >= max) break;
  }
  return out;
}

/** `…/.claude/hq-uploads/<id>/<name>` in either slash style; the id is the 32-hex `isUploadId` form. */
const UPLOAD_PATH = /[\\/]\.claude[\\/]hq-uploads[\\/]([0-9a-f]{32})[\\/]([^\\/]+)$/;

export type Attachment = { id: string; name: string; path: string };

/** Bytes of a staged or placed upload, behind the HQ token (app/api/uploads/[id]/file). */
export const uploadFileUrl = (id: string) => `/api/uploads/${id}/file`;
/** {name, kind, size, url} of an upload; `url` is signed, for `<video src>` and download links (app/api/uploads/[id]). */
export const uploadMetaUrl = (id: string) => `/api/uploads/${id}`;
export type UploadMeta = { id: string; name: string; kind: MediaKind; type: string; size: number; url: string };

/**
 * The body and the attachments of a message. Text without the header, or with a line that is not an
 * upload path, comes back whole with no attachments.
 */
export function parseAttachments(text: string | null | undefined): { body: string; files: Attachment[] } {
  const t = text ?? "";
  const whole = { body: t, files: [] };
  const at = t.indexOf(`\n\n${ATTACH_HEADER}\n`);
  if (at < 0) return whole;
  const files: Attachment[] = [];
  for (const raw of t.slice(at + ATTACH_HEADER.length + 3).split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const m = l.startsWith("- ") ? UPLOAD_PATH.exec(l.slice(2).trim()) : null;
    if (!m) return whole;
    files.push({ id: m[1], name: m[2], path: l.slice(2).trim() });
  }
  return files.length ? { body: t.slice(0, at), files } : whole;
}

/** An upload path anywhere in prose (a room's reply quoting the file it read); the name as `safeName` writes it. */
const UPLOAD_REF = /[\\/]\.claude[\\/]hq-uploads[\\/]([0-9a-f]{32})[\\/]([\p{L}\p{N}._-]+)/gu;

/** The distinct uploads a reply mentions by path, first `max`; sentence dots after the name are dropped. */
export function uploadRefs(text: string | null | undefined, max = 5): Attachment[] {
  const out: Attachment[] = [];
  for (const m of (text ?? "").matchAll(UPLOAD_REF)) {
    const name = m[2].replace(/\.+$/, "");
    if (!name || out.some((f) => f.id === m[1])) continue;
    out.push({ id: m[1], name, path: m[0].slice(0, m[0].length - m[2].length + name.length) });
    if (out.length >= max) break;
  }
  return out;
}
