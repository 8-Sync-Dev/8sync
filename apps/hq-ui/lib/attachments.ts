// A message the composer sent with files carries their absolute paths under the text (lib/server/uploads.ts
// `withFiles`), so the room can `Read` them. HQ shows the image ones as thumbnails: this splits the text
// back into the body and the attachments. Client and server safe (no node imports).

export const ATTACH_HEADER = "File đính kèm (mở bằng Read trước khi làm):";

/** Images the chat renders inline; anything else stays a path line. */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
export const isImageName = (name: string) => IMAGE_EXT.test(name);

/** `…/.claude/hq-uploads/<id>/<name>` in either slash style; the id is the 32-hex `isUploadId` form. */
const UPLOAD_PATH = /[\\/]\.claude[\\/]hq-uploads[\\/]([0-9a-f]{32})[\\/]([^\\/]+)$/;

export type Attachment = { id: string; name: string; path: string };

/** Bytes of a staged or placed upload, behind the HQ token (app/api/uploads/[id]/file). */
export const uploadFileUrl = (id: string) => `/api/uploads/${id}/file`;

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
