// Artifacts a room registers for the owner (owner 2026-11-04: "chỗ update artifact lên … từ local máy
// load hiển thị lên"). SQLite keeps the path, title and who made it; the bytes never leave the file.
//
// Trust: a path is taken only at registration, from this machine's side (the route is localOnly), and
// only when its real path sits in a project HQ knows. Every read re-resolves the real path and checks it
// is still inside the root it was registered under, so a later symlink swap cannot point it elsewhere.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { DatabaseSync } from "node:sqlite";
import { ARTIFACT_TYPES, baseName, extOf, maxArtifactBytes, type Artifact, type ArtifactKind } from "../artifacts";
import { rootKey } from "../preview";
import { stamp } from "./db";
import { projectOf } from "./office";

export const TITLE_MAX = 200;
export const NOTE_MAX = 2000;
export const ARTIFACT_LIST_MAX = 500;

const ID = /^[0-9a-f]{32}$/;
export const isArtifactId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
/** Claude session id, omp room id or hq-* name: what /api/messages addresses. */
const SESSION = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|omp-[0-9a-f]{16}|hq-[a-z0-9][a-z0-9-]{0,31})$/i;
/** Folders a registered file may never sit under, and names that read like a credential. */
const BLOCKED_DIR: Record<string, true> = { ".git": true, ".ssh": true, ".gnupg": true, ".aws": true, ".kube": true, node_modules: true };
const SECRET_NAME = /(^\.env)|secret|credential|password|passwd|id_rsa|id_ed25519|private[-_]?key|ui-token/i;

const inside = (real: string, base: string) => {
  const a = process.platform === "win32" ? real.toLowerCase() : real;
  const b = process.platform === "win32" ? base.toLowerCase() : base;
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
};

function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

export type RegisterInput = { path?: unknown; title?: unknown; note?: unknown; session?: unknown };
export type RegisterResult = { ok: true; artifact: Artifact; created: boolean } | { ok: false; status: number; error: string };

type Row = Omit<Artifact, "missing" | "size" | "mtime">;

/** The kind a path is served as, or null when the type is not one HQ shows. */
export const kindOf = (p: string): ArtifactKind | null => ARTIFACT_TYPES[extOf(p)]?.kind ?? null;

/**
 * Register (or refresh) one file. `roots` = the projects HQ knows (lib/server/in-view knownRoots).
 * The same real path registered again keeps its id and creation time and takes the new title/note.
 */
