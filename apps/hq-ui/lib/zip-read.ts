// Just enough ZIP to read an Office file in the browser (docx/xlsx/pptx and OpenDocument are zips of XML):
// the central directory, stored and deflated entries, inflated by the platform's DecompressionStream.
// No dependency, nothing executed. Every entry is capped while it inflates: a zip bomb stops at the cap.

/** One entry may inflate to at most this many bytes, all picked entries together to ZIP_TOTAL_MAX; past it they are left out. */
export const ZIP_ENTRY_MAX = 40 * 1024 * 1024;
export const ZIP_TOTAL_MAX = 120 * 1024 * 1024;

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

async function inflate(data: Uint8Array, max: number): Promise<Uint8Array | null> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** The names in a zip, in directory order; null when `buf` is not a zip this reader understands. */
export function zipNames(buf: ArrayBuffer): { name: string; method: number; comp: number; local: number }[] | null {
  const v = new DataView(buf);
  const len = buf.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 0xffff); i--) {
    if (u32(v, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const dec = new TextDecoder();
  const out: { name: string; method: number; comp: number; local: number }[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > len || u32(v, p) !== 0x02014b50) return null;
    const nameLen = u16(v, p + 28);
    const name = dec.decode(new Uint8Array(buf, p + 46, Math.min(nameLen, len - p - 46)));
    out.push({ name, method: u16(v, p + 10), comp: u32(v, p + 20), local: u32(v, p + 42) });
    p += 46 + nameLen + u16(v, p + 30) + u16(v, p + 32);
  }
  return out;
}

/** The entries `want` picks, as text (UTF-8); entries that are missing, oversized or broken are left out. */
export async function readZipText(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string> | null> {
  const names = zipNames(buf);
  if (!names) return null;
  const v = new DataView(buf);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  let total = 0;
  for (const e of names) {
    if (!want(e.name)) continue;
    const room = Math.min(ZIP_ENTRY_MAX, ZIP_TOTAL_MAX - total);
    if (room <= 0) break;
    const h = e.local;
    if (h + 30 > buf.byteLength || u32(v, h) !== 0x04034b50) continue;
    const start = h + 30 + u16(v, h + 26) + u16(v, h + 28);
    if (start + e.comp > buf.byteLength) continue;
    const data = new Uint8Array(buf, start, e.comp);
    let bytes: Uint8Array | null = null;
    if (e.method === 0) bytes = e.comp <= room ? data : null;
    else if (e.method === 8) bytes = await inflate(data, room).catch(() => null);
    if (!bytes) continue;
    total += bytes.byteLength;
    out.set(e.name, dec.decode(bytes));
  }
  return out;
}
