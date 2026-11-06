// Every git worktree of the project roots HQ knows, for the sidebar's branches (lib/branches.ts).
// Git runs argv-only (`git worktree list --porcelain`), in those roots only, 4 at a time, 8 s each;
// each root's answer is kept 20 s so the sidebar's poll does not fork git on every call.
import type { RepoWorktrees } from "@/lib/branches";
import { groupKey } from "@/lib/sidebar";
import { parseWorktreeList, type WorktreeEntry } from "@/lib/worktree";
import { run } from "./proc";

const TTL_MS = 20_000;
const PARALLEL = 4;

/** Per root: git's list (null: not a git folder, or git failed) and when it was read. */
const cache = new Map<string, { at: number; list: Promise<WorktreeEntry[] | null> }>();

function listOf(root: string, now: number, fresh: boolean): Promise<WorktreeEntry[] | null> {
  const key = groupKey(root);
  const hit = cache.get(key);
  if (hit && !fresh && now - hit.at < TTL_MS) return hit.list;
  const list = run("git", ["worktree", "list", "--porcelain"], 8_000, root).then((r) => {
    const entries = r.ok ? parseWorktreeList(r.stdout) : [];
    return entries.length ? entries : null;
  });
  cache.set(key, { at: now, list });
  return list;
}

/**
 * The repos behind `roots`, each once (two roots of one repo, or a worktree and its repo, give the
 * same main worktree). Non-git roots are skipped. `fresh`: ask git again (the session folders changed).
 */
export async function repoWorktrees(roots: readonly string[], opts: { fresh?: boolean; now?: number } = {}): Promise<RepoWorktrees[]> {
  const now = opts.now ?? Date.now();
  const out: (WorktreeEntry[] | null)[] = new Array(roots.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < roots.length) {
      const i = next++;
      out[i] = await listOf(roots[i], now, !!opts.fresh);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, roots.length) }, worker));
  const repos = new Map<string, RepoWorktrees>();
  for (const list of out) {
    if (!list) continue;
    const main = list[0].path;
    if (!repos.has(groupKey(main))) repos.set(groupKey(main), { main, worktrees: list });
  }
  return [...repos.values()];
}
