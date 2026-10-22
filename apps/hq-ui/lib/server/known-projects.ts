// Sources of "Dự án trên máy": auto's scope / team roots / closed projects (last `auto status`), pinned
// roots, and the repo of every session HQ has recorded. Only folders that still exist are returned.
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { mergeKnown, type KnownProject } from "../known-projects";
import { lastAutoStatus } from "./auto";
import { projectOf, readPins } from "./office";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= 1024) : []);

export function knownProjects(db: DatabaseSync, exclude: string[]): KnownProject[] {
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
  return mergeKnown(found, exclude).filter((k) => {
    try {
      return fs.statSync(k.path).isDirectory();
    } catch {
      return false;
    }
  });
}
