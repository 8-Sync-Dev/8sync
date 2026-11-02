import { describe, expect, it } from "vitest";
import {
  EMPTY_WORKSPACE,
  MAX_PANES,
  agoVi,
  browseStart,
  closePane,
  filterProjects,
  folderName,
  isOmpModel,
  isOmpSessionName,
  mergeProjects,
  openPane,
  paneGrid,
  parseOmpRows,
  pushRecent,
  readWorkspace,
  shortPath,
  tokensShort,
  type Pane,
} from "@/lib/omp-workspace";

const pane = (n: number): Pane => ({ id: `omp-${String(n).padStart(16, "0")}`, name: `s${n}`, cwd: "C:\\w" });

describe("workspace rules", () => {
  it("session names and models are what `ccc term --omp-new` takes", () => {
    for (const ok of ["core", "fix-login", "ui.v2", "a_b", "9"]) expect(isOmpSessionName(ok), ok).toBe(true);
    for (const bad of ["", "Core", "-x", ".x", "a b", "../x", "ls", "new", "merge", "x".repeat(49), 5]) expect(isOmpSessionName(bad), String(bad)).toBe(false);
    expect(isOmpModel("zai/glm-5.3") && isOmpModel("anthropic/claude-opus:high")).toBe(true);
    expect(isOmpModel("--continue") || isOmpModel("a b") || isOmpModel("m;rm") || isOmpModel("")).toBe(false);
  });

  it("keeps only omp rows with a name from `8sync . ls --json`", () => {
    expect(parseOmpRows('[{"engine":"omp","name":"a"},{"engine":"ccc","name":"b"},{"x":1},null]')).toEqual([{ engine: "omp", name: "a" }]);
    expect(parseOmpRows("not json")).toEqual([]);
    expect(parseOmpRows("{}")).toEqual([]);
  });

  it("formats time and tokens short", () => {
    const now = 1_000_000_000_000;
    expect(agoVi(now / 1000 - 5, now)).toBe("vừa xong");
    expect(agoVi(now / 1000 - 300, now)).toBe("5 phút");
    expect(agoVi(now / 1000 - 7200, now)).toBe("2 giờ");
    expect(agoVi(now / 1000 - 3 * 86_400, now)).toBe("3 ngày");
    expect(agoVi(null, now)).toBe("");
    expect([tokensShort(191_200), tokensShort(1_250_000), tokensShort(900), tokensShort(0)]).toEqual(["191k", "1.3M", "900", ""]);
  });

  it("opens panes up to MAX_PANES, dropping the oldest inactive one; reopening focuses", () => {
    let s = EMPTY_WORKSPACE;
    for (let i = 1; i <= MAX_PANES; i++) s = openPane(s, pane(i));
    expect(s.panes).toHaveLength(MAX_PANES);
    expect(s.active).toBe(pane(MAX_PANES).id);
    s = openPane(s, pane(2));
    expect(s.active).toBe(pane(2).id);
    s = openPane(s, pane(9));
    expect(s.panes.map((p) => p.name)).toEqual(["s2", "s3", "s4", "s9"]);
    expect(s.active).toBe(pane(9).id);
    expect(s.panes.some((p) => p.name === "s1")).toBe(false);
    expect(s.panes.some((p) => p.name === "s2")).toBe(true);
  });

  it("closing moves focus to the neighbour and clears maximize", () => {
    let s = { ...EMPTY_WORKSPACE };
    for (const i of [1, 2, 3]) s = openPane(s, pane(i));
    s = { ...s, active: pane(2).id, max: pane(2).id };
    s = closePane(s, pane(2).id);
    expect(s.panes.map((p) => p.name)).toEqual(["s1", "s3"]);
    expect(s.active).toBe(pane(3).id);
    expect(s.max).toBeNull();
    expect(closePane(s, "omp-ffffffffffffffff")).toBe(s);
  });

  it("reads stored state defensively", () => {
    expect(readWorkspace(null)).toEqual(EMPTY_WORKSPACE);
    expect(readWorkspace("{bad")).toEqual(EMPTY_WORKSPACE);
    const raw = JSON.stringify({ panes: [pane(1), pane(1), { id: "../x", name: "a", cwd: "b" }, pane(2)], active: "nope", max: pane(2).id });
    expect(readWorkspace(raw)).toEqual({ panes: [pane(1), pane(2)], active: pane(1).id, max: pane(2).id });
  });

  it("grid layouts for 1-4 panes", () => {
    expect(paneGrid(0)).toEqual([]);
    expect(paneGrid(1)).toEqual([[0]]);
    expect(paneGrid(2)).toEqual([[0, 1]]);
    expect(paneGrid(3)).toEqual([[0], [1, 2]]);
    expect(paneGrid(4)).toEqual([[0, 1], [2, 3]]);
  });

  it("recent folders and folder names", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b"], "z", 2)).toEqual(["z", "a"]);
    expect(folderName("C:\\Users\\Projects\\su-code\\")).toBe("su-code");
    expect(folderName("C:\\")).toBe("C:\\");
    expect(folderName("/home/me")).toBe("me");
    expect(folderName("/")).toBe("/");
  });
});

