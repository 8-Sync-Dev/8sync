// Artifacts a room registers for the owner (owner 2026-11-04: "chỗ update artifact lên … từ local máy
// load hiển thị lên"). SQLite keeps the path, title and who made it; the bytes never leave the file.
//
// Trust: a path is taken only at registration, from this machine's side (the route is localOnly), and
// only when its real path sits in a project HQ knows. Every read re-resolves the real path and checks it
// is still inside the root it was registered under, so a later symlink swap cannot point it elsewhere.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { baseName, extOf, fileType, isRoomRef, maxArtifactBytes, parseContentIds, ARTIFACT_TYPES, type Artifact, type ArtifactKind, type ArtifactView } from "../artifacts";
import { rootKey } from "../preview";
import { fileSecret, safeEqual } from "./auth";
import { stamp } from "./db";
import { projectOf } from "./office";
import { mediaSecretPath } from "./paths";
import type { SentFile } from "./send-file";

export const TITLE_MAX = 200;
export const NOTE_MAX = 2000;
export const ARTIFACT_LIST_MAX = 500;
export const LINK_MAX = 2000;

const ID = /^[0-9a-f]{32}$/;
export const isArtifactId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
/** Folders a registered file may never sit under, and names that read like a credential. */
const BLOCKED_DIR: Record<string, true> = { ".git": true, ".ssh": true, ".gnupg": true, ".aws": true, ".kube": true, node_modules: true };
const SECRET_NAME = /(^\.env)|secret|credential|password|passwd|id_rsa|id_ed25519|private[-_]?key|ui-token/i;

export const inside = (real: string, base: string) => {
  const a = process.platform === "win32" ? real.toLowerCase() : real;
  const b = process.platform === "win32" ? base.toLowerCase() : base;
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
};

/** A real path HQ may point at: no credential-looking name, no `.git`/`.ssh`/`node_modules`… between `root` and it. */
export function allowedUnder(real: string, root: string): boolean {
  if (SECRET_NAME.test(baseName(real))) return false;
  return !path.relative(root, real).split(path.sep).some((seg) => Object.hasOwn(BLOCKED_DIR, seg.toLowerCase()));
}

export function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

export type RegisterInput = { path?: unknown; title?: unknown; note?: unknown; session?: unknown; content?: unknown; link?: unknown; for?: unknown };
export type RegisterResult = { ok: true; artifact: Artifact; created: boolean } | { ok: false; status: number; error: string };

type Row = Omit<Artifact, "missing" | "size" | "mtime">;
type DbRow = Omit<Row, "content"> & { content: string | null };
const COLS = "id, path, root, project, branch, session, title, note, kind, created_at, updated_at, content, link, for_root, for_project";

/** ",16,38," in the DB → [16, 38]. */
const toRow = (r: DbRow): Row => ({ ...r, content: r.content ? r.content.split(",").filter(Boolean).map(Number) : [] });

/** An https URL as given, null for an empty value, undefined when it is not one. */
function linkOf(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || v.length > LINK_MAX) return undefined;
  try {
    return new URL(v.trim()).protocol === "https:" ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The kind a path is served as, or null when the type is not one HQ shows. */
export const kindOf = (p: string): ArtifactKind | null => fileType(p)?.kind ?? null;

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
  if (input.session !== undefined && input.session !== null && !isRoomRef(input.session)) {
    return fail(422, "session: Claude session id, omp-<16hex> hoặc hq-<tên>");
  }
  const session = typeof input.session === "string" ? input.session : null;
  const project = git && gitReal === root ? git.name : baseName(root);
  // Absent = keep what an earlier registration said; [] / "" / null = clear.
  let content: string | null | undefined;
  if (input.content !== undefined) {
    const ids = input.content === null || input.content === "" ? [] : parseContentIds(input.content);
    if (!ids) return fail(422, "content: id bài trong Nội dung, vd 38 hoặc \"38,16\" (tối đa 20)");
    content = ids.length ? `,${ids.join(",")},` : null;
  }
  let link: string | null | undefined;
  if (input.link !== undefined) {
    link = linkOf(input.link);
    if (link === undefined) return fail(422, `link: một URL https (tối đa ${LINK_MAX} ký tự)`);
  }
  // `for`: the known project the file is about (a social post for 8sync-startup made in content-post-agency).
  let forRoot: string | null | undefined;
  let forProject: string | null = null;
  if (input.for !== undefined && input.for !== null && input.for !== "") {
    if (typeof input.for !== "string" || !path.isAbsolute(input.for.trim())) return fail(422, "for: đường dẫn tuyệt đối tới thư mục dự án");
    const want = realOrNull(input.for.trim());
    const k = want ? known.find((r) => rootKey(r.real) === rootKey(want)) : undefined;
    if (!want || !k) return fail(403, "for: không phải dự án HQ đang biết (mở phòng ở dự án đó hoặc thêm thư mục vào sidebar)");
    const fg = projectOf(want);
    forRoot = rootKey(want) === rootKey(root) ? null : want;
    forProject = fg && rootKey(fg.root) === rootKey(want) ? fg.name : baseName(want);
  } else if (input.for !== undefined) forRoot = null;
  const branch = git && gitReal === root ? git.branch : null;

  const now = stamp();
  const old = db.prepare("SELECT id, created_at, content, link, for_root, for_project FROM artifacts WHERE path = ?").get(real) as
    | { id: string; created_at: number; content: string | null; link: string | null; for_root: string | null; for_project: string | null }
    | undefined;
  const id = old?.id ?? crypto.randomBytes(16).toString("hex");
  const keepFor = forRoot === undefined;
  db.prepare(
    `INSERT INTO artifacts (id, path, root, project, branch, session, title, note, kind, created_at, updated_at, content, link, for_root, for_project)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET root = excluded.root, project = excluded.project, branch = excluded.branch,
       session = COALESCE(excluded.session, artifacts.session), title = excluded.title, note = excluded.note,
       kind = excluded.kind, updated_at = excluded.updated_at, content = excluded.content, link = excluded.link,
       for_root = excluded.for_root, for_project = excluded.for_project`,
  ).run(
    id,
    real,
    root,
    project,
    branch,
    session,
    title,
    note,
    kind,
    old?.created_at ?? now,
    now,
    content === undefined ? (old?.content ?? null) : content,
    link === undefined ? (old?.link ?? null) : link,
    keepFor ? (old?.for_root ?? null) : (forRoot ?? null),
    keepFor ? (old?.for_project ?? null) : forRoot ? forProject : null,
  );
  return { ok: true, artifact: withStat(getRow(db, id)!), created: !old };
}