export function registerArtifact(db: DatabaseSync, input: RegisterInput, roots: string[]): RegisterResult {
  const fail = (status: number, error: string): RegisterResult => ({ ok: false, status, error });
  if (typeof input.path !== "string" || !input.path.trim()) return fail(422, "path: đường dẫn tuyệt đối tới file");
  const given = input.path.trim();
  if (!path.isAbsolute(given)) return fail(422, "path phải là đường dẫn tuyệt đối");
  const real = realOrNull(given);
  if (!real) return fail(404, "không thấy file");
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return fail(404, "không thấy file");
  }
  if (!st.isFile()) return fail(422, "path phải là một file");
  const kind = kindOf(real);
  if (!kind) return fail(422, `loại file không hiện được: ${extOf(real) || "(không đuôi)"} (nhận ${Object.keys(ARTIFACT_TYPES).join(" ")})`);
  if (st.size > maxArtifactBytes(kind)) return fail(413, `file quá ${maxArtifactBytes(kind) / 1024 / 1024} MB`);
  if (SECRET_NAME.test(baseName(real))) return fail(422, "tên file giống file chứa bí mật: không đăng");

  // The project: the file's git root when HQ knows that repo (worktrees fold into it), else the
  // deepest known folder that holds it.
  const known = roots.map((r) => ({ given: r, real: realOrNull(r) })).filter((r): r is { given: string; real: string } => !!r.real);
  const git = projectOf(path.dirname(real));
  const gitReal = git ? realOrNull(git.root) : null;
  let root: string | null = null;
  if (git && gitReal && inside(real, gitReal) && known.some((k) => rootKey(k.real) === rootKey(gitReal))) root = gitReal;
  if (!root) {
    const hit = known.filter((k) => inside(real, k.real)).sort((a, b) => b.real.length - a.real.length)[0];
    root = hit?.real ?? null;
  }
  if (!root) return fail(403, "file không nằm trong dự án nào HQ đang biết (mở phòng ở dự án đó hoặc thêm thư mục vào sidebar)");
  const rel = path.relative(root, real).split(path.sep);
  if (rel.some((seg) => Object.hasOwn(BLOCKED_DIR, seg.toLowerCase()))) return fail(422, "file nằm trong thư mục không được đăng (.git, .ssh, node_modules…)");

  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, TITLE_MAX) : baseName(real);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, NOTE_MAX) : null;
  if (input.session !== undefined && input.session !== null && (typeof input.session !== "string" || !SESSION.test(input.session))) {
    return fail(422, "session: Claude session id, omp-<16hex> hoặc hq-<tên>");
  }
  const session = typeof input.session === "string" ? input.session : null;
  const project = git && gitReal === root ? git.name : baseName(root);
  const branch = git && gitReal === root ? git.branch : null;

  const now = stamp();
  const old = db.prepare("SELECT id, created_at FROM artifacts WHERE path = ?").get(real) as { id: string; created_at: number } | undefined;
  const id = old?.id ?? crypto.randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO artifacts (id, path, root, project, branch, session, title, note, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET root = excluded.root, project = excluded.project, branch = excluded.branch,
       session = COALESCE(excluded.session, artifacts.session), title = excluded.title, note = excluded.note,
       kind = excluded.kind, updated_at = excluded.updated_at`,
  ).run(id, real, root, project, branch, session, title, note, kind, old?.created_at ?? now, now);
  return { ok: true, artifact: withStat(getRow(db, id)!), created: !old };
}

function getRow(db: DatabaseSync, id: string): Row | null {
  return (db.prepare("SELECT id, path, root, project, branch, session, title, note, kind, created_at, updated_at FROM artifacts WHERE id = ?").get(id) as Row | undefined) ?? null;
}

function withStat(r: Row): Artifact {
  try {
    const st = fs.statSync(r.path);
    return { ...r, missing: !st.isFile(), size: st.size, mtime: st.mtimeMs };
  } catch {
    return { ...r, missing: true, size: null, mtime: null };
  }
}

/** Newest first; `root` narrows to one repo (its worktrees included), `session` to one room. */
export function listArtifacts(db: DatabaseSync, opts: { root?: string | null; session?: string | null; limit?: number } = {}): Artifact[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), ARTIFACT_LIST_MAX);
  const rows = (
    opts.session
      ? db.prepare("SELECT id, path, root, project, branch, session, title, note, kind, created_at, updated_at FROM artifacts WHERE session = ? ORDER BY updated_at DESC").all(opts.session)
      : db.prepare("SELECT id, path, root, project, branch, session, title, note, kind, created_at, updated_at FROM artifacts ORDER BY updated_at DESC").all()
  ) as Row[];
  const key = opts.root ? rootKey(opts.root) : null;
  return rows.filter((r) => !key || rootKey(r.root) === key).slice(0, limit).map(withStat);
}

/** Drops the row only: the file on disk is the room's and stays. */
export function forgetArtifact(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM artifacts WHERE id = ?").run(id).changes > 0;
}

export type OpenArtifact = { artifact: Artifact; type: string; size: number; body: ReadableStream };

/** The bytes of one artifact, or null when it is gone, moved out of its root or no longer a shown type. */
export function openArtifact(db: DatabaseSync, id: string): OpenArtifact | null {
  const row = getRow(db, id);
  if (!row) return null;
  const real = realOrNull(row.path);
  const rootReal = realOrNull(row.root);
  if (!real || !rootReal || !inside(real, rootReal)) return null;
  const t = ARTIFACT_TYPES[extOf(real)];
  if (!t || t.kind !== row.kind) return null;
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > maxArtifactBytes(t.kind)) return null;
  const body = Readable.toWeb(fs.createReadStream(real)) as unknown as ReadableStream;
  return { artifact: withStat(row), type: t.type, size: st.size, body };
}
