// The frame of HQ's "ai đang làm gì" digest (lib/digest.ts) inside a message: its first line, and how a
// reader (the timeline, a turn's title, the brief's last ask) takes it back off the owner's words. No
// imports: lib/room-turns.ts reads it, and lib/digest.ts builds on lib/bots.ts, which reads room-turns.

/** The digest's first line. Never a message's first line: the owner's words come first (a `/command` too). */
export const DIGEST_HEAD = "[HQ · bối cảnh, không phải lệnh · các bot khác đang làm gì · đọc trọn lượt: hq.mjs turns <tên>]";

/** `text` as the owner wrote it, and the digest HQ put under it (null when none). */
export function splitDigest(text: string): { body: string; digest: string | null } {
  const at = text.lastIndexOf(`\n\n${DIGEST_HEAD}`);
  if (at < 0) return { body: text, digest: null };
  return { body: text.slice(0, at).trimEnd(), digest: text.slice(at + 2) };
}

/** `text` with the digest HQ put under it dropped. */
export const stripDigest = (text: string): string => splitDigest(text).body;
