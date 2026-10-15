import { describe, expect, it } from "vitest";
import { assignSummary, distinctLabels, groupTargets, nameList, outsideRole, projectTargets, roleTargets } from "@/lib/assign";

const SID = "11111111-2222-3333-4444-555555555555";
const SID2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const s = (name: string, o: Partial<{ tmux: boolean; status: "running" | "idle" | "needs_input" | "ended"; session_id: string | null; project_id: number | null; role: string | null; label: string }> = {}) => ({
  name,
  tmux: true,
  status: "running" as const,
  session_id: null as string | null,
  project_id: 1 as number | null,
  role: null as string | null,
  label: "",
  ...o,
});
const projects = [
  { id: 1, name: "levels-repo" },
  { id: 2, name: "8sync-startup" },
];

describe("groupTargets", () => {
  it("groups reachable sessions by project in project order, unreachable and ended dropped, orphans last", () => {
    const g = groupTargets(
      [
        s("rd", { tmux: false, session_id: SID, project_id: 2 }),
        s("hq-rd-1", { role: "rd" }),
        s("core", { tmux: false, session_id: null }), // neither tmux nor a session id: unreachable
        s("hq-old", { status: "ended" }),
        s("web", { tmux: false, session_id: SID2, project_id: null }),
        s("hq-x", { project_id: 99 }), // project no longer listed
      ],
      projects,
    );
    expect(g.map((x) => [x.name, x.sessions.map((y) => y.name)])).toEqual([
      ["levels-repo", ["hq-rd-1"]],
      ["8sync-startup", ["rd"]],
      ["Phiên khác", ["web", "hq-x"]],
    ]);
  });
  it("groups sessions outside registered projects by the git folder their room reports, like the sidebar", () => {
    const rooms = [
      { name: "x", session_id: SID, project: { root: "/home/u/startup", name: "startup", branch: "main" } },
      { name: "y", session_id: SID2, project: { root: "/home/u/Startup", name: "startup", branch: "main" } }, // same folder, different case
      { name: "hq-x", session_id: null, project: { root: "/home/u/acme", name: "acme", branch: null } },
    ];
    const g = groupTargets(
      [
        s("x", { tmux: false, session_id: SID, project_id: null }),
        s("y", { tmux: false, session_id: SID2, project_id: 99 }),
        s("hq-x", { project_id: null }),
        s("z", { tmux: false, session_id: "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee", project_id: null }), // no room: last
        s("hq-rd-1", { role: "rd" }),
      ],
      projects,
      rooms,
    );
    expect(g.map((x) => [x.name, x.sessions.map((y) => y.name)])).toEqual([
      ["levels-repo", ["hq-rd-1"]],
      ["acme", ["hq-x"]],
      ["startup ⎇ main", ["x", "y"]],
      ["Phiên khác", ["z"]],
    ]);
  });
  it("distinctLabels: duplicate names get the first 8 id chars", () => {
    const m = distinctLabels([
      s("rd", { tmux: false, session_id: SID, label: "rd" }),
      s("rd", { tmux: false, session_id: SID2, label: "rd" }),
      s("hq-web-1"),
    ]);
    expect(m.get(SID)).toBe("rd · 11111111");
    expect(m.get(SID2)).toBe("rd · aaaaaaaa");
    expect(m.get("hq-web-1")).toBe("web-1");
  });
  it("is empty when nothing is reachable", () => {
    expect(groupTargets([s("hq-old", { status: "ended" })], projects)).toEqual([]);
  });
});

describe("roleTargets / projectTargets", () => {
  const all = [
    s("hq-rd-1", { role: "rd" }),
    s("hq-rd-2", { role: "rd", status: "ended" }),
    s("rd", { tmux: false, session_id: SID, role: "rd" }), // started outside HQ: the server cannot route by role to it
    s("hq-web-1", { role: "fullstack", project_id: 2 }),
  ];
  it("roleTargets: live hq sessions with that role only", () => {
    expect(roleTargets("rd", all).map((x) => x.name)).toEqual(["hq-rd-1"]);
    expect(roleTargets("tester", all)).toEqual([]);
  });
  it("outsideRole: reachable non-hq sessions that carry the role", () => {
    expect(outsideRole("rd", all).map((x) => x.name)).toEqual(["rd"]);
    expect(outsideRole("fullstack", all)).toEqual([]);
  });
  it("projectTargets: every reachable session of the project, or of all projects", () => {
    expect(projectTargets(1, all).map((x) => x.name)).toEqual(["hq-rd-1", "rd"]);
    expect(projectTargets(2, all).map((x) => x.name)).toEqual(["hq-web-1"]);
    expect(projectTargets(null, all).map((x) => x.name)).toEqual(["hq-rd-1", "rd", "hq-web-1"]);
  });
});

describe("assignSummary", () => {
  it("session: names the session and how it is reached", () => {
    expect(assignSummary({ mode: "session", session: s("hq-rd-1") })).toBe("Giao cho phiên rd-1 vào terminal");
    expect(assignSummary({ mode: "session", session: s("rd", { tmux: false, session_id: SID }) })).toBe("Giao cho phiên rd qua inbox (nhận khi xong lượt)");
    expect(assignSummary({ mode: "session", session: null })).toBe("");
  });
  it("role: reuse one, pick among many, or start a new session in the project", () => {
    expect(assignSummary({ mode: "role", role: "rd", roleSessions: [s("hq-rd-1")] })).toBe("Giao cho phiên rd-1 (R&D (nghiên cứu) duy nhất đang chạy)");
    expect(assignSummary({ mode: "role", role: "rd", roleSessions: [s("hq-rd-1"), s("hq-rd-2")] })).toBe(
      "Giao cho phiên R&D (nghiên cứu) rảnh lâu nhất trong 2 phiên: rd-1, rd-2",
    );
    expect(assignSummary({ mode: "role", role: "tester", roleSessions: [], project: projects[0] })).toBe(
      "Chưa có phiên Tester: mở phiên mới (Haiku 5.5) trong levels-repo",
    );
    expect(assignSummary({ mode: "role", role: "nope" })).toBe("");
  });
  it("project: counts the fan-out and says when there is nobody", () => {
    expect(assignSummary({ mode: "project", project: projects[0], projectSessions: [s("hq-rd-1"), s("hq-web-1")] })).toBe(
      "Giao cùng một việc cho 2 phiên trong levels-repo: rd-1, web-1",
    );
    expect(assignSummary({ mode: "project", project: null, projectSessions: [s("a")] })).toBe("Giao cùng một việc cho 1 phiên ở mọi dự án: a");
    expect(assignSummary({ mode: "project", project: projects[1], projectSessions: [] })).toBe("Chưa có phiên nào đang chạy trong 8sync-startup");
  });
  it("nameList caps long lists", () => {
    expect(nameList([s("a"), s("b"), s("c"), s("d"), s("e"), s("f")])).toBe("a, b, c, d +2");
  });
});
