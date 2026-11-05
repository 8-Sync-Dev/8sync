import { beforeAll, describe, expect, it, vi } from "vitest";

/** One live omp room and one ended omp room, each in its own repo; no Claude Code session at all. */
const floor = vi.hoisted(() => ({ live: "", ended: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({ ...(await orig<typeof import("@/lib/server/proc")>()), mergedSessions: async () => [] }));
vi.mock("@/lib/server/floor", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/floor")>()),
  loadFloor: async () => [
    { id: "omp:a", name: "core", title: "", last_active: 1, hq: false, repo: floor.live, engine: "omp", inbox_id: "omp-0123456789abcdef", live: true, state: "idle", caption: "" },
    { id: "omp:b", name: "old", title: "", last_active: 1, hq: false, repo: floor.ended, engine: "omp", inbox_id: "omp-fedcba9876543210", live: false, state: "idle", caption: "" },
  ],
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/lib/server/db";
import { knownRoots } from "@/lib/server/in-view";
import { tempHome } from "./helpers";

const repo = (tag: string) => {
  const d = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), `hq-in-view-${tag}-`)));
  fs.mkdirSync(path.join(d, ".git"));
  fs.writeFileSync(path.join(d, ".git", "HEAD"), "ref: refs/heads/main\n");
  return d;
};

describe("knownRoots", () => {
  beforeAll(() => {
    tempHome();
    floor.live = repo("live");
    floor.ended = repo("ended");
  });

  // Rooms on a machine that runs only omp: artifacts, uploads and Preview answered 403/404 for their files.
  it("holds the repo of a live omp room, not of one that is no longer open", async () => {
    const roots = (await knownRoots(getDb())).map((r) => r.toLowerCase());
    expect(roots).toContain(floor.live.toLowerCase());
    expect(roots).not.toContain(floor.ended.toLowerCase());
  });
});
