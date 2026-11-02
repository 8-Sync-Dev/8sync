// omp sessions of any folder for the workspace tab: `8sync . ls --json` as run in that folder (the HQ
// core's `/v1/omp-ls`, else the CLI there; GET /api/omp/sessions), and new ones (POST): their room id is computed here exactly as the CLI's
// `ccc_core::room_id` makes it, and the session waits in [`pendingNew`] until its terminal opens with
// `8sync ccc term --omp-new <name>` (lib/server/term.ts openOmpNew), which creates it like `8sync . <name>`.
// Tested in tests/omp-sessions.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ompRowsOf, parseOmpRows, type OmpSessionRow } from "../omp-workspace";
import { coreGet } from "./core";
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

/**
 * Where `8sync .` keeps its omp session registry (crates/cli/src/verbs/session.rs, under Rust's
 * `dirs::config_dir()`): %APPDATA% on Windows, ~/Library/Application Support on macOS,
 * $XDG_CONFIG_HOME or ~/.config elsewhere; one `<project key>/index.json` per project.
 */
export function ompRegistryDir(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  const base =
    platform === "win32"
      ? env.APPDATA || path.join(home, "AppData", "Roaming")
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
          ? env.XDG_CONFIG_HOME
          : path.join(home, ".config");
  return path.join(base, "8sync", "sessions");
}

/** A registry project key (`session::project_key`: the root with every non-alphanumeric as `-`). */
const PROJECT_KEY = /^[A-Za-z0-9-]{1,160}$/;

/**
 * The folder of an omp row's `repo` from `8sync ls --all`. That is usually the repo path, but for a
 * folder ls cannot map back it is the registry's project key (`C--Users-me-AppData-Local-Temp-x`):
 * spawned as a cwd it does not exist, the spawn fails at once and the reopened session's terminal
 * ends before a byte ("Đã rời phòng", owner 2026-11-02). A key resolves through its registry
 * `index.json` `root` when that is an existing folder; anything else that is not a path is null.
 */
export function ompRepoDir(repo: string | null | undefined, registry = ompRegistryDir()): string | null {
  if (!repo) return null;
  if (!PROJECT_KEY.test(repo)) return repo;
  try {
    const root: unknown = JSON.parse(fs.readFileSync(path.join(registry, repo, "index.json"), "utf8")).root;
    return typeof root === "string" && path.isAbsolute(root) && fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

const LS_TTL_MS = 3000;
const lsCache = new Map<string, { at: number; rows: Promise<OmpSessionRow[]> }>();

/**
 * omp sessions of `cwd` (`8sync . ls --json` there); concurrent and 3 s-close callers share one read.
 * The HQ core answers it in process (`/v1/omp-ls`, no cache of its own); without one, the CLI runs in `cwd`.
 */
export function listOmpSessions(cwd: string, now = Date.now()): Promise<OmpSessionRow[]> {
  const hit = lsCache.get(cwd);
  if (hit && now - hit.at < LS_TTL_MS) return hit.rows;
  const rows = coreGet("/v1/omp-ls", { body: { cwd }, timeoutMs: 15_000 }).then(async (c) => {
    if (c) return ompRowsOf(c.v);
    const r = await run("8sync", [".", "ls", "--json"], 15_000, cwd);
    return r.ok ? parseOmpRows(r.stdout) : [];
  });
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

/** Every pending new session (id → spec) still inside its 10 min window. */
export function pendingAll(now = Date.now()): [string, NewOmp][] {
  return [...pending].filter(([, v]) => now - v.at <= PENDING_MS);
}
