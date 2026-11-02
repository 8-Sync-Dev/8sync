// omp sessions of any folder for the workspace tab: `8sync . ls --json` run in that folder (GET
// /api/omp/sessions), and new ones (POST): their room id is computed here exactly as the CLI's
// `ccc_core::room_id` makes it, and the session waits in [`pendingNew`] until its terminal opens with
// `8sync ccc term --omp-new <name>` (lib/server/term.ts openOmpNew), which creates it like `8sync . <name>`.
// Tested in tests/omp-sessions.test.ts.
import fs from "node:fs";
import path from "node:path";
import { parseOmpRows, type OmpSessionRow } from "../omp-workspace";
import { run } from "./proc";

/** `8sync .`'s project root of `cwd` (crates/cli/src/verbs/here.rs detect_project_root): the nearest folder with one of these, else `cwd`. */
const ROOT_MARKERS = [".git", "Cargo.toml", "package.json", "pyproject.toml", "deno.json", "go.mod"];

export function projectRoot(cwd: string): string {
  for (let p = cwd; ; ) {
    if (ROOT_MARKERS.some((m) => fs.existsSync(path.join(p, m)))) return p;
    const up = path.dirname(p);
    if (up === p) return cwd;
    p = up;
  }
}

/**
 * Rust's `std::fs::canonicalize` of `root`: the real path, which on Windows is a verbatim one
 * (`\\?\C:\…`, `\\?\UNC\server\share\…`). A path that cannot be resolved is hashed as given, like the CLI.
 */
export function canonicalRoot(root: string, platform: NodeJS.Platform = process.platform): string {
  let real: string;
  try {
    real = fs.realpathSync.native(root);
  } catch {
    return root;
  }
  if (platform !== "win32" || real.startsWith("\\\\?\\")) return real;
  return real.startsWith("\\\\") ? `\\\\?\\UNC\\${real.slice(2)}` : `\\\\?\\${real}`;
}

/** `omp-` + 16 hex of FNV-1a 64 over `root` + NUL + `name` (ccc_core::room_id, its golden test: ("a","b") → omp-e5d29919042666b2). */
export function roomIdOf(root: string, name: string): string {
  // BigInt() calls, not `1n` literals: tsconfig targets ES2017.
  const M = BigInt("0xffffffffffffffff");
  const P = BigInt("0x100000001b3");
  let h = BigInt("0xcbf29ce484222325");
  for (const b of Buffer.concat([Buffer.from(root, "utf8"), Buffer.from([0]), Buffer.from(name, "utf8")])) h = ((h ^ BigInt(b)) * P) & M;
  return `omp-${h.toString(16).padStart(16, "0")}`;
}

/** The room id `8sync . <name>` run in `cwd` gets. Symlinks resolved first: Rust's `current_dir()` returns the real path. */
export const ompIdFor = (cwd: string, name: string) => {
  let real = cwd;
  try {
    real = fs.realpathSync.native(cwd);
  } catch {}
  return roomIdOf(canonicalRoot(projectRoot(real)), name);
};

/** `cwd` as an existing absolute folder, or null. */
export function existingDir(cwd: unknown): string | null {
  if (typeof cwd !== "string" || !cwd || cwd.length > 4096 || cwd.includes("\0") || !path.isAbsolute(cwd)) return null;
  const dir = path.resolve(cwd);
  try {
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

const LS_TTL_MS = 3000;
const lsCache = new Map<string, { at: number; rows: Promise<OmpSessionRow[]> }>();

/** omp sessions of `cwd` (`8sync . ls --json` there); concurrent and 3 s-close callers share one run. */
export function listOmpSessions(cwd: string, now = Date.now()): Promise<OmpSessionRow[]> {
  const hit = lsCache.get(cwd);
  if (hit && now - hit.at < LS_TTL_MS) return hit.rows;
  const rows = run("8sync", [".", "ls", "--json"], 15_000, cwd).then((r) => (r.ok ? parseOmpRows(r.stdout) : []));
  lsCache.set(cwd, { at: now, rows });
  if (lsCache.size > 64) lsCache.delete(lsCache.keys().next().value!);
  return rows;
}

/** A new session's ls rows are stale the moment it is created. */
export const forgetOmpSessions = (cwd: string) => lsCache.delete(cwd);

/** A session created by POST /api/omp/sessions whose terminal has not created it yet. */
export type NewOmp = { cwd: string; name: string; model: string | null; at: number };
const PENDING_MS = 10 * 60_000;
const pending = new Map<string, NewOmp>();

export function rememberNew(id: string, spec: Omit<NewOmp, "at">, now = Date.now()): void {
  for (const [k, v] of pending) if (now - v.at > PENDING_MS) pending.delete(k);
  pending.set(id, { ...spec, at: now });
}

/** The pending new session behind room `id` (10 min after its POST), or null. */
export function pendingNew(id: string, now = Date.now()): NewOmp | null {
  const v = pending.get(id);
  return v && now - v.at <= PENDING_MS ? v : null;
}
