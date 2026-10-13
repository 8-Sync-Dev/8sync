import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const merged = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: merged,
}));

import { GET } from "@/app/api/floor/route";
import { getToken } from "@/lib/server/auth";
import { resetFloorCache } from "@/lib/server/floor";
import { req, tempHome } from "./helpers";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});
beforeEach(() => {
  resetFloorCache();
  run.mockReset();
  merged.mockReset();
  merged.mockResolvedValue([]);
});

const lsOut = (rows: unknown[]) => ({ ok: true, stdout: JSON.stringify(rows), stderr: "" });

describe("GET /api/floor", () => {
  it("401 without a token and spawns nothing", async () => {
    const res = await GET(req("/api/floor"));
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("derives rows and joins hq waiting by session id", async () => {
    run.mockResolvedValue(lsOut([{ name: "abc12345-aaaa", title: "Fix login", status: "running", last_tool: "Edit", last_active: Date.now() / 1000, tasks_done: 1, tasks_total: 4 }]));
    merged.mockResolvedValue([{ name: "hq-fe", label: "hq-fe", session_id: "abc12345-aaaa", status: "needs_input", detail: "Trust?", started_at: 1, tmux: true }]);
    const body = await (await GET(req("/api/floor", { token }))).json();
    expect(run).toHaveBeenCalledWith("8sync", ["ls", "--json", "--all"], 8000);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ name: "hq-fe", title: "Fix login", state: "waiting", progress: "1/4" });
  });

  it("adds hq sessions that ls does not know, skips ended ones", async () => {
    run.mockResolvedValue(lsOut([]));
    merged.mockResolvedValue([
      { name: "hq-new", label: "hq-new", session_id: null, status: "running", detail: null, started_at: 1000, tmux: true },
      { name: "hq-old", label: "hq-old", session_id: null, status: "ended", detail: null, started_at: 1, tmux: false },
    ]);
    const body = await (await GET(req("/api/floor", { token }))).json();
    expect(body.rows.map((r: { name: string }) => r.name)).toEqual(["hq-new"]);
  });

  it("single in-flight call and 4 s cache", async () => {
    let release!: (v: unknown) => void;
    run.mockReturnValue(new Promise((r) => (release = r)));
    const calls = [GET(req("/api/floor", { token })), GET(req("/api/floor", { token })), GET(req("/api/floor", { token }))];
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    release(lsOut([]));
    await Promise.all(calls);
    await GET(req("/api/floor", { token }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("carries repo/engine, unique ids for repeated names, joins hq only for Claude rows in the matching cwd", async () => {
    const now = Date.now() / 1000;
    run.mockResolvedValue(
      lsOut([
        { name: "core", engine: "omp", repo: "~/a", status: "idle", last_active: now, title: "📋 BAOCAO: x" },
        { name: "core", engine: "ccc", repo: "~/a", status: "running", last_tool: "Edit", last_active: now },
        { name: "core", engine: "ccc", repo: "~/b", status: "running", last_tool: "Edit", last_active: now },
      ]),
    );
    const home = (await import("node:os")).homedir();
    merged.mockResolvedValue([
      { name: "core", label: "core", session_id: "11112222-3333", status: "needs_input", detail: "Trust?", started_at: 1, tmux: true, cwd: `${home}/b` },
    ]);
    const body = await (await GET(req("/api/floor", { token }))).json();
    const rows = body.rows as { id: string; engine: string; repo: string; state: string; sid: string | null; hq: boolean }[];
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows.map((r) => [r.engine, r.repo, r.hq])).toEqual([
      ["omp", "~/a", false],
      ["ccc", "~/a", false],
      ["ccc", "~/b", true],
    ]);
    expect(rows[2]).toMatchObject({ state: "waiting", sid: "11112222" });
  });

  describe("dedupe hq against ls", () => {
    const UUID = "9f8e7d6c-1111-2222-3333-444455556666";
    const hq = (o: Record<string, unknown>) => ({ name: UUID, label: UUID, session_id: UUID, status: "running", detail: null, started_at: 1000, tmux: false, ...o });
    const floor = async () => (await (await GET(req("/api/floor", { token }))).json()).rows as { name: string; title: string; hq: boolean; unmatched?: boolean }[];
    const home = () => import("node:os").then((m) => m.homedir());

    it("agent cwd in a subfolder of the ls repo joins by session id, one desk", async () => {
      run.mockResolvedValue(lsOut([{ name: "feats", engine: "ccc", repo: "~/startup/x", sid: UUID, status: "running", tasks_done: 11, tasks_total: 12 }]));
      merged.mockResolvedValue([hq({ cwd: `${await home()}/startup/x/apps/web` })]);
      const rows = await floor();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ hq: true, title: "feats" });
    });

    it("`~` repo joins by cwd when it is the only candidate", async () => {
      run.mockResolvedValue(lsOut([{ name: "feats", engine: "ccc", repo: "~", status: "running" }]));
      merged.mockResolvedValue([hq({ cwd: await home() })]);
      const rows = await floor();
      expect(rows).toHaveLength(1);
      expect(rows[0].hq).toBe(true);
    });

    it("joins by name for engine claude even when cwd is a worktree inside the repo", async () => {
      run.mockResolvedValue(lsOut([{ name: "feats", engine: "claude", repo: "~/startup/x", status: "running" }]));
      merged.mockResolvedValue([hq({ name: "feats", label: "feats", session_id: null, cwd: `${await home()}/startup/x/.claude/worktrees/w1` })]);
      const rows = await floor();
      expect(rows.map((r) => r.name)).toEqual(["feats"]);
    });

    it("does not guess when several ls rows share the folder", async () => {
      run.mockResolvedValue(lsOut([
        { name: "a", engine: "ccc", repo: "~/startup/x", status: "idle" },
        { name: "b", engine: "ccc", repo: "~/startup/x", status: "idle" },
      ]));
      merged.mockResolvedValue([hq({ cwd: `${await home()}/startup/x` })]);
      const rows = await floor();
      expect(rows).toHaveLength(3);
    });

    it("true unmatched hq session: 8-char label, never the full uuid, ordered last", async () => {
      run.mockResolvedValue(lsOut([{ name: "feats", engine: "ccc", repo: "~/startup/x", status: "running" }]));
      merged.mockResolvedValue([hq({ cwd: "/srv/elsewhere" })]);
      const rows = await floor();
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ unmatched: true, title: "9f8e7d6c", hq: true });
      expect(JSON.stringify(rows)).not.toContain(`"title":"${UUID}"`);
    });
  });

  it("returns [] when 8sync is missing", async () => {
    run.mockResolvedValue({ ok: false, stdout: "", stderr: "ENOENT" });
    const res = await GET(req("/api/floor", { token }));
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });
});
