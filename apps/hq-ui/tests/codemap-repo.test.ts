import { describe, expect, it } from "vitest";
import { repoProject } from "@/lib/codemap";

// Which registered project a bot's Bản đồ code tab shows (components/hq/hq-app.tsx botViews).
describe("repoProject", () => {
  const suCode = { id: 1, path: "C:\\Users\\Projects\\su-code", missing: false };
  const game = { id: 2, path: "C:/Users/Projects/startup/8sync-startup/game/3d-game/", missing: false };
  const projects = [suCode, game];

  it("the bot's repo, whatever the case, slashes or `\\\\?\\` prefix", () => {
    expect(repoProject(projects, ["C:\\Users\\Projects\\su-code"])).toBe(suCode);
    expect(repoProject(projects, ["c:/users/projects/SU-CODE/"])).toBe(suCode);
    expect(repoProject(projects, ["\\\\?\\C:\\Users\\Projects\\su-code"])).toBe(suCode);
    expect(repoProject(projects, ["C:\\Users\\Projects\\startup\\8sync-startup\\game\\3d-game"])).toBe(game);
  });

  it("a cwd inside the repo or a .claude worktree of it", () => {
    expect(repoProject(projects, [null, undefined, "C:\\Users\\Projects\\su-code\\apps\\hq-ui"])).toBe(suCode);
    expect(repoProject(projects, ["C:\\Users\\Projects\\su-code\\.claude\\worktrees\\core"])).toBe(suCode);
    // Any one of the bot's folders (root, git top-level, cwd) is enough.
    expect(repoProject(projects, ["D:\\elsewhere", "C:\\Users\\Projects\\su-code"])).toBe(suCode);
  });

  it("the deepest registered folder wins", () => {
    const startup = { id: 3, path: "C:\\Users\\Projects\\startup\\8sync-startup" };
    expect(repoProject([startup, game], ["C:\\Users\\Projects\\startup\\8sync-startup\\game\\3d-game\\src"])).toBe(game);
    expect(repoProject([game, startup], ["C:\\Users\\Projects\\startup\\8sync-startup\\tia"])).toBe(startup);
  });

  it("none: a parent of registered repos, a sibling with a shared prefix, a missing folder, no folder", () => {
    // Bot `coding` in 8sync-startup: 3d-game is inside it, not its repo → the enable prompt.
    expect(repoProject(projects, ["C:\\Users\\Projects\\startup\\8sync-startup"])).toBeNull();
    expect(repoProject(projects, ["C:\\Users\\Projects\\su-code-codemap"])).toBeNull();
    expect(repoProject([{ ...suCode, missing: true }], ["C:\\Users\\Projects\\su-code"])).toBeNull();
    expect(repoProject(projects, [null, ""])).toBeNull();
    expect(repoProject([], ["C:\\Users\\Projects\\su-code"])).toBeNull();
  });
});
