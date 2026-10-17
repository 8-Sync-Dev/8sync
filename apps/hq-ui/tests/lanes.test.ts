import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const merged = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: merged,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "@/app/api/board/route";
import { getToken } from "@/lib/server/auth";
import { BOARD_ARGS } from "@/lib/server/board";
import { CLAIM_STALE_MS, LANES, boardSummary, claimStale, openCount, parseBoard } from "@/lib/lanes";
import { req, tempHome } from "./helpers";

/**
 * stdout of `8sync ccc auto board --json` as crates/cli/src/verbs/ccc/target.rs `board_json` prints it:
 * `{schema: 1, lanes: [{lane, cards}], closed}`, `Target` with empty optional fields skipped, times in seconds.
 */
const BOARD = {
  schema: 1,
  lanes: [
    { lane: "backlog", cards: [{ id: 3, text: "login page", added: 100, state: "open", lane: "backlog" }] },
    {
      lane: "ready",
      cards: [{ id: 4, text: "UAT checkout 390px", check: "pnpm e2e checkout", added: 101, state: "open", lane: "ready", label: "qa" }],
    },
    {
      lane: "building",
      cards: [
        {
          id: 2,
          text: "fix crash",
          check: "cargo test -q crash",
          added: 90,
          from: "lead",
          state: "open",
          lane: "building",
          label: "bug",
          claim: { room: "dev", at: 1_000 },
          notes: [
            { at: 950, room: "dev", text: "ready → building" },
            { at: 1_000, room: "dev", text: "đang viết test" },
          ],
          bounces: 1,
        },
      ],
    },
    { lane: "qa", cards: [] },
    { lane: "review", cards: [] },
    { lane: "approved", cards: [{ id: 1, text: "rename flag", check: "true", added: 80, state: "open", lane: "approved", pr: "#81", sha: "0123abc" }] },
    { lane: "blocked", cards: [] },
  ],
  closed: [{ id: 9, text: "old", added: 1, state: "done", closed: 70, evidence: "true: ok", by: "lead", lane: "review" }],
};

describe("parseBoard", () => {
  it("reads every lane, the claim, the last note and the closed cards (seconds → ms)", () => {
    const b = parseBoard(BOARD)!;
    expect(LANES.map((l) => b.lanes[l.key].length)).toEqual([1, 1, 1, 0, 0, 1, 0]);
    const c = b.lanes.building[0];
    expect(c).toMatchObject({ id: 2, label: "bug", bounces: 1, claim: { room: "dev", at: 1_000_000 }, note: { room: "dev", text: "đang viết test", at: 1_000_000 } });
    expect(b.lanes.backlog[0]).toMatchObject({ check: null, claim: null, note: null, bounces: 0, pr: null });
    expect(b.lanes.approved[0]).toMatchObject({ pr: "#81", sha: "0123abc" });
    expect(b.closed).toEqual([{ id: 9, text: "old", state: "done", by: "lead", at: 70_000 }]);
    expect(openCount(b)).toBe(4);
  });

  it("refuses another shape and drops cards it cannot read", () => {
    expect(parseBoard(null)).toBeNull();
    expect(parseBoard({ schema: 2, lanes: [] })).toBeNull();
    expect(parseBoard({ open: 1, position: 1 })).toBeNull();
    const b = parseBoard({ schema: 1, lanes: [{ lane: "ready", cards: [{ id: "x", text: "a" }, { id: 5 }, { id: 6, text: "ok" }] }, { lane: "nope", cards: [{ id: 7, text: "z" }] }] })!;
    expect(b.lanes.ready.map((c) => c.id)).toEqual([6]);
    expect(openCount(b)).toBe(1);
  });

  it("summarises the lanes and what waits for Ship; flags a quiet claim", () => {
    const b = parseBoard(BOARD)!;
    expect(boardSummary(b)).toBe("4 card mở · Backlog 1 · Ready 1 · Building 1 · Approved 1 · 1 chờ Ship");
    expect(boardSummary(parseBoard({ schema: 1, lanes: [], closed: [] })!)).toBe("chưa có card");
    const c = b.lanes.building[0];
    expect(claimStale(c, 1_000_000 + CLAIM_STALE_MS - 1)).toBe(false);
    expect(claimStale(c, 1_000_000 + CLAIM_STALE_MS)).toBe(true);
    expect(claimStale(b.lanes.backlog[0])).toBe(false);
  });
});

function repo(dir: string): string {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return path.resolve(dir);
}

describe("GET /api/board", () => {
  let token = "";
  let shop = "";
  let tools = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "hq-board-"));
    shop = repo(path.join(base, "shop"));
    tools = repo(path.join(base, "tools"));
  });
  beforeEach(() => {
    run.mockReset();
    merged.mockReset();
    merged.mockResolvedValue([
      { name: "dev", cwd: shop, status: "running" },
      { name: "qa", cwd: path.join(shop, ".claude", "worktrees", "card-2"), status: "running" },
      { name: "ops", cwd: tools, status: "running" },
      { name: "old", cwd: os.tmpdir(), status: "ended" },
    ]);
  });

  it("401 without the token, runs nothing", async () => {
    expect((await GET(req("/api/board", { token: null }))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs `auto board --json` once per live project (worktrees fold into their repo), argv only", async () => {
    run.mockImplementation(async (_cmd: string, _args: string[], _t: number, cwd: string) =>
      cwd === shop ? { ok: true, stdout: JSON.stringify(BOARD) + "\n", stderr: "" } : { ok: false, stdout: "", stderr: "Error: không rõ `board`\n" },
    );
    const r = await GET(req("/api/board", { token }));
    expect(r.status).toBe(200);
    const { boards } = (await r.json()) as { boards: { root: string; board: unknown; error: string | null }[] };
    expect(run).toHaveBeenCalledTimes(2);
    for (const call of run.mock.calls) expect(call.slice(0, 2)).toEqual(["8sync", BOARD_ARGS]);
    const byRoot = Object.fromEntries(boards.map((b) => [b.root, b]));
    expect(byRoot[shop].error).toBeNull();
    expect(openCount(byRoot[shop].board as never)).toBe(4);
    expect(byRoot[tools]).toMatchObject({ board: null, error: "không rõ `board`" });
  });

  it("an old 8sync that prints something else asks for an update", async () => {
    run.mockResolvedValue({ ok: true, stdout: "▶ #1 fix\n", stderr: "" });
    const { boards } = (await (await GET(req("/api/board", { token }))).json()) as { boards: { error: string | null }[] };
    expect(boards.every((b) => b.error?.includes("8sync up"))).toBe(true);
  });
});
