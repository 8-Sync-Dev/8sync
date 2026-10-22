// "Dự án trên máy" (owner 2026-10-22: "nên có chỗ hiển thị all dự án trong máy để bấm mở"): every repo
// root this machine's 8sync has seen, so a project opens with one tap instead of a typed path. Pure
// merge here; the sources are read in lib/server/known-projects.ts. Tested in tests/known-projects.test.ts.
import { rootKey } from "./preview";

export type KnownProject = { path: string; name: string; /** Where it was seen: auto scope, team root, pin, a session's folder. */ source: string };

const baseName = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || p;

/** Dedupe by root (case and slashes ignored), first source wins; `exclude` = roots already listed elsewhere (added folders, live groups). */
export function mergeKnown(found: { path: string; source: string }[], exclude: string[]): KnownProject[] {
  const skip = new Set(exclude.map(rootKey));
  const seen = new Set<string>();
  const out: KnownProject[] = [];
  for (const f of found) {
    const k = rootKey(f.path);
    if (!k || skip.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ path: f.path, name: baseName(f.path), source: f.source });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
