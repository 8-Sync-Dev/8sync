// The room "Thư mục" panel's file access (app/api/files/**): list a folder, read a file, save a text file.
// Owner only (lib/access.ts: not a guest route). Tested in tests/files.test.ts.
//
// Trust: a `root` is taken only when its real path is (inside) a project HQ knows (lib/server/in-view
// knownRoots); a `path` is relative to it, and every request re-resolves the real path and keeps it inside
// that root, so `..` or a symlink cannot leave it. `.git`, `.ssh`, `node_modules`… and credential-looking
// names (lib/server/artifacts.ts allowedUnder) are refused. A save only rewrites an existing text file,
// atomically, and only when the bytes on disk are still the ones the editor loaded (sha256): nothing is
// ever created, deleted or renamed.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { baseName, fileType, ARTIFACT_MEDIA_MAX_BYTES } from "../artifacts";
import { FILES_CONFLICT, FILES_EDIT_MAX, FILES_HIDDEN, FILES_LIST_MAX, FILES_TEXT_MAX, sortEntries, type DirListing, type FileEntry, type FileKind, type FileSaved, type FileView } from "../files";
import { allowedUnder, inside, realOrNull } from "./artifacts";
import { fileSecret, safeEqual } from "./auth";
import { mediaSecretPath } from "./paths";

export type Fail = { status: number; error: string };
const fail = (status: number, error: string): Fail => ({ status, error });
export const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && "error" in v && "status" in v;

/**
 * The real folder of `given` when it is a known project root or a folder inside one (not under `.git`…).
 * A leading `~/` is this machine's home folder: a room reply names files that way (lib/file-path.ts).
 */
export function filesRoot(given: string, known: string[]): string | Fail {
  if (/^~(?:[\\/]|$)/.test(given)) given = path.join(os.homedir(), given.slice(1));
  if (!given || given.length > 4096 || given.includes("\0") || !path.isAbsolute(given)) return fail(422, "root: đường dẫn tuyệt đối tới thư mục dự án");
  const real = realOrNull(given);
  if (!real) return fail(404, "không thấy thư mục dự án");
  try {
    if (!fs.statSync(real).isDirectory()) return fail(422, "root phải là thư mục");
  } catch {
    return fail(404, "không thấy thư mục dự án");
  }
  const ok = known.some((k) => {
    const kr = realOrNull(k);
    return !!kr && inside(real, kr) && allowedUnder(real, kr);
  });
  return ok ? real : fail(403, "thư mục không thuộc dự án nào HQ đang biết");
}

/** `rel` ("a/b.md", `/` or `\`, "" = root) under `root` (a real path): the real path, or why not. */
export function resolveIn(root: string, rel: string): string | Fail {
  if (rel.length > 4096 || rel.includes("\0") || path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) return fail(422, "path: đường dẫn tương đối trong dự án");
  const joined = path.resolve(root, ...rel.split(/[\\/]/).filter(Boolean));
  if (!inside(joined, root)) return fail(403, "đường dẫn ra ngoài dự án");
  if (joined !== root && !allowedUnder(joined, root)) return fail(403, "không mở được file này (.git, node_modules, file bí mật…)");
  const real = realOrNull(joined);
  if (!real) return fail(404, "không thấy file");
  if (!inside(real, root)) return fail(403, "liên kết trỏ ra ngoài dự án");
  if (real !== root && !allowedUnder(real, root)) return fail(403, "không mở được file này (.git, node_modules, file bí mật…)");
  return real;
}

/** `real` as the `/`-separated path relative to `root`. */
const relOf = (root: string, real: string) => path.relative(root, real).split(path.sep).join("/");

/** One folder: dot-folders kept, `.git`/`node_modules`/`target` and secret names left out, links out of the root dropped. */
export function listFolder(root: string, rel: string): DirListing | Fail {
  const dir = resolveIn(root, rel);
  if (isFail(dir)) return dir;
  let ents: fs.Dirent[];
  try {
    if (!fs.statSync(dir).isDirectory()) return fail(422, "không phải thư mục");
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return fail(404, "không đọc được thư mục");
  }
  const out: FileEntry[] = [];
  for (const d of ents) {
    if (Object.hasOwn(FILES_HIDDEN, d.name.toLowerCase())) continue;
    const p = path.join(dir, d.name);
    if (!allowedUnder(p, root)) continue;
    let target = p;
    if (d.isSymbolicLink()) {
      const real = realOrNull(p);
      if (!real || !inside(real, root) || !allowedUnder(real, root)) continue;
      target = real;
    } else if (!d.isDirectory() && !d.isFile()) continue;
    try {
      const st = fs.statSync(target);
      const isDir = st.isDirectory();
      if (!isDir && !st.isFile()) continue;
      out.push({ name: d.name, dir: isDir, size: isDir ? null : st.size, mtime: st.mtimeMs });
    } catch {
      // vanished between readdir and stat
    }
  }
  sortEntries(out);
  return { root, path: dir === root ? "" : relOf(root, dir), entries: out.slice(0, FILES_LIST_MAX), more: out.length > FILES_LIST_MAX };
}

/** Kinds never read as text. */
const BINARY_KINDS: Record<string, true> = { image: true, video: true, audio: true, pdf: true, office: true };

/** The bytes as UTF-8 text (BOM kept, so a save writes it back), or null when they are not text. */
export function textOf(buf: Buffer): string | null {
  if (buf.subarray(0, 8192).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return null;
  }
}

export const sha256 = (buf: Buffer | string) => crypto.createHash("sha256").update(buf).digest("hex");

