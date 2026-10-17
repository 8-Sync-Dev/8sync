import { beforeAll, describe, expect, it, vi } from "vitest";

const room = vi.hoisted(() => ({ cwd: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [{ name: "s1", cwd: room.cwd, status: "running" }],
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "@/app/api/loops/route";
import { getToken } from "@/lib/server/auth";
import { parseLoopMd, readProjectLoops, type LoopRow } from "@/lib/server/loops";
import { req, tempHome } from "./helpers";

/** The shape looper.rs writes (su-code/ship/ci-size-gate/LOOP.md). */
const MD = `# LOOP — ci-size-gate

| Criterion | Check |
|---|---|
| C1 | grep size-gate |

## Evidence
iter 0 | C1 | exit 0 | C1-ok
iter 2 | C2 | exit 0 | C2-ok: run 38932920686 success

## Brief
- All green in iteration 2.
`;

describe("parseLoopMd", () => {
  it("last line and highest iteration under ## Evidence, the brief below is not evidence", () => {
    expect(parseLoopMd(MD)).toEqual({ last: "iter 2 | C2 | exit 0 | C2-ok: run 38932920686 success", iter: 2 });
  });
  it("lenient: CRLF, no heading (iter lines anywhere), empty file", () => {
    expect(parseLoopMd("# x\r\n- iter 1 | a\r\n- iter 3 | b\r\n")).toEqual({ last: "iter 3 | b", iter: 3 });
    expect(parseLoopMd("")).toEqual({ last: null, iter: null });
    expect(parseLoopMd("## Evidence\n\n")).toEqual({ last: null, iter: null });
  });
  it("the evidence line is masked: a check's output may quote a secret", () => {
    const md = ["## Evidence", "- iter 2 | C1 | exit 1 | psql --password " + "hunter" + "2 -h db"].join("\n");
    const { last } = parseLoopMd(md);
    expect(last).toContain("psql --password ***");
    expect(last).not.toContain("hunter" + "2");
  });
});

describe("readProjectLoops + GET /api/loops", () => {
  let root = "";
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    root = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "hq-loops-")));
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    const ship = path.join(root, "su-code", "ship");
    fs.mkdirSync(path.join(ship, "gate"), { recursive: true });
    fs.writeFileSync(path.join(ship, "gate", "LOOP.md"), MD);
    fs.writeFileSync(path.join(ship, "gate", "loop.json"), JSON.stringify({ slug: "gate", iter: 4, max_iter: 10, stopped: "done" }));
    fs.mkdirSync(path.join(ship, "live"), { recursive: true });
    fs.writeFileSync(path.join(ship, "live", "LOOP.md"), "## Evidence\niter 1 | C1 | exit 1 | red\n");
    fs.writeFileSync(path.join(ship, "live", "loop.json"), JSON.stringify({ slug: "live", iter: 1, max_iter: 8 }));
    fs.mkdirSync(path.join(ship, "plan-only"), { recursive: true });
    fs.writeFileSync(path.join(ship, "plan-only", "PLAN.md"), "# plan");
    fs.writeFileSync(path.join(ship, "ACTIVE"), "gate");
    room.cwd = root;
  });

  it("one row per LOOP.md, running first; loop.json wins for iterations and state", () => {
    const rows = readProjectLoops(root);
    expect(rows.map((r) => r.slug)).toEqual(["live", "gate"]);
    expect(rows[0]).toMatchObject({ iter: 1, maxIter: 8, stopped: null, running: true, last: "iter 1 | C1 | exit 1 | red" });
    expect(rows[1]).toMatchObject({ iter: 4, maxIter: 10, stopped: "done", running: false });
    expect(readProjectLoops(path.join(root, "nope"))).toEqual([]);
  });

  it("route: 401 without the token, the live project's loops with it", async () => {
    expect((await GET(req("/api/loops"))).status).toBe(401);
    const r = await GET(req("/api/loops", { token }));
    expect(r.status).toBe(200);
    const { projects } = (await r.json()) as { projects: { root: string; loops: LoopRow[] }[] };
    expect(projects).toHaveLength(1);
    expect(projects[0].loops.map((l) => l.slug)).toEqual(["live", "gate"]);
  });
});
