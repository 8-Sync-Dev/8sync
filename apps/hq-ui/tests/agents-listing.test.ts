import { beforeEach, describe, expect, it, vi } from "vitest";

// The core answers `/v1/agents`; each call is counted and resolved by the test.
const core = vi.hoisted(() => ({ calls: 0, pending: [] as ((v: { v: unknown } | null) => void)[] }));
vi.mock("@/lib/server/core", () => ({
  coreGet: (path: string) => {
    expect(path).toBe("/v1/agents");
    core.calls++;
    return new Promise((resolve) => core.pending.push(resolve));
  },
}));

import { listClaudeAgents, resetAgentsCache } from "@/lib/server/proc";

const ROOMS = [{ sessionId: "3698e3a6-9b73-4b37-ab3a-368b169d0508", name: "lead", kind: "background", status: "busy" }];

describe("claude agents listing (one probe for the whole server)", () => {
  beforeEach(() => {
    resetAgentsCache();
    core.calls = 0;
    core.pending = [];
  });

  it("concurrent polls share one probe and a fresh answer serves the next ones", async () => {
    let t = 1_000;
    const now = () => t;
    const polls = Array.from({ length: 15 }, () => listClaudeAgents(now));
    expect(core.calls).toBe(1);
    core.pending[0]({ v: ROOMS });
    for (const r of await Promise.all(polls)) expect(r).toEqual(ROOMS);
    t += 1_500;
    expect(await listClaudeAgents(now)).toEqual(ROOMS);
    expect(core.calls).toBe(1);
  });

  it("a failed probe keeps the last good listing (names, not ids), then gives up after 2 minutes", async () => {
    let t = 1_000;
    const now = () => t;
    const first = listClaudeAgents(now);
    core.pending[0]({ v: ROOMS });
    expect(await first).toEqual(ROOMS);

    t += 5_000;
    const slow = listClaudeAgents(now);
    core.pending[1]({ v: null }); // the core answered: its claude run failed
    expect(await slow).toEqual(ROOMS);

    t += 120_000;
    const gone = listClaudeAgents(now);
    core.pending[2]({ v: null });
    expect(await gone).toBeNull();
  });
});
