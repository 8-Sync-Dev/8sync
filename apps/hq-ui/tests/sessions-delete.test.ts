import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN, req, tempHome } from "./helpers";

const m = vi.hoisted(() => ({
  agents: [] as unknown[] | null,
  merged: [] as { name: string; status: string; source: string }[],
}));

vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  listClaudeAgents: async () => m.agents,
  mergedSessions: async () => m.merged,
}));

import { DELETE } from "@/app/api/sessions/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

describe("DELETE /api/sessions: Xoá session rác", () => {
  beforeAll(() => tempHome());
  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM sessions");
    for (const n of ["gone-1", "gone-2", "alive"]) db.prepare("INSERT INTO sessions(name, status, updated_at) VALUES (?, 'running', 0)").run(n);
  });
  const names = () => (getDb().prepare("SELECT name FROM sessions ORDER BY name").all() as { name: string }[]).map((r) => r.name);

  it("drops only the rows of sessions that are gone", async () => {
    m.agents = [];
    m.merged = [
      { name: "gone-1", status: "ended", source: "journal" },
      { name: "gone-2", status: "ended", source: "journal" },
      { name: "alive", status: "running", source: "claude" },
    ];
    const res = await DELETE(req("/api/sessions", { method: "DELETE", token: getToken(), origin: ORIGIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(names()).toEqual(["alive"]);
  });

  it("deletes nothing while claude agents cannot answer, and needs the token", async () => {
    m.agents = null;
    m.merged = [{ name: "gone-1", status: "ended", source: "journal" }];
    expect((await DELETE(req("/api/sessions", { method: "DELETE", token: getToken(), origin: ORIGIN }))).status).toBe(503);
    m.agents = [];
    expect((await DELETE(req("/api/sessions", { method: "DELETE", token: null, origin: ORIGIN }))).status).toBe(401);
    expect(names()).toEqual(["alive", "gone-1", "gone-2"]);
  });
});
