import { describe, expect, it } from "vitest";
import { parseWorktreeList, within, worktreeVerdict, type WorktreeFacts } from "@/lib/worktree";

const MAIN = "C:/code/game";
const WT = "C:/code/game/.claude/worktrees/card-113-dev";

const clean: WorktreeFacts = {
  path: WT,
  main: MAIN,
  mainBranch: "main",
  linked: true,
  branch: "card-113-dev",
  locked: false,
  dirty: 0,
  unmerged: 0,
  hasRemote: true,
  unpushed: 0,
  nested: [],
  rooms: [],
};

describe("parseWorktreeList", () => {
  it("reads git's porcelain blocks: main first, branch, detached, locked, bare", () => {
    const out = [
      `worktree ${MAIN}`,
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      `worktree ${WT}`,
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feat/card-113",
      "locked reason here",
      "",
      "worktree C:/code/game/.claude/worktrees/x",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "",
    ].join("\r\n");
    expect(parseWorktreeList(out)).toEqual([
      { path: MAIN, head: "1111111111111111111111111111111111111111", branch: "main", bare: false, locked: false },
      { path: WT, head: "2222222222222222222222222222222222222222", branch: "feat/card-113", bare: false, locked: true },
      { path: "C:/code/game/.claude/worktrees/x", head: "3333333333333333333333333333333333333333", branch: null, bare: false, locked: false },
    ]);
    expect(parseWorktreeList("worktree /r\nbare\n")[0].bare).toBe(true);
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("within", () => {
  it("matches the folder itself and below it, across slash styles and case, never a sibling prefix", () => {
    expect(within("c:\\code\\game\\.claude\\worktrees\\card-113-dev\\src", WT)).toBe(true);
    expect(within(`${WT}/`, WT)).toBe(true);
    expect(within("C:/code/game/.claude/worktrees/card-113-dev-2", WT)).toBe(false);
    expect(within(MAIN, WT)).toBe(false);
  });
});

describe("worktreeVerdict", () => {
  it("allows a clean, merged, pushed worktree with no room", () => {
    expect(worktreeVerdict(clean)).toEqual({ ok: true, reasons: [] });
  });

  it("never removes a main repo, whatever else holds", () => {
    const v = worktreeVerdict({ ...clean, path: MAIN.toUpperCase(), linked: false });
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual([expect.stringContaining("repo chính")]);
    // Even a bogus "linked" flag cannot turn the main worktree deletable.
    expect(worktreeVerdict({ ...clean, path: MAIN, linked: true }).ok).toBe(false);
  });

  it("refuses a folder git does not list as a linked worktree", () => {
    expect(worktreeVerdict({ ...clean, main: null, linked: false })).toEqual({ ok: false, reasons: [expect.stringContaining("chỉ xóa worktree")] });
  });

  it("names every blocker: live room, lock, nested worktree, dirty, unmerged, unpushed", () => {
    const v = worktreeVerdict({ ...clean, rooms: ["dev"], locked: true, nested: [`${WT}/.claude/worktrees/card-147-fix`], dirty: 3, unmerged: 2, unpushed: 5 });
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual([
      "Còn 1 phòng chạy trong worktree (dev): đóng phòng trước.",
      expect.stringContaining("bị khóa"),
      "Có worktree khác nằm bên trong (card-147-fix): xóa worktree đó trước.",
      "Còn 3 file chưa commit.",
      "Có 2 commit chưa merge vào main.",
      "Có 5 commit chưa push.",
    ]);
  });

  it("treats a check that failed as unsafe", () => {
    const v = worktreeVerdict({ ...clean, dirty: null, unmerged: null, unpushed: null });
    expect(v.ok).toBe(false);
    expect(v.reasons).toHaveLength(3);
  });

  it("skips the push check when the repo has no remote", () => {
    expect(worktreeVerdict({ ...clean, hasRemote: false, unpushed: null }).ok).toBe(true);
  });
});