function getRow(db: DatabaseSync, id: string): Row | null {
  const r = db.prepare(`SELECT ${COLS} FROM artifacts WHERE id = ?`).get(id) as DbRow | undefined;
  return r ? toRow(r) : null;
}

function withStat(r: Row): Artifact {
  try {
    const st = fs.statSync(r.path);
    return { ...r, missing: !st.isFile(), size: st.size, mtime: st.mtimeMs };
  } catch {
    return { ...r, missing: true, size: null, mtime: null };
  }
}

/**
 * Newest first; `root` narrows to one project (the one it is about: `for` wins over where the file
 * sits; worktrees included), `session` to one room (several: any of a room's names, e.g. its hq name
 * and its Claude session id), `content` to the results of one content item, `linked` to the ones that
 * are a result of any content item.
 */
export function listArtifacts(db: DatabaseSync, opts: { root?: string | null; session?: string | readonly string[] | null; content?: number | null; linked?: boolean; limit?: number } = {}): Artifact[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), ARTIFACT_LIST_MAX);
  const where: string[] = [];
  const args: (string | number)[] = [];
  const sessions = typeof opts.session === "string" ? [opts.session] : (opts.session ?? []);
  if (sessions.length) {
    where.push(`session IN (${sessions.map(() => "?").join(", ")})`);
    args.push(...sessions);
  }
  if (opts.content) {
    where.push("content LIKE ?");
    args.push(`%,${opts.content},%`);
  }
  if (opts.linked) where.push("content IS NOT NULL");
  const rows = db.prepare(`SELECT ${COLS} FROM artifacts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`).all(...args) as DbRow[];
  const key = opts.root ? rootKey(opts.root) : null;
  return rows
    .filter((r) => !key || rootKey(r.for_root ?? r.root) === key)
    .slice(0, limit)
    .map((r) => withStat(toRow(r)));
}

/** Drops the row only: the file on disk is the room's and stays. */
export function forgetArtifact(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM artifacts WHERE id = ?").run(id).changes > 0;
}

export type ResolvedArtifact = { artifact: Artifact; file: SentFile };

/**
 * One artifact's file as it is on disk now: its real path, served type and stat'ed size; null when it is
 * gone, moved out of its root, swapped for a link to a secret, or no longer a shown type or size.
 */
export function resolveArtifact(db: DatabaseSync, id: string): ResolvedArtifact | null {
  const row = getRow(db, id);
  if (!row) return null;
  const real = realOrNull(row.path);
  const rootReal = realOrNull(row.root);
  if (!real || !rootReal || !inside(real, rootReal)) return null;
  // The path may have been swapped for a symlink since registration: repeat the registration filters on what it is now.
  if (!allowedUnder(real, rootReal)) return null;
  const t = fileType(real);
  if (!t || t.kind !== row.kind) return null;
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > maxArtifactBytes(t.kind)) return null;
  return { artifact: withStat(row), file: { path: real, name: baseName(real), type: t.type, size: st.size } };
}

/** How long a signed artifact URL stays good; the view's list poll hands out a fresh one. */
export const ARTIFACT_LINK_MS = 12 * 3600_000;
const SIG_HEX = /^[0-9a-f]{64}$/;

export function artifactSig(id: string, exp: number, secret = fileSecret(mediaSecretPath())): string {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(["artifact", id, exp])).digest("hex");
}

/** True for a signature of exactly this id and expiry, not expired, at most ARTIFACT_LINK_MS ahead; constant-time compare. */
export function artifactSigValid(sig: string, id: string, exp: number, now = Date.now()): boolean {
  if (!SIG_HEX.test(sig) || !Number.isSafeInteger(exp) || exp <= now || exp > now + ARTIFACT_LINK_MS) return false;
  return safeEqual(sig, artifactSig(id, exp));
}

/**
 * `/api/artifacts/<id>/file?e=&sig=`: what `<video>`, `<audio>`, `<img>` and the "Tải về" link load
 * (they cannot send `x-hq-token`). The expiry is the next full hour + 11 h, so the URL stays the same for
 * an hour and a list poll never reloads a playing video. The route still asks for the owner's login.
 */
export function artifactSrc(id: string, now = Date.now()): string {
  const hour = 3600_000;
  const exp = Math.ceil(now / hour) * hour + ARTIFACT_LINK_MS - hour;
  return `/api/artifacts/${id}/file?e=${exp}&sig=${artifactSig(id, exp)}`;
}

export const withSrc = (a: Artifact, now = Date.now()): ArtifactView => ({ ...a, src: artifactSrc(a.id, now) });
