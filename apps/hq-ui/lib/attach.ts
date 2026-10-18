// Browser side of composer attachments (server: lib/server/uploads.ts). Same caps as the server.
export const FILES_MAX = 5;
export const FILE_MAX_MB = 10;

/** Why a picked file cannot be sent, or null. */
export function fileError(f: { name: string; size: number }): string | null {
  if (f.size === 0) return `${f.name || "file"}: file rỗng`;
  if (f.size > FILE_MAX_MB * 1024 * 1024) return `${f.name}: quá ${FILE_MAX_MB} MB`;
  return null;
}

/** The file's bytes as base64 (no data: prefix). */
export async function toBase64(f: Blob): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  // Chunked: String.fromCharCode on a 10 MB array overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
