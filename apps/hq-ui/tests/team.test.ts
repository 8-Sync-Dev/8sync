import { beforeAll, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async () => ({ ok: true, stdout: "\x1b[32m✓\x1b[0m lead mở\n✓ dev mở\n", stderr: "" })));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: async () => [{ name: "s1", cwd: "C:\\repo\\game", status: "running" }],
}));

import { POST } from "@/app/api/team/route";
import { getToken } from "@/lib/server/auth";
import { onePerBoard, type ProjectBoard } from "@/lib/server/board";
import { tail, teamArgs } from "@/lib/server/team";
import { ORIGIN, req, tempHome } from "./helpers";

const empty = { lanes: { backlog: [], ready: [], building: [], qa: [], review: [], approved: [], blocked: [] }, closed: [] } as unknown as ProjectBoard["board"];
const row = (root: string, filed: string | null, error: string | null = null): ProjectBoard => ({ root, name: root.split(/[\\/]/).pop()!, board: error ? null : empty, error, filed });

describe("onePerBoard", () => {
  it("keeps a repo nested in another repo as its own board (UAT: ai-game-studio inside 8sync-startup)", () => {
    const out = onePerBoard([row("C:\\s\\8sync-startup", "C:\\s\\8sync-startup"), row("C:\\s\\8sync-startup\\game\\ai-game-studio", "C:\\s\\8sync-startup\\game\\ai-game-studio")]);
    expect(out.map((b) => b.name).sort()).toEqual(["8sync-startup", "ai-game-studio"]);
  });

  it("folds a worktree into its repo's board, named after the repo", () => {
    const repo = "C:\\s\\game";
    const out = onePerBoard([row(`${repo}\\.claude\\worktrees\\card-5`, repo), row(repo, repo)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ root: repo, name: "game" });
    // Only the worktree has a room: it still speaks for the repo's board.
    const solo = onePerBoard([row(`${repo}\\.claude\\worktrees\\card-5`, repo)]);
    expect(solo).toMatchObject([{ root: `${repo}\\.claude\\worktrees\\card-5`, name: "game" }]);
  });

  it("matches Rust's canonical \\\\?\\ path on Windows to the room's own root", () => {
    const repo = "C:\\s\\game";
    const out = onePerBoard([row(`${repo}\\.claude\\worktrees\\card-5`, "\\\\?\\C:\\s\\game"), row(repo, "\\\\?\\C:\\s\\game")]);
    expect(out).toMatchObject([{ root: repo, name: "game" }]);
  });

  it("falls back to the outermost root when 8sync does not say where the board is filed", () => {
    const out = onePerBoard([row("/a", null), row("/a/b", null), row("/c", null, "8sync không trả lời")]);
    expect(out.map((b) => b.root)).toEqual(["/a", "/c"]);
  });
});

describe("team", () => {
  it("maps the buttons to auto up / up --clear-ss / down", () => {
    expect(teamArgs("up")).toEqual(["ccc", "auto", "up"]);
    expect(teamArgs("clean")).toEqual(["ccc", "auto", "up", "--clear-ss"]);
    expect(teamArgs("down")).toEqual(["ccc", "auto", "down"]);
    expect(tail("\x1b[1mone\x1b[0m\n\n two \n")).toBe("one\n two ");
  });

  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
  });
  const post = (body: unknown) => POST(req("/api/team", { method: "POST", token, origin: ORIGIN, body }));

  it("runs only in a project HQ shows, in that root", async () => {
    const ok = await post({ root: "c:\\REPO\\game", action: "clean" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, output: "✓ lead mở\n✓ dev mở" });
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "up", "--clear-ss"], 180_000, "C:\\repo\\game");
    run.mockClear();
    expect((await post({ root: "C:\\Windows", action: "up" })).status).toBe(409);
    expect((await post({ root: "C:\\repo\\game", action: "rm -rf" })).status).toBe(422);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a second run in the same root while one is in flight (a second tab, a double click)", async () => {
    let finish: (v: unknown) => void = () => {};
    run.mockImplementationOnce(() => new Promise((r) => (finish = r)) as never);
    const first = post({ root: "C:\\repo\\game", action: "clean" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await post({ root: "C:\\repo\\game", action: "up" });
    expect(second.status).toBe(409);
    finish({ ok: true, stdout: "done", stderr: "" });
    expect((await first).status).toBe(200);
    run.mockResolvedValueOnce({ ok: true, stdout: "again", stderr: "" });
    expect((await post({ root: "C:\\repo\\game", action: "up" })).status).toBe(200);
  });
});
