import { describe, expect, it } from "vitest";
import { teamBadge } from "@/lib/labels";
import { formRoleOf, isOmpTeamRoom, recommendRoles, reusableSession, roomSlot, roomTeamRole, teamRoleOf } from "@/lib/team-room";
import { BOOST_TEAM, DEFAULT_TEAM } from "@/lib/team-size";

describe("team rooms by exact name", () => {
  it("reads the seat of a team room only: omp-/hq- prefix, a trailing number; the owner's own sessions are none", () => {
    expect(roomSlot("lead")).toBe("lead");
    expect(roomSlot("omp-dev2")).toBe("dev2");
    expect(roomSlot("hq-qa")).toBe("qa");
    expect(roomSlot(" OMP-Review ")).toBe("review");
    for (const n of ["core", "team", "vps", "hq-api", "lead-zus", "omp-core", "dev-2", "", null, undefined]) expect(roomSlot(n), String(n)).toBeNull();
    expect(roomTeamRole("omp-dev2")).toBe("dev");
    expect(roomTeamRole("dev")).toBe("dev");
    expect(roomTeamRole("core")).toBeNull();
  });

  it("the Đội omp badge only on omp-<role>: core, team, vps get none; Claude rooms say Đội ccc", () => {
    for (const n of ["omp-lead", "omp-dev2", "omp-qa", "omp-review"]) {
      expect(isOmpTeamRoom(n), n).toBe(true);
      expect(teamBadge({ engine: "omp", label: n })).toBe("Đội omp");
    }
    for (const n of ["core", "team", "vps", "lead", "omp-core", "omp-"]) {
      expect(isOmpTeamRoom(n), n).toBe(false);
      expect(teamBadge({ engine: "omp", label: n }), n).toBeNull();
    }
    expect(teamBadge({ label: "lead" })).toBe("Đội ccc");
    expect(teamBadge({ engine: "claude", label: "core" })).toBe("Đội ccc");
  });

  it("recommends the seats the team misses; the owner's own sessions cover nothing", () => {
    expect(recommendRoles(DEFAULT_TEAM, [])).toEqual({ missing: ["lead", "dev", "qa"], covered: [] });
    expect(recommendRoles(DEFAULT_TEAM, ["omp-lead", "core", "team", "vps"])).toEqual({ missing: ["dev", "qa"], covered: ["lead"] });
    // dev2 does not stand in for dev: each seat is its own.
    expect(recommendRoles(BOOST_TEAM, ["omp-lead", "omp-dev2", "qa"])).toEqual({ missing: ["dev", "review"], covered: ["lead", "dev2", "qa"] });
    expect(recommendRoles(DEFAULT_TEAM, ["lead", "dev", "qa"]).missing).toEqual([]);
  });

  it("maps team seats to the Start form's roles and back", () => {
    expect(["lead", "dev", "dev2", "qa", "review"].map(formRoleOf)).toEqual(["plan", "fullstack", "fullstack", "tester", "reviewer"]);
    expect(["plan", "fullstack", "tester", "reviewer", "ai", "quick"].map(teamRoleOf)).toEqual(["lead", "dev", "qa", "review", null, null]);
  });

  it("reuses only an idle session of the same project whose name is exactly that role", () => {
    const s = (label: string, status = "idle", project_id: number | null = 1) => ({ label, status, project_id });
    const sessions = [s("core"), s("omp-dev"), s("omp-lead", "running"), s("omp-lead", "idle", 2), s("dev2")];
    expect(reusableSession(sessions, 1, "lead"), "lead never takes a dev room, a busy lead or another project's").toBeNull();
    expect(reusableSession(sessions, 1, "dev")?.label).toBe("omp-dev");
    expect(reusableSession([s("dev2")], 1, "dev")?.label).toBe("dev2");
    expect(reusableSession(sessions, 2, "lead")?.label).toBe("omp-lead");
    expect(reusableSession([s("core"), s("team"), s("vps")], 1, "dev"), "core matches nothing").toBeNull();
    expect(reusableSession(sessions, 1, null)).toBeNull();
    expect(reusableSession(sessions, null, "dev")).toBeNull();
  });
});
