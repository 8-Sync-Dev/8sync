// Sidebar project actions: close (hide until new activity) and remove a project that is a git
// worktree (`git worktree remove`, never `--force`). Every root comes from HQ's own list (rooms it
// has seen, folders added in the sidebar), never from the request; git runs argv-only.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { repoOf, groupKey, type HiddenProject } from "@/lib/sidebar";
import { parseWorktreeList, within, worktreeVerdict, type WorktreeFacts, type WorktreeVerdict } from "@/lib/worktree";
import { withMissing, type ProjectRow } from "./db";
import { loadFloor, ompSessions } from "./floor";
import { projectOf } from "./office";
import { mergedSessions, run, type SessionView } from "./proc";
import { tail } from "./team";

/**
 * Project roots HQ knows, keyed like the sidebar (lib/sidebar.ts groupKey): the repo of every room it
 * has seen (worktrees fold into their repo, ended rooms count) and every folder added in the sidebar.
 * `live`: the rooms still running, for the "phòng còn chạy" guard.
 */
export async function projectRoots(db: DatabaseSync): Promise<{ roots: Map<string, string>; live: SessionView[] }> {
  const [merged, floor] = await Promise.all([mergedSessions(db).catch(() => [] as SessionView[]), loadFloor(db).catch(() => [])]);
  const all = [...merged, ...ompSessions(db, floor)];
  const now = Date.now();
  const roots = new Map<string, string>();
  for (const s of all) {
    if (!s.cwd) continue;
    const root = repoOf(projectOf(s.cwd, now)?.root ?? s.cwd).root;
    roots.set(groupKey(root), root);
  }
  const added = withMissing(db.prepare("SELECT id, path, name, added_at FROM projects").all() as ProjectRow[]);
  for (const p of added) if (!p.missing) roots.set(groupKey(p.path), p.path);
  return { roots, live: all.filter((s) => s.status !== "ended") };
}

/** Close a project in the sidebar; closing again restarts the clock (new activity counts from now). */
export function hideProject(db: DatabaseSync, root: string, now = Date.now()): HiddenProject {
  const row: HiddenProject = { key: groupKey(root), root, name: path.basename(root.replace(/[/\\]+$/, "")) || root, hidden_at: now };
  db.prepare(
    "INSERT INTO hidden_projects(key, root, name, hidden_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET root = excluded.root, name = excluded.name, hidden_at = excluded.hidden_at",
  ).run(row.key, row.root, row.name, row.hidden_at);
  return row;
}

export function showProject(db: DatabaseSync, key: string): boolean {
  return Number(db.prepare("DELETE FROM hidden_projects WHERE key = ?").run(key).changes) > 0;
}

/**
 * A linked git worktree on disk: `.git` is a file pointing into `<repo>/.git/worktrees/<name>`
 * (a submodule's `.git` file points into `.git/modules`). No process; the remove re-checks with git.
 */
export function looksLikeWorktree(root: string): boolean {
  try {
    const dotgit = path.join(root, ".git");
    if (!fs.statSync(dotgit).isFile()) return false;
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, "utf8").slice(0, 4096));
    return !!m && /[/\\]worktrees[/\\][^/\\]+[/\\]?$/.test(m[1].trim());
  } catch {
    return false;
  }
}

const SHA = /^[0-9a-f]{40,64}$/;

/** A `git rev-list --count` answer, null when git failed or printed something else. */
async function count(args: string[], cwd: string): Promise<number | null> {
  const r = await run("git", args, 15_000, cwd);
  const out = r.stdout.trim();
  return r.ok && /^\d+$/.test(out) ? Number(out) : null;
}

/** Everything the delete guard decides on, read from git in the worktree itself. */
export async function worktreeFacts(root: string, live: SessionView[]): Promise<WorktreeFacts> {
  const list = await run("git", ["worktree", "list", "--porcelain"], 8_000, root);
  const entries = list.ok ? parseWorktreeList(list.stdout) : [];
  const main = entries[0] ?? null;
  const me = entries.find((e) => groupKey(e.path) === groupKey(root)) ?? null;
  const facts: WorktreeFacts = {
    path: me?.path ?? root,
    main: main?.path ?? null,
    mainBranch: main?.branch ?? null,
    linked: !!me && me !== main && !me.bare && !!main && !main.bare,
    branch: me?.branch ?? null,
    locked: !!me?.locked,
    dirty: null,
    unmerged: null,
    hasRemote: false,
    unpushed: null,
    nested: entries.filter((e) => e !== me && e !== main && within(e.path, root)).map((e) => e.path),
    rooms: live.filter((s) => s.cwd && within(s.cwd, root)).map((s) => s.label),
  };
  if (!facts.linked || !main) return facts;
  const [status, remotes] = await Promise.all([
    run("git", ["status", "--porcelain", "--untracked-files=all"], 15_000, root),
    run("git", ["remote"], 8_000, root),
  ]);
  facts.dirty = status.ok ? status.stdout.split(/\r?\n/).filter((l) => l.trim() !== "").length : null;
  facts.hasRemote = remotes.ok && remotes.stdout.trim() !== "";
  facts.unmerged = main.head && SHA.test(main.head) ? await count(["rev-list", "--count", "HEAD", "--not", main.head], root) : null;
  facts.unpushed = facts.hasRemote ? await count(["rev-list", "--count", "HEAD", "--not", "--remotes"], root) : null;
  return facts;
}

/** Roots with a remove in flight: a double click must not run two `git worktree remove`. */
const inFlight = new Set<string>();

export type RemoveResult = { ok: true; path: string } | { ok: false; error: string; verdict?: WorktreeVerdict; busy?: boolean };

/** Re-checks every guard, then `git worktree remove <path>` from the main worktree. Never `--force`. */
export async function removeWorktree(root: string, live: SessionView[]): Promise<RemoveResult> {
  const key = groupKey(root);
  if (inFlight.has(key)) return { ok: false, error: "Đang xóa worktree này, đợi lần trước xong.", busy: true };
  inFlight.add(key);
  try {
    const facts = await worktreeFacts(root, live);
    const verdict = worktreeVerdict(facts);
    if (!verdict.ok || !facts.main) return { ok: false, error: verdict.reasons.join(" "), verdict };
    const r = await run("git", ["worktree", "remove", facts.path], 60_000, facts.main);
    if (!r.ok) return { ok: false, error: r.killed ? "git không trả lời sau 60 giây: xem lại thư mục trước khi bấm lần nữa." : tail(r.stderr, 4) || "git worktree remove thất bại." };
    return { ok: true, path: facts.path };
  } finally {
    inFlight.delete(key);
  }
}
