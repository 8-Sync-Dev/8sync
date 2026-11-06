import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { repoWorktrees } from "@/lib/server/branches";
import { groupKey } from "@/lib/sidebar";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let dir = "";
let main = "";
let sibling = "";
let plain = "";

beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-branches-")));
  main = path.join(dir, "game");
  sibling = path.join(dir, "game-panes");
  plain = path.join(dir, "notes");
  fs.mkdirSync(main);
  fs.mkdirSync(plain);
  git(main, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(main, "a.txt"), "a");
  git(main, "add", "a.txt");
  git(main, "commit", "-q", "-m", "first");
  git(main, "worktree", "add", "-q", "-b", "feat/panes", sibling);
});

describe("repoWorktrees", () => {
  it("lists each repo once (from its main or a linked worktree), main first, and skips non-git folders", async () => {
    const repos = await repoWorktrees([sibling, plain, main], { fresh: true });
    expect(repos).toHaveLength(1);
    expect(groupKey(repos[0].main)).toBe(groupKey(main));
    expect(repos[0].worktrees.map((w) => [groupKey(w.path), w.branch])).toEqual([
      [groupKey(main), "main"],
      [groupKey(sibling), "feat/panes"],
    ]);
  });

  it("answers from its 20 s cache until asked fresh", async () => {
    const third = path.join(dir, "game-detached");
    git(main, "worktree", "add", "-q", "--detach", third);
    const cached = await repoWorktrees([main]);
    expect(cached[0].worktrees).toHaveLength(2);
    const fresh = await repoWorktrees([main], { fresh: true });
    // Git lists the linked worktrees by path: game-detached before game-panes.
    expect(fresh[0].worktrees.map((w) => w.branch)).toEqual(["main", null, "feat/panes"]);
  });
});
