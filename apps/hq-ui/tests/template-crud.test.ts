import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, POST, PUT } from "@/app/api/templates/route";
import { getToken } from "@/lib/server/auth";
import { MAX_TEMPLATE_FILES, freeId, templatesDir } from "@/lib/server/templates";
import { BUILT_IN_TEMPLATES, type BotTemplate } from "@/lib/templates";
import { ORIGIN, req, tempHome } from "./helpers";

// "Của tôi": the owner's templates written from the page (POST/PUT/DELETE /api/templates).
const mine = { id: "my-bot", name: "Bot của tôi", emoji: "🤖", color: "sky", purpose: "Việc riêng", engine: "claude", role: "quick", instructions: "Dòng 1", skills: [] };
const call = (fn: (r: Request) => Promise<Response>, method: string, body?: unknown, opts: { ui?: boolean; q?: string } = {}) =>
  fn(req(`/api/templates${opts.q ?? ""}`, { method, token: getToken(), origin: ORIGIN, body, ui: opts.ui ?? true }));
const files = () => fs.readdirSync(templatesDir()).sort();
const list = async () => ((await (await GET(req("/api/templates", { token: getToken() }))).json()) as { templates: BotTemplate[] }).templates;

beforeAll(() => tempHome());
beforeEach(() => fs.rmSync(templatesDir(), { recursive: true, force: true }));

describe("templates CRUD: owner only", () => {
  it("a room (hq.mjs with the UI token, no page marker) gets 403 and writes nothing", async () => {
    expect((await call(POST, "POST", { template: mine }, { ui: false })).status).toBe(403);
    expect((await call(PUT, "PUT", { template: mine }, { ui: false })).status).toBe(403);
    expect((await call(DELETE, "DELETE", undefined, { ui: false, q: "?id=my-bot" })).status).toBe(403);
    expect(fs.existsSync(templatesDir())).toBe(false);
  });
});

describe("templates CRUD", () => {
  it("creates, edits, deletes the owner's file; GET shows it", async () => {
    const c = await call(POST, "POST", { template: { ...mine, builtIn: true } });
    expect(c.status).toBe(201);
    expect(files()).toEqual(["my-bot.json"]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(templatesDir(), "my-bot.json"), "utf8"));
    expect(onDisk.builtIn).toBeUndefined();
    expect((await list()).find((t) => t.id === "my-bot")).toMatchObject({ name: "Bot của tôi", builtIn: false });

    const u = await call(PUT, "PUT", { template: { ...mine, name: "Bot đã sửa", engine: "omp", role: undefined, model: "zai/glm-5.3", thinking: "high" } });
    expect(u.status).toBe(200);
    expect((await list()).find((t) => t.id === "my-bot")).toMatchObject({ name: "Bot đã sửa", engine: "omp", model: "zai/glm-5.3", thinking: "high" });

    expect((await call(DELETE, "DELETE", undefined, { q: "?id=my-bot" })).status).toBe(200);
    expect(files()).toEqual([]);
    expect((await call(DELETE, "DELETE", undefined, { q: "?id=my-bot" })).status).toBe(404);
  });
  it("Nhân bản: a built-in's id gets -2, -3: the copy is the owner's, the built-in stays", async () => {
    const reviewer = BUILT_IN_TEMPLATES.find((t) => t.id === "reviewer")!;
    const a = (await (await call(POST, "POST", { template: reviewer })).json()) as { template: BotTemplate };
    const b = (await (await call(POST, "POST", { template: reviewer })).json()) as { template: BotTemplate };
    expect([a.template.id, b.template.id]).toEqual(["reviewer-2", "reviewer-3"]);
    expect((await list()).filter((t) => t.id.startsWith("reviewer")).map((t) => [t.id, t.builtIn])).toEqual([
      ["reviewer", true],
      ["reviewer-2", false],
      ["reviewer-3", false],
    ]);
    expect(freeId("x".repeat(32), new Set(["x".repeat(32)]))).toBe(`${"x".repeat(30)}-2`);
  });
  it("a built-in cannot be edited or deleted in place (404)", async () => {
    expect((await call(PUT, "PUT", { template: { ...mine, id: "reviewer" } })).status).toBe(404);
    expect((await call(DELETE, "DELETE", undefined, { q: "?id=reviewer" })).status).toBe(404);
  });
  it("applies TEMPLATE_LIMITS with the field's reason (422)", async () => {
    const r = await call(POST, "POST", { template: { ...mine, instructions: "1\n2\n3\n4\n5\n6\n7" } });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toMatch(/6 dòng/);
    expect((await call(PUT, "PUT", { template: { id: "my-bot" } })).status).toBe(404);
    await call(POST, "POST", { template: mine });
    expect((await call(PUT, "PUT", { template: { ...mine, name: "n".repeat(41) } })).status).toBe(422);
    expect((await call(PUT, "PUT", { template: "x" })).status).toBe(422);
  });
  it("a broken file is left alone (its name is not reused) and the rest still lists; writes leave no temp file", async () => {
    fs.mkdirSync(templatesDir(), { recursive: true });
    fs.writeFileSync(path.join(templatesDir(), "my-bot.json"), "{ not json");
    const r = (await (await call(POST, "POST", { template: mine })).json()) as { template: BotTemplate };
    expect(r.template.id).toBe("my-bot-2");
    expect(fs.readFileSync(path.join(templatesDir(), "my-bot.json"), "utf8")).toBe("{ not json");
    expect(files()).toEqual(["my-bot-2.json", "my-bot.json"]);
    expect((await list()).some((t) => t.id === "my-bot-2")).toBe(true);
    // The broken one cannot be edited through the API (it is not a template).
    expect((await call(PUT, "PUT", { template: mine })).status).toBe(404);
  });
  it(`at most ${MAX_TEMPLATE_FILES} files (409)`, async () => {
    fs.mkdirSync(templatesDir(), { recursive: true });
    for (let i = 0; i < MAX_TEMPLATE_FILES; i++) fs.writeFileSync(path.join(templatesDir(), `t${i}.json`), "{}");
    expect((await call(POST, "POST", { template: mine })).status).toBe(409);
  });
});
