import { describe, expect, it } from "vitest";
import type { ProjectInfo } from "@/lib/office";
import { groupByRepo, meetingShown, worktreeOf } from "@/lib/sidebar";

const R = "C:\\code\\ai-game-studio";
const room = (key: string, project: ProjectInfo | null) => ({ key, cwd: project?.root ?? null, project });

describe("office rooms by repo (worktrees fold under their repo)", () => {
  const rooms = [
    room("dev", { root: `${R}\\.claude\\worktrees\\card-14-bakeoff`, name: "card-14-bakeoff", branch: "card-14-art-bakeoff" }),
    room("lead", { root: R, name: "ai-game-studio", branch: "main" }),
    room("qa", { root: R, name: "ai-game-studio", branch: "main" }),
    room("rd", { root: "/home/u/su-code/.claude/worktrees/card-17", name: "card-17", branch: "card-17-ci" }),
    room("x", null),
  ];

  it("one group per repo: the worktree room joins the repo's group under the repo's root, name and branch", () => {
    const g = groupByRepo(rooms);
    const game = g.find((x) => x.project.name === "ai-game-studio")!;
    expect(game.project).toEqual({ root: R, name: "ai-game-studio", branch: "main" });
    expect(game.rooms.map((r) => r.key).sort()).toEqual(["dev", "lead", "qa"]);
    // The room keeps its own project: its card shows the worktree branch.
    expect(game.rooms.find((r) => r.key === "dev")!.project!.branch).toBe("card-14-art-bakeoff");
    expect(g.filter((x) => x.project.name === "card-14-bakeoff")).toEqual([]);
  });

  it("a worktree room alone still groups under its repo (no repo room: branch unknown)", () => {
    const su = groupByRepo(rooms).find((x) => x.rooms.some((r) => r.key === "rd"))!;
    expect(su.project).toEqual({ root: "/home/u/su-code", name: "su-code", branch: null });
  });

  it("worktreeOf: the worktree folder for a worktree room, null otherwise", () => {
    expect(worktreeOf(rooms[0])).toBe("card-14-bakeoff");
    expect(worktreeOf(rooms[1])).toBeNull();
    expect(worktreeOf(rooms[4])).toBeNull();
  });

  it("meeting room only with two or more rooms in the repo", () => {
    expect(meetingShown(1)).toBe(false);
    expect(meetingShown(0)).toBe(false);
    expect(meetingShown(2)).toBe(true);
  });
});
