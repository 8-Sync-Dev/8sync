import { describe, expect, it } from "vitest";
import { branchIndex, branchLabel, folderNote, groupBranches, homeOf, shownOrder, spotOf, type RepoWorktrees } from "@/lib/branches";
import { groupSessions, moveKey, type TreeSession } from "@/lib/session-tree";
import type { WorktreeEntry } from "@/lib/worktree";

const MAIN = "C:/code/su-code";
const SIBLING = "C:/code/su-code-panes";
const NESTED = "C:/code/su-code/.claude/worktrees/radar";
const DETACHED = "C:/code/su-code-uat";
const IDLE = "C:/code/su-code-zalo";

const wt = (path: string, o: Partial<WorktreeEntry> = {}): WorktreeEntry => ({ path, head: "dfc295002c649dd5e0c59b6bd8b9c8d7102b90ab", branch: null, bare: false, locked: false, ...o });

const repos: RepoWorktrees[] = [
  {
    main: MAIN,
    worktrees: [
      wt(MAIN, { branch: "main" }),
      wt(NESTED, { branch: "radar/20261102-ultra-plan" }),
      wt(SIBLING, { branch: "feat/hq-room-panes" }),
      wt(DETACHED, { head: "fabb2c84c041472b88181ec801f0330bf8684f01" }),
      wt(IDLE, { branch: "docs/zalo-skill", locked: true }),
    ],
  },
  // The same repo reached from its sibling worktree's root: counted once.
  { main: MAIN, worktrees: [wt(MAIN, { branch: "main" })] },
  { main: "C:/code/web", worktrees: [wt("C:/code/web", { branch: "dev" })] },
];
const idx = branchIndex(repos);

const S = (o: Partial<TreeSession> & { key: string }): TreeSession => ({
  kind: "omp",
  title: o.key,
  name: o.key,
  root: MAIN,
  folder: "su-code",
  worktree: null,
  state: "idle",
  at: null,
  created: null,
  doing: null,
  ompId: o.key,
  cwd: MAIN,
  room: null,
  children: [],
  ...o,
});

describe("branchIndex / spotOf", () => {
  it("maps a folder to the deepest worktree that holds it, with its branch", () => {
    expect(spotOf("C:\\code\\su-code\\apps\\hq-ui", idx)).toMatchObject({ path: MAIN, main: true, label: "main" });
    // `.claude/worktrees/radar` sits inside the main worktree: the deeper one wins.
    expect(spotOf(`${NESTED}/src`, idx)).toMatchObject({ path: NESTED, main: false, label: "radar/20261102-ultra-plan", repo: MAIN });
    expect(spotOf("c:\\CODE\\su-code-panes\\apps", idx)).toMatchObject({ path: SIBLING, repoName: "su-code", label: "feat/hq-room-panes" });
    expect(spotOf("C:/code/elsewhere", idx)).toBeNull();
    expect(spotOf(MAIN, null)).toBeNull();
  });

  it("dedupes a repo listed twice and drops bare entries", () => {
    expect(idx.repos.get("c:/code/su-code")).toHaveLength(5);
    const bare = branchIndex([{ main: "C:/r.git", worktrees: [wt("C:/r.git", { bare: true }), wt("C:/r-dev", { branch: "dev" })] }]);
    expect(bare.spots.map((s) => [s.path, s.main])).toEqual([["C:/r-dev", false]]);
  });

  it("labels a detached HEAD by its short commit", () => {
    expect(branchLabel({ branch: null, head: "fabb2c84c041472b88181ec801f0330bf8684f01" })).toBe("HEAD @ fabb2c8");
    expect(spotOf(DETACHED, idx)?.label).toBe("HEAD @ fabb2c8");
    expect(branchLabel({ branch: null, head: null })).toBe("HEAD tách rời");
  });

  it("names the folder only when the branch does not already say it", () => {
    expect(folderNote(spotOf(SIBLING, idx)!)).toBe("su-code-panes");
    expect(folderNote({ main: false, name: "radar", branch: "card/radar" })).toBeNull();
    expect(folderNote({ main: false, name: "dev", branch: "dev" })).toBeNull();
    expect(folderNote(spotOf(MAIN, idx)!)).toBeNull();
  });
});

