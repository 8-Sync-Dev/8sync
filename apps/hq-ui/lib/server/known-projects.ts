// Sources of "Dự án trên máy" (owner 2026-10-22: "không thấy đúng all dự án trên máy"): auto's scope /
// team roots / closed projects (last `auto status`), pinned roots, the repo of every session HQ has
// recorded, the folders Claude Code trusts (~/.claude.json `projects`, paths only), and a bounded scan
// for repos below the folders those live in. Only folders that still exist are returned.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { mergeKnown, type KnownProject } from "../known-projects";
import { rootKey } from "../preview";
import { lastAutoStatus } from "./auto";
import { projectOf, readPins } from "./office";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= 1024) : []);

/** Folders never descended into: dependencies, build output, caches. */
const SKIP = new Set(["node_modules", "target", "dist", "build", "out", "vendor", "venv", "__pycache__", "AppData", "Library"]);
const DOT_GIT = ".git";

/**
 * Repo roots (a folder holding `.git`, dir or file) below `bases`, `depth` levels down, at most `cap`;
 * nested repos count too. Hidden folders, SKIP and symlinks are not followed. A base inside another
 * base is walked once.
 */
export function scanRepos(bases: string[], depth = 4, cap = 300): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  const walk = (d: string, left: number) => {
    if (out.length >= cap) return;
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    if (names.some((n) => n.name === DOT_GIT) && !keys.has(rootKey(d))) {
      keys.add(rootKey(d));
      out.push(d);
    }
    if (left === 0) return;
    for (const n of names) {
      if (!n.isDirectory() || n.name.startsWith(".") || SKIP.has(n.name)) continue;
      walk(path.join(d, n.name), left - 1);
    }
  };
  const sorted = [...new Set(bases.map((b) => b.replace(/[\\/]+$/, "")))].sort((a, b) => a.length - b.length);
  const walked: string[] = [];
  for (const b of sorted) {
    const k = rootKey(b);
    if (walked.some((w) => k === w || k.startsWith(`${w}/`))) continue;
    walked.push(k);
    walk(b, depth);
  }
  return out;
}

/**
 * Where to scan: the parent of every known repo, never a drive root, the home folder or above it
 * (a whole-disk walk), so "C:/Users/Projects/su-code" scans "C:/Users/Projects".
 */
export function scanBases(known: string[], home: string): string[] {
  const homeKey = rootKey(home);
  return [
    ...new Set(
      known
        .map((k) => path.dirname(k.replace(/[\\/]+$/, "")))
        .filter((p) => {
          const k = rootKey(p);
          return k.length > 0 && !/^[a-z]:\/?$/.test(k) && k !== "/" && k !== homeKey && !homeKey.startsWith(`${k}/`);
        }),
    ),
  ];
}

/** Folders Claude Code trusts on this machine: keys of `projects` in ~/.claude.json (nothing else is read out of it). */
function claudeTrusted(home: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8")) as { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> };
    return Object.entries(raw.projects ?? {})
      .filter(([k, v]) => k.length <= 1024 && v?.hasTrustDialogAccepted === true)
      .map(([k]) => k);
  } catch {
    return [];
  }
}

const CACHE_MS = 5 * 60_000;
let cache: { at: number; found: { path: string; source: string }[] } | null = null;

export function knownProjects(db: DatabaseSync, exclude: string[]): KnownProject[] {
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_MS) {
    const st = lastAutoStatus();
    const found: { path: string; source: string }[] = [];
    for (const r of strings(st?.repos)) found.push({ path: r, source: "scope" });
    for (const r of strings(st?.team_roots)) found.push({ path: r, source: "team" });
    for (const r of strings(st?.out)) found.push({ path: r, source: "closed" });
    for (const p of readPins()) found.push({ path: p.root, source: "pin" });
    const rows = db.prepare("SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL").all() as { cwd: string }[];
    for (const r of rows) {
      const p = projectOf(r.cwd);
      if (p) found.push({ path: p.root, source: "session" });
    }
    const home = os.homedir();
    for (const r of claudeTrusted(home)) found.push({ path: r, source: "claude" });
    for (const r of scanRepos(scanBases(found.map((f) => f.path), home))) found.push({ path: r, source: "disk" });
    cache = { at: now, found };
  }
  return mergeKnown(cache.found, exclude).filter((k) => {
    try {
      return fs.statSync(k.path).isDirectory();
    } catch {
      return false;
    }
  });
}