/** One file for the viewer: text kinds with their text and hash, every kind with a signed `src`. */
export function readFileView(root: string, givenRoot: string, rel: string, now = Date.now()): FileView | Fail {
  const real = resolveIn(root, rel);
  if (isFail(real)) return real;
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return fail(404, "không thấy file");
  }
  if (!st.isFile()) return fail(422, "không phải file");
  const r = relOf(root, real);
  const base = { path: r, name: baseName(real), size: st.size, mtime: st.mtimeMs, src: filesSrc(givenRoot, r, now), editable: false, big: false };
  const known = fileType(real)?.kind ?? null;
  if (known && BINARY_KINDS[known]) return { ...base, kind: known };
  if (st.size > FILES_TEXT_MAX) return { ...base, kind: known ?? "binary", big: !!known };
  let buf: Buffer;
  try {
    buf = fs.readFileSync(real);
  } catch {
    return fail(404, "không đọc được file");
  }
  const text = textOf(buf);
  if (text === null) return { ...base, kind: "binary" };
  const kind: FileKind = known ?? "text";
  return { ...base, kind, size: buf.length, text, hash: sha256(buf), editable: buf.length <= FILES_EDIT_MAX };
}

/**
 * Rewrites an existing text file with `text` when its bytes still hash to `hash` (else 409, nothing
 * written). Line endings follow the file: a CRLF file stays CRLF (a browser textarea hands back LF).
 * Written to a temp file beside it, then renamed over it: a reader never sees half a file.
 */
export function saveText(root: string, rel: string, text: unknown, hash: unknown): FileSaved | Fail {
  if (typeof text !== "string") return fail(422, "text: nội dung file");
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return fail(422, "hash: sha256 của bản đã tải");
  const real = resolveIn(root, rel);
  if (isFail(real)) return real;
  let st: fs.Stats;
  let cur: Buffer;
  try {
    st = fs.statSync(real);
    if (!st.isFile()) return fail(422, "không phải file");
    if (st.size > FILES_EDIT_MAX) return fail(413, `chỉ sửa file dưới ${FILES_EDIT_MAX / 1024 / 1024} MB`);
    cur = fs.readFileSync(real);
  } catch {
    return fail(404, "không thấy file");
  }
  const known = fileType(real)?.kind;
  if ((known && BINARY_KINDS[known]) || textOf(cur) === null) return fail(422, "chỉ sửa được file chữ");
  if (sha256(cur) !== hash) return fail(409, FILES_CONFLICT);
  let out = text;
  if (cur.includes("\r\n") && !out.includes("\r")) out = out.replace(/\n/g, "\r\n");
  const bytes = Buffer.from(out, "utf8");
  if (bytes.length > FILES_EDIT_MAX) return fail(413, `nội dung quá ${FILES_EDIT_MAX / 1024 / 1024} MB`);
  const tmp = path.join(path.dirname(real), `.${baseName(real)}.hq-${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(tmp, bytes, { flag: "wx", mode: st.mode & 0o777 });
    // Last look right before the swap: a write that landed while this one was preparing wins.
    if (sha256(fs.readFileSync(real)) !== hash) {
      fs.rmSync(tmp, { force: true });
      return fail(409, FILES_CONFLICT);
    }
    fs.renameSync(tmp, real);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    return fail(500, `không ghi được file: ${(e as Error).message}`);
  }
  const after = fs.statSync(real);
  return { ok: true, hash: sha256(bytes), mtime: after.mtimeMs, size: after.size };
}

/** How long a signed file URL stays good. */
export const FILES_LINK_MS = 12 * 3600_000;
const SIG_HEX = /^[0-9a-f]{64}$/;

export function filesSig(root: string, rel: string, exp: number, secret = fileSecret(mediaSecretPath())): string {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(["files", root, rel, exp])).digest("hex");
}

/** True for a signature of exactly this root, path and expiry, not expired, at most FILES_LINK_MS ahead. */
export function filesSigValid(sig: string, root: string, rel: string, exp: number, now = Date.now()): boolean {
  if (!SIG_HEX.test(sig) || !Number.isSafeInteger(exp) || exp <= now || exp > now + FILES_LINK_MS) return false;
  return safeEqual(sig, filesSig(root, rel, exp));
}

/** `/api/files/raw?root=&path=&e=&sig=`: what `<img>`, `<video>`, `<audio>` and "Tải về" load (no token header). Stable for an hour. */
export function filesSrc(root: string, rel: string, now = Date.now()): string {
  const hour = 3600_000;
  const exp = Math.ceil(now / hour) * hour + FILES_LINK_MS - hour;
  return `/api/files/raw?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}&e=${exp}&sig=${filesSig(root, rel, exp)}`;
}

/** Types served inline from the raw route; anything else goes out as an `application/octet-stream` attachment. */
const INLINE_KINDS: Record<string, true> = { image: true, video: true, audio: true, pdf: true };

/** The raw route's file: its real path, name, served type and size; streamed up to 2 GB. */
export function rawFile(root: string, rel: string): { path: string; name: string; type: string; size: number; inline: boolean } | Fail {
  const real = resolveIn(root, rel);
  if (isFail(real)) return real;
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return fail(404, "không thấy file");
  }
  if (!st.isFile()) return fail(422, "không phải file");
  if (st.size > ARTIFACT_MEDIA_MAX_BYTES) return fail(413, "file quá 2 GB");
  const t = fileType(real);
  const inline = !!t && !!INLINE_KINDS[t.kind];
  return { path: real, name: baseName(real), type: inline && t ? t.type : "application/octet-stream", size: st.size, inline };
}
