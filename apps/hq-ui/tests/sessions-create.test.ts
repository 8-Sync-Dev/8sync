import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelChoice } from "@/lib/room-model";

// "Bot mới" → POST /api/sessions with `engine` + `model` (+ `thinking`): what reaches argv, and what is refused.
const m = vi.hoisted(() => ({ run: vi.fn(), models: [] as ModelChoice[] }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run: m.run,
  // No tmux (Windows): `claude --bg …`, run through `run` as an argv.
  hasTmux: async () => false,
  listTmux: async () => [],
}));
vi.mock("@/lib/server/models", async (orig) => ({ ...(await orig<typeof import("@/lib/server/models")>()), ompModels: async () => m.models }));

import { POST } from "@/app/api/sessions/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { pendingNew } from "@/lib/server/omp-sessions";
import { ompNewArgs } from "@/lib/server/term";
import { ORIGIN, req, tempHome } from "./helpers";

const GLM: ModelChoice = { selector: "zai/glm-5.3", provider: "zai", name: "GLM-5.3", thinking: ["low", "medium", "high"] };
let dir = "";
let project = 0;
const post = (body: unknown) => POST(req("/api/sessions", { method: "POST", token: getToken(), origin: ORIGIN, body }));
const err = async (r: Response) => ((await r.json()) as { error: string }).error;

beforeAll(() => {
  tempHome();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-newbot-"));
  project = Number(getDb().prepare("INSERT INTO projects(path, name, added_at) VALUES (?, 'newbot', 0)").run(dir).lastInsertRowid);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  m.run.mockReset();
  m.run.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
  m.models = [GLM];
});

describe("POST /api/sessions: engine", () => {
  it("refuses an unknown engine (400) and runs nothing", async () => {
    for (const engine of ["gpt", "OMP", 1, { x: 1 }, ["omp"]]) {
      const r = await post({ engine, name: "a", project });
      expect(r.status, JSON.stringify(engine)).toBe(400);
    }
    expect(m.run).not.toHaveBeenCalled();
  });
  it("no engine = Claude Code (the old body still works)", async () => {
    expect((await post({ name: "plain", project })).status).toBe(201);
    expect(m.run).toHaveBeenCalledWith("claude", ["--bg", "--name", "hq-plain", "--permission-mode", "auto"], 60_000, dir);
  });
});

describe("POST /api/sessions: Claude Code model + effort", () => {
  it("refuses a model or effort HQ does not offer", async () => {
    for (const body of [{ model: "opus; rm -rf ~" }, { model: "claude-opus-4" }, { model: "zai/glm-5.3" }, { thinking: "ultra" }, { thinking: "off" }, { thinking: 3 }]) {
      const r = await post({ engine: "claude", name: "c", project, ...body });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    expect(m.run).not.toHaveBeenCalled();
  });
  it("starts `claude` with --model and --effort as argv items (no shell)", async () => {
    const r = await post({ engine: "claude", name: "dev", project, role: "tester", model: "claude-opus-5-5", thinking: "high", prompt: "--làm card 3" });
    expect(r.status).toBe(201);
    expect(m.run).toHaveBeenCalledTimes(1);
    const [cmd, argv] = m.run.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("claude");
    expect(argv).toEqual(["--bg", "--name", "hq-dev", "--permission-mode", "auto", "--model", "claude-opus-5-5", "--effort", "high", " --làm card 3"]);
  });
  it("no model: the role's", async () => {
    await post({ engine: "claude", name: "t", project, role: "tester" });
    expect(m.run.mock.calls[0][1]).toEqual(["--bg", "--name", "hq-t", "--permission-mode", "auto", "--model", "claude-haiku-5-5"]);
  });
});

describe("POST /api/sessions: omp model + thinking", () => {
  const omp = (body: Record<string, unknown>) => post({ engine: "omp", cwd: dir, name: "o", ...body });
  it("refuses a model not in `omp models`, a bad level, a level without a model", async () => {
    for (const body of [{ model: "zai/other" }, { model: "claude-opus-5-5" }, { model: "zai/glm-5.3 --x" }, { model: "zai/glm-5.3", thinking: "max" }, { model: "zai/glm-5.3", thinking: "x" }, { thinking: "high" }]) {
      const r = await omp(body);
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
  });
  it("503 while omp lists no model (pick 'mặc định' instead)", async () => {
    m.models = [];
    expect((await omp({ model: "zai/glm-5.3" })).status).toBe(503);
    expect((await omp({ name: "o-default" })).status).toBe(200);
  });
  it("creates the session with `--model <selector>:<level>`", async () => {
    const r = await omp({ name: "glm-bot", model: "zai/glm-5.3", thinking: "high" });
    expect(r.status).toBe(200);
    const { id } = (await r.json()) as { id: string };
    expect(pendingNew(id)).toMatchObject({ name: "glm-bot", model: "zai/glm-5.3:high" });
    expect(ompNewArgs("glm-bot", pendingNew(id)!.model, 120, 32)).toEqual(["ccc", "term", "--omp-new", "glm-bot", "--model", "zai/glm-5.3:high", "--cols", "120", "--rows", "32"]);
    // "off" is a level omp takes for every model.
    const off = (await (await omp({ name: "glm-off", model: "zai/glm-5.3", thinking: "off" })).json()) as { id: string };
    expect(pendingNew(off.id)?.model).toBe("zai/glm-5.3:off");
  });
  it("no model: omp's own default; the omp body is still checked", async () => {
    const r = await omp({ name: "plain-omp" });
    expect(r.status).toBe(200);
    expect(pendingNew(((await r.json()) as { id: string }).id)?.model).toBeNull();
    expect(await err(await omp({ name: "Bad Name" }))).toMatch(/tên phiên/);
    expect((await omp({ cwd: path.join(dir, "missing") })).status).toBe(422);
  });
});