describe("project picker", () => {
  const live = [{ path: "C:\\Users\\Projects\\su-code", name: "su-code" }];
  const known = [
    { path: "c:/users/projects/su-code/", name: "dup" },
    { path: "C:\\Users\\Projects\\startup\\8sync-startup", name: "8sync-startup" },
    { path: "C:\\Users\\Projects\\tohe", name: "tohe" },
  ];

  it("lists recent picks first, then each source once (first name wins)", () => {
    const l = mergeProjects(["C:\\Users\\Projects\\tohe", "D:\\scratch\\x"], live, known);
    expect(l.map((p) => [p.name, !!p.recent])).toEqual([
      ["tohe", true],
      ["x", true],
      ["su-code", false],
      ["8sync-startup", false],
    ]);
    expect(mergeProjects([], [{ path: "", name: "empty" }])).toEqual([]);
  });

  it("filters by name or path, names starting with the query first", () => {
    const l = mergeProjects([], live, known);
    expect(filterProjects(l, "").length).toBe(3);
    expect(filterProjects(l, "SYNC").map((p) => p.name)).toEqual(["8sync-startup"]);
    expect(filterProjects(l, "startup\\8").map((p) => p.name)).toEqual(["8sync-startup"]);
    // "s" is also in every path ("users"): matches by path follow the names that start with it.
    expect(filterProjects(l, "s").map((p) => p.name)).toEqual(["su-code", "8sync-startup", "tohe"]);
    expect(filterProjects(l, "zzz")).toEqual([]);
  });

  it("shortens paths below home to ~", () => {
    expect(shortPath("C:\\Users\\me\\code\\app", "C:\\Users\\me")).toBe("~\\code\\app");
    expect(shortPath("c:\\users\\ME\\", "C:\\Users\\me")).toBe("~");
    expect(shortPath("/home/me/src/x", "/home/me/")).toBe("~/src/x");
    expect(shortPath("C:\\Users\\meme\\x", "C:\\Users\\me")).toBe("C:\\Users\\meme\\x");
    expect(shortPath("C:\\x", null)).toBe("C:\\x");
  });

  it("browsing starts where most projects sit, else home, never a drive root", () => {
    expect(browseStart(["C:\\Users\\Projects\\a", "C:\\Users\\Projects\\b", "C:\\Users\\Projects\\startup\\c"], "C:\\Users\\me")).toBe("C:\\Users\\Projects");
    expect(browseStart(["C:\\a", "/x"], "C:\\Users\\me")).toBe("C:\\Users\\me");
    expect(browseStart([], null)).toBeNull();
    expect(browseStart(["/home/me/src/a"], "/home/me")).toBe("/home/me/src");
    const temp = ["a", "b", "c"].map((x) => `C:\\Users\\me\\AppData\\Local\\Temp\\${x}`);
    expect(browseStart([...temp, "C:\\Users\\Projects\\su-code"], "C:\\Users\\me")).toBe("C:\\Users\\Projects");
    expect(browseStart(["/tmp/x/a"], "/home/me")).toBe("/home/me");
  });
});
