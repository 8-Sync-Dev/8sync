// The projects HQ shows a board and ⚡ buttons for. Live rooms alone are not enough: when
// `claude agents` is down (claude off PATH, an older Claude Code, a long outage, the first probe of a
// cold start) no session is alive and every board would vanish, with ⚡ Làm ngay answering 409.
// The team roots 8sync keeps (`auto up` adds, `auto down` drops) stand in for them.
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { ProjectInfo } from "../office";
import { withMissing, type ProjectRow } from "./db";
import { projectOf } from "./office";
import { teamRootsPath } from "./paths";
import { mergedSessions } from "./proc";
import { liveProjects } from "./targets";

/** One spelling per folder: `\\` vs `/`, case, the `\\?\\` prefix Rust adds on Windows, a trailing slash. */
const key = (p: string) => p.replace(/\\/g, "/").replace(/^\/\/\?\//, "").replace(/\/+$/, "").toLowerCase();

/** `team-roots.json`: absolute roots (Rust may write the `\\?\` prefix); [] when absent or unreadable. */
export function teamRoots(file = teamRootsPath()): string[] {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(v) ? v.filter((r): r is string => typeof r === "string" && r.length > 0).map((r) => r.replace(/^\\\\\?\\/, "")) : [];
  } catch {
    return [];
  }
}

/** Projects with a live room, then the team roots no live room covers; one per root. */
export async function projectsInView(db: DatabaseSync): Promise<ProjectInfo[]> {
  const out = liveProjects(await mergedSessions(db).catch(() => []), (cwd) => projectOf(cwd));
  const seen = new Set(out.map((p) => key(p.root)));
  for (const r of teamRoots()) {
    const p = projectOf(r);
    if (p && !seen.has(key(p.root))) {
      seen.add(key(p.root));
      out.push(p);
    }
  }
  return out;
}

/**
 * The root an action names, when HQ shows it (projectsInView, or a folder added in the sidebar,
 * as `/api/team` accepts), in its own spelling; null for any other path.
 */
export async function knownRoot(db: DatabaseSync, root: string): Promise<string | null> {
  const added = withMissing(db.prepare("SELECT id, path, name, added_at FROM projects").all() as ProjectRow[])
    .filter((p) => !p.missing)
    .map((p) => p.path);
  const want = key(root);
  return [...(await projectsInView(db)).map((p) => p.root), ...added].find((r) => key(r) === want) ?? null;
}
