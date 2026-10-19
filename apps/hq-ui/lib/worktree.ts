// Removing a project that is a git worktree from the sidebar ("Xóa"): what git says about it, and
// whether HQ may run `git worktree remove` (never `--force`). Pure, no I/O; the facts come from
// lib/server/worktree.ts. Tested in tests/worktree.test.ts.
import { groupKey } from "./sidebar";

/** One block of `git worktree list --porcelain`. */
export type WorktreeEntry = { path: string; head: string | null; branch: string | null; bare: boolean; locked: boolean };

/** `git worktree list --porcelain`: the main worktree first, then the linked ones. */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  const list: WorktreeEntry[] = [];
  let cur: WorktreeEntry | null = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice(9), head: null, branch: null, bare: false, locked: false };
      list.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "bare") cur.bare = true;
    else if (line === "locked" || line.startsWith("locked ")) cur.locked = true;
  }
  return list;
}

/** `inner` is `outer` itself or a folder below it (paths compared like the sidebar keys them). */
export function within(inner: string, outer: string): boolean {
  const i = groupKey(inner);
  const o = groupKey(outer);
  return i === o || i.startsWith(`${o}/`);
}

/**
 * What HQ knows about one folder before removing it. A count is null when its git command failed:
 * unknown counts as unsafe. `unpushed` is null too when the repo has no remote (nothing to push to).
 */
export type WorktreeFacts = {
  path: string;
  /** The repo's main worktree (`git worktree list` first entry), null when git does not list one. */
  main: string | null;
  mainBranch: string | null;
  /** Listed by git as a linked worktree of `main` (never the main worktree, never bare). */
  linked: boolean;
  branch: string | null;
  locked: boolean;
  /** `git status --porcelain --untracked-files=all` lines. */
  dirty: number | null;
  /** Commits on HEAD the main worktree's HEAD does not have. */
  unmerged: number | null;
  hasRemote: boolean;
  /** Commits on HEAD no remote-tracking branch has. */
  unpushed: number | null;
  /** Other worktrees inside this folder (`git worktree remove` would delete them with it). */
  nested: string[];
  /** Labels of the rooms still running inside this folder. */
  rooms: string[];
};

export type WorktreeVerdict = { ok: boolean; reasons: string[] };

/** May HQ remove this worktree? Every reason is one sentence for the owner, in the order to fix them. */
export function worktreeVerdict(f: WorktreeFacts): WorktreeVerdict {
  if (f.main && groupKey(f.main) === groupKey(f.path)) {
    return { ok: false, reasons: ["Đây là repo chính, không phải worktree: HQ không bao giờ xóa repo chính."] };
  }
  if (!f.linked) return { ok: false, reasons: ["Git không liệt kê thư mục này là worktree của repo nào: HQ chỉ xóa worktree."] };
  const reasons: string[] = [];
  if (f.rooms.length) reasons.push(`Còn ${f.rooms.length} phòng chạy trong worktree (${f.rooms.join(", ")}): đóng phòng trước.`);
  if (f.locked) reasons.push("Worktree đang bị khóa (git worktree lock): mở khóa trong terminal nếu chắc chắn bỏ.");
  if (f.nested.length) reasons.push(`Có worktree khác nằm bên trong (${f.nested.map((p) => p.split(/[/\\]/).pop()).join(", ")}): xóa worktree đó trước.`);
  if (f.dirty == null) reasons.push("Không đọc được git status của worktree.");
  else if (f.dirty > 0) reasons.push(`Còn ${f.dirty} file chưa commit.`);
  if (f.unmerged == null) reasons.push("Không so được với nhánh chính.");
  else if (f.unmerged > 0) reasons.push(`Có ${f.unmerged} commit chưa merge vào ${f.mainBranch ?? "nhánh chính"}.`);
  if (f.hasRemote) {
    if (f.unpushed == null) reasons.push("Không kiểm tra được commit chưa push.");
    else if (f.unpushed > 0) reasons.push(`Có ${f.unpushed} commit chưa push.`);
  }
  return { ok: reasons.length === 0, reasons };
}