describe("homeOf / groupSessions with branches", () => {
  const list = [
    S({ key: "main-1", created: 5 }),
    S({ key: "panes-1", root: SIBLING, folder: "su-code-panes", cwd: SIBLING, created: 4 }),
    S({ key: "radar-1", cwd: NESTED, worktree: "radar", created: 3 }),
    S({ key: "web-1", root: "C:/code/web", folder: "web", cwd: "C:/code/web", created: 2 }),
    S({ key: "loose", root: "C:/tmp/notes", folder: "notes", cwd: "C:/tmp/notes", created: 1 }),
  ];

  it("folds a sibling worktree folder into its repo's project group", () => {
    expect(homeOf(list[1], idx)).toEqual({ key: "c:/code/su-code", root: MAIN, label: "su-code" });
    // Without git's lists it stays its own project, as before.
    expect(homeOf(list[1], null).key).toBe("c:/code/su-code-panes");
    const groups = groupSessions(list, "project", "name", undefined, idx);
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.key)])).toEqual([
      ["notes", ["loose"]],
      ["su-code", ["main-1", "panes-1", "radar-1"]],
      ["web", ["web-1"]],
    ]);
  });

  it("shows the main worktree first, then linked ones by their first session, and counts the idle ones", () => {
    const g = groupSessions(list, "project", "manual", { sessions: ["radar-1", "panes-1", "main-1"], groups: [] }, idx).find((x) => x.label === "su-code")!;
    expect(g.sessions.map((s) => s.key)).toEqual(["radar-1", "panes-1", "main-1"]);
    const b = groupBranches(g, idx)!;
    expect(b.sections.map((x) => [x.spot?.label, x.spot?.main, x.sessions.map((s) => s.key)])).toEqual([
      ["main", true, ["main-1"]],
      ["radar/20261102-ultra-plan", false, ["radar-1"]],
      ["feat/hq-room-panes", false, ["panes-1"]],
    ]);
    expect(b.idle.map((s) => s.label)).toEqual(["docs/zalo-skill", "HEAD @ fabb2c8"]);
    // Drag & drop reads the list as it stands on screen, across the branch headers.
    const shown = shownOrder(g, b).map((s) => s.key);
    expect(shown).toEqual(["main-1", "radar-1", "panes-1"]);
    expect(moveKey([], shown, "panes-1", "main-1")).toEqual(["panes-1", "main-1", "radar-1"]);
  });

  it("puts the main worktree among the idle ones when no session runs there", () => {
    const g = groupSessions([list[1]], "project", "manual", undefined, idx)[0];
    const b = groupBranches(g, idx)!;
    expect(b.sections.map((x) => x.spot?.label)).toEqual(["feat/hq-room-panes"]);
    expect(b.idle.map((s) => [s.label, s.main])).toEqual([
      ["main", true],
      ["docs/zalo-skill", false],
      ["HEAD @ fabb2c8", false],
      ["radar/20261102-ultra-plan", false],
    ]);
  });

  it("still names the branch of a repo with one worktree, and leaves non-git groups alone", () => {
    const [web] = groupSessions([list[3]], "project", "manual", undefined, idx);
    expect(groupBranches(web, idx)).toEqual({ sections: [{ key: "c:/code/web", spot: expect.objectContaining({ label: "dev", main: true }), sessions: [list[3]] }], idle: [] });
    const [notes] = groupSessions([list[4]], "project", "manual", undefined, idx);
    expect(groupBranches(notes, idx)).toBeNull();
    expect(groupBranches(web, null)).toBeNull();
    expect(shownOrder(notes, null)).toEqual(notes.sessions);
  });

  it("keeps sessions git places nowhere above the branch headers, without one", () => {
    const g = { root: MAIN, sessions: [S({ key: "a" }), S({ key: "lost", cwd: "D:/other", root: MAIN })] };
    expect(groupBranches(g, idx)!.sections.map((x) => [x.key, x.sessions.map((s) => s.key)])).toEqual([
      ["~loose", ["lost"]],
      ["c:/code/su-code", ["a"]],
    ]);
  });
});
