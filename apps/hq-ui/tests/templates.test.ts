import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as templatesRoute from "@/app/api/templates/route";
import { getToken } from "@/lib/server/auth";
import { allTemplates, readCustomTemplates, templatesDir } from "@/lib/server/templates";
import {
  BLANK_DRAFT,
  BUILT_IN_TEMPLATES,
  checkTemplate,
  copyDraft,
  draftOf,
  SUGGESTED_TEMPLATE_IDS,
  botKeyOf,
  createRequest,
  firstPrompt,
  matchesHint,
  mergeTemplates,
  nameProblem,
  orderFolders,
  parseTemplate,
  runForEngine,
  slugify,
  suggestName,
  templateOfDraft,
  templateRun,
  withModel,
  withThinking,
  type BotTemplate,
} from "@/lib/templates";
import { ORIGIN, req, tempHome } from "./helpers";

const valid = { id: "my-bot", name: "Bot của tôi", emoji: "🤖", color: "sky", purpose: "Việc riêng", engine: "claude", role: "quick", instructions: "Dòng 1\nDòng 2", skills: ["tdd-workflow"] };
const tpl = (id: string): BotTemplate => BUILT_IN_TEMPLATES.find((t) => t.id === id)!;

describe("built-in templates", () => {
  it("are the 6 generic ones, each one valid and unique", () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.id)).toEqual(["blank", "fullstack", "reviewer", "tester", "researcher", "planner"]);
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.builtIn).toBe(true);
      // A built-in one passes the same check a file does (only `builtIn` differs).
      expect(parseTemplate(t), t.id).toEqual({ ...t, builtIn: false });
    }
    for (const id of SUGGESTED_TEMPLATE_IDS) expect(tpl(id)).toBeDefined();
  });
  it("never ask for a secret", () => {
    for (const t of BUILT_IN_TEMPLATES) expect(t.instructions).not.toMatch(/token|password|api key/i);
  });
  it("are brand-free: the public binary ships no product, company or owner folder (those are the owner's own files)", () => {
    const text = JSON.stringify(BUILT_IN_TEMPLATES);
    expect(text).not.toMatch(/8 ?sync|acoleads|su-code|content-post-agency|cpa-/i);
    expect(text).not.toMatch(/\b(ZUS|TIA)\b/);
    for (const t of BUILT_IN_TEMPLATES) expect(t.folderHint, t.id).toBeUndefined();
  });
});

describe("parseTemplate", () => {
  it("takes a valid file and is never builtIn", () => {
    expect(parseTemplate({ ...valid, builtIn: true })).toEqual({ ...valid, builtIn: false });
    expect(parseTemplate({ ...valid, skills: undefined, instructions: undefined, folderHint: "tools/x", firstMessage: "Chào" })).toMatchObject({ skills: [], instructions: "", folderHint: "tools/x", firstMessage: "Chào" });
  });
  it("refuses every wrong field", () => {
    const bad: Record<string, unknown>[] = [
      { id: "Bad Id" },
      { id: "x".repeat(33) },
      { name: "" },
      { name: "n".repeat(41) },
      { emoji: undefined },
      { color: "red" },
      { engine: "gpt" },
      { role: "boss" },
      { model: "gpt-5" },
      { engine: "omp", role: "quick" },
      { engine: "omp", role: undefined, model: "claude-opus-5-5" },
      { engine: "omp", role: undefined, model: "zai/glm 5" },
      { engine: "omp", role: undefined, model: `zai/${"m".repeat(130)}` },
      { engine: "omp", role: undefined, thinking: "high" },
      { engine: "omp", role: undefined, model: "zai/glm-5.3", thinking: "turbo" },
      { thinking: "off" },
      { thinking: "ultra" },
      { instructions: "1\n2\n3\n4\n5\n6\n7" },
      { instructions: "x".repeat(1201) },
      { instructions: "a\x1bb" },
      { skills: "tdd" },
      { skills: ["Bad Skill"] },
      { skills: Array.from({ length: 13 }, (_, i) => `s${i}`) },
      { folderHint: "../etc" },
      { folderHint: "C:\\Users" },
      { folderHint: "/abs" },
      { firstMessage: "m".repeat(601) },
      { purpose: "a\nb" },
    ];
    for (const b of bad) expect(parseTemplate({ ...valid, ...b }), JSON.stringify(b)).toBeNull();
    expect(parseTemplate({ ...valid, model: "claude-opus-5-5", thinking: "high" })).toMatchObject({ model: "claude-opus-5-5", thinking: "high" });
    expect(parseTemplate({ ...valid, role: undefined, engine: "omp", model: "zai/glm-5.3", thinking: "off" })).toMatchObject({ engine: "omp", model: "zai/glm-5.3", thinking: "off" });
    for (const x of [null, [], "x", 5]) expect(parseTemplate(x)).toBeNull();
  });
});

describe("mergeTemplates", () => {
  it("keeps the built-in order, a custom one replaces its id, the others follow by name", () => {
    const own = [parseTemplate({ ...valid, id: "zz", name: "Zeta" })!, parseTemplate({ ...valid, id: "reviewer", name: "Reviewer của tôi" })!, parseTemplate({ ...valid, id: "aa", name: "Alpha" })!];
    const all = mergeTemplates(BUILT_IN_TEMPLATES, own);
    expect(all.map((t) => t.id)).toEqual([...BUILT_IN_TEMPLATES.map((t) => t.id), "aa", "zz"]);
    expect(all.find((t) => t.id === "reviewer")).toMatchObject({ name: "Reviewer của tôi", builtIn: false });
  });
});

describe("custom template files", () => {
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    const dir = templatesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ ...valid, id: "mine" }));
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify({ ...valid, id: "reviewer", name: "Reviewer riêng" }));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
    fs.writeFileSync(path.join(dir, "wrong.json"), JSON.stringify({ ...valid, id: "wrong", color: "red" }));
    fs.writeFileSync(path.join(dir, "huge.json"), JSON.stringify({ ...valid, id: "huge", pad: "x".repeat(20_000) }));
    fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify({ ...valid, id: "mine", name: "Trùng id" }));
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
    fs.mkdirSync(path.join(dir, "dir.json"));
  });
  it("skips broken, wrong, oversized and duplicate files", () => {
    expect(readCustomTemplates().map((t) => [t.id, t.name])).toEqual([
      ["mine", valid.name],
      ["reviewer", "Reviewer riêng"],
    ]);
  });
  it("no folder is no custom template", () => {
    expect(readCustomTemplates(path.join(templatesDir(), "nope"))).toEqual([]);
  });
  it("GET /api/templates merges them over the built-in ones", async () => {
    const res = await templatesRoute.GET(req("/api/templates", { token, origin: ORIGIN }));
    expect(res.status).toBe(200);
    const { templates } = (await res.json()) as { templates: BotTemplate[] };
    expect(templates).toEqual(allTemplates());
    expect(templates.length).toBe(BUILT_IN_TEMPLATES.length + 1);
    expect(templates.find((t) => t.id === "reviewer")?.builtIn).toBe(false);
    expect((await templatesRoute.GET(req("/api/templates", { token: null }))).status).toBe(401);
  });
});

describe("folders", () => {
  it("match a hint by its trailing segments, either slash, any case", () => {
    expect(matchesHint("C:\\Users\\P\\tools\\content-post-agency", "tools/content-post-agency")).toBe(true);
    expect(matchesHint("/home/a/Tools/Content-Post-Agency/", "tools/content-post-agency")).toBe(true);
    expect(matchesHint("/home/a/other-content-post-agency", "content-post-agency")).toBe(false);
    expect(matchesHint("/home/a/x", undefined)).toBe(false);
  });
  it("order: the hinted one, then the latest used, then by name", () => {
    const out = orderFolders(
      [
        { path: "/p/b", name: "b", lastUsed: null },
        { path: "/p/a", name: "a", lastUsed: null },
        { path: "/p/old", name: "old", lastUsed: 5 },
        { path: "/w/su-code", name: "su-code", lastUsed: 1 },
        { path: "/p/new", name: "new", lastUsed: 9 },
      ],
      "su-code",
    );
    expect(out.map((p) => [p.name, p.hinted])).toEqual([
      ["su-code", true],
      ["new", false],
      ["old", false],
      ["a", false],
      ["b", false],
    ]);
  });
});

describe("names", () => {
  it("slugify drops accents and odd characters", () => {
    expect(slugify("Dự án Đẹp_v2!")).toBe("du-an-dep-v2");
    expect(slugify("  ")).toBe("");
  });
  it("suggest <template>-<project>, ≤32 chars, never a taken one", () => {
    expect(suggestName("cpa-full", "content-post-agency", [])).toBe("cpa-full-content-post-agency");
    expect(suggestName("blank", "su-code", [])).toBe("su-code");
    expect(suggestName("blank", "!!", [])).toBe("bot");
    expect(suggestName("research-mkt", "su-code", ["research-mkt-su-code", "research-mkt-su-code-2"])).toBe("research-mkt-su-code-3");
    const long = suggestName("news-curator", "a-very-long-project-folder-name", []);
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long).not.toMatch(/-$/);
    const longTaken = suggestName("news-curator", "a-very-long-project-folder-name", [long]);
    expect(longTaken).toMatch(/-2$/);
    expect(longTaken.length).toBeLessThanOrEqual(32);
    for (const n of [long, longTaken]) expect(nameProblem(n, "claude", [])).toBeNull();
  });
  it("validate like POST /api/sessions and /api/omp/sessions, and flag duplicates", () => {
    expect(nameProblem("fix-login", "claude", [])).toBeNull();
    expect(nameProblem("", "claude", [])).toBe("Đặt tên cho bot.");
    for (const bad of ["Fix", "-x", "a b", "a.b", "x".repeat(33)]) expect(nameProblem(bad, "claude", []), bad).toMatch(/^Tên chỉ gồm/);
    expect(nameProblem("ls", "omp", [])).toMatch(/^Tên chỉ gồm/);
    expect(nameProblem("ls", "claude", [])).toBeNull();
    expect(nameProblem("core", "omp", ["core"])).toMatch(/^Đã có bot/);
  });
});

describe("the create request", () => {
  const folder = { id: 7, path: "C:\\w\\su-code" };
  it("firstPrompt: instructions, skills, then the owner's message", () => {
    expect(firstPrompt(tpl("blank"), "")).toBeNull();
    expect(firstPrompt(tpl("blank"), " hi ")).toBe("hi");
    expect(firstPrompt({ instructions: "Làm A.", skills: ["x", "y"] }, "Việc 1")).toBe("Làm A.\nSkill nên nạp: x, y.\n\nViệc 1");
  });
  it("Claude Code: POST /api/sessions, engine claude, the template's role, its role's model, the prompt", () => {
    const r = createRequest({ template: tpl("reviewer"), name: " review-su-code ", project: folder, message: "Review nhánh này", send: true });
    expect(r).toEqual({ url: "/api/sessions", body: { engine: "claude", name: "review-su-code", project: 7, role: "reviewer", model: "claude-sonnet-5-5", prompt: firstPrompt(tpl("reviewer"), "Review nhánh này") } });
    expect(botKeyOf(r, { session: { name: "hq-review-su-code" } })).toBe("hq-review-su-code");
    expect(botKeyOf(r, {})).toBe("hq-review-su-code");
  });
  it("'Chỉ tạo' leaves the owner's message out; a blank template sends no prompt", () => {
    expect(createRequest({ template: tpl("reviewer"), name: "r", project: folder, message: "Bỏ qua", send: false }).body).toMatchObject({ prompt: firstPrompt(tpl("reviewer"), "") });
    expect(createRequest({ template: tpl("blank"), name: "b", project: folder, message: "x", send: false })).toEqual({
      url: "/api/sessions",
      body: { engine: "claude", name: "b", project: 7, role: "quick", model: "claude-haiku-5-5" },
    });
  });
  it("Claude Code needs a registered project", () => {
    expect(() => createRequest({ template: tpl("blank"), name: "b", project: { id: null, path: "/x" }, message: "", send: false })).toThrow();
  });
  it("omp: the folder, worktree and prompt = instructions + message; omp's own model by default", () => {
    const r = createRequest({ template: tpl("researcher"), name: "researcher-su-code", project: { id: null, path: "C:\\t\\su-code" }, message: "Tìm nguồn", send: true, worktree: true });
    expect(r).toEqual({
      url: "/api/sessions",
      body: { engine: "omp", cwd: "C:\\t\\su-code", name: "researcher-su-code", worktree: true, prompt: `${tpl("researcher").instructions}\nSkill nên nạp: deep-research-web, last30days.\n\nTìm nguồn` },
    });
    expect(createRequest({ template: { ...tpl("researcher"), instructions: "", skills: [] }, name: "c", project: folder, message: "", send: true })).toEqual({ url: "/api/sessions", body: { engine: "omp", cwd: folder.path, name: "c" } });
    expect(botKeyOf(r, { id: "omp-abc" })).toBe("omp-abc");
  });
});

describe("engine + model: the template's by default, the owner's pick when given", () => {
  const folder = { id: 7, path: "C:\\w\\su-code" };
  const omp = (thinking: string[]) => ({ selector: "zai/glm-5.3", provider: "zai", name: "GLM-5.3", thinking });
  it("templateRun: engine, model (Claude: else the role's), level", () => {
    expect(templateRun(tpl("tester"))).toEqual({ engine: "claude", model: "claude-haiku-5-5", thinking: null });
    expect(templateRun(tpl("researcher"))).toEqual({ engine: "omp", model: null, thinking: null });
    const own = parseTemplate({ ...valid, role: undefined, engine: "omp", model: "zai/glm-5.3", thinking: "high" })!;
    expect(templateRun(own)).toEqual({ engine: "omp", model: "zai/glm-5.3", thinking: "high" });
  });
  it("switching engine: the template's run for its own engine, else that engine's default", () => {
    expect(runForEngine(tpl("tester"), "omp")).toEqual({ engine: "omp", model: null, thinking: null });
    expect(runForEngine(tpl("tester"), "claude")).toEqual(templateRun(tpl("tester")));
  });
  it("override: a Claude Code template run on omp drops the role and sends the omp model + level", () => {
    const r = createRequest({ template: tpl("tester"), run: { engine: "omp", model: "zai/glm-5.3", thinking: "high" }, name: "t", project: folder, message: "", send: false });
    expect(r.body).toEqual({ engine: "omp", cwd: folder.path, name: "t", model: "zai/glm-5.3", thinking: "high", prompt: firstPrompt(tpl("tester"), "") });
    const c = createRequest({ template: tpl("tester"), run: { engine: "claude", model: "claude-opus-5-5", thinking: "max" }, name: "t", project: folder, message: "", send: false });
    expect(c.body).toMatchObject({ engine: "claude", role: "tester", model: "claude-opus-5-5", thinking: "max" });
    // An omp template run on Claude Code: no role, the account's model.
    expect(createRequest({ template: tpl("researcher"), run: runForEngine(tpl("researcher"), "claude"), name: "x", project: folder, message: "", send: false }).body).toEqual({
      engine: "claude",
      name: "x",
      project: 7,
      prompt: firstPrompt(tpl("researcher"), ""),
    });
  });
  it("withThinking / withModel: same level clears; omp needs a model for a level; a level the new model lacks clears", () => {
    const run = { engine: "omp" as const, model: "zai/glm-5.3", thinking: null };
    expect(withThinking(run, "high")).toEqual({ ...run, thinking: "high" });
    expect(withThinking({ ...run, thinking: "high" }, "high")).toEqual(run);
    expect(withThinking({ ...run, model: null }, "high")).toEqual({ ...run, model: null });
    expect(withModel({ ...run, thinking: "xhigh" }, "zai/glm-5.3", [omp(["low", "high"])])).toEqual(run);
    expect(withModel({ ...run, thinking: "high" }, "zai/glm-5.3", [omp(["low", "high"])])).toEqual({ ...run, thinking: "high" });
    expect(withModel({ ...run, thinking: "high" }, null, [])).toEqual({ ...run, model: null });
    expect(withModel({ engine: "claude", model: "claude-opus-5-5", thinking: "max" }, null, [])).toEqual({ engine: "claude", model: null, thinking: "max" });
  });
});

describe("the editor's draft", () => {
  it("round-trips every built-in through the form unchanged", () => {
    for (const t of BUILT_IN_TEMPLATES) expect(checkTemplate(templateOfDraft(draftOf(t), t.id))).toEqual({ ok: true, template: { ...t, builtIn: false } });
  });

  it("ids a new one from its name, splits skills, drops empty and claude-only fields", () => {
    const d = { ...BLANK_DRAFT, name: "Viết tài liệu", purpose: "Viết README", instructions: "Viết ngắn.", skills: " tdd-workflow,  e2e-testing ", run: { engine: "omp" as const, model: null, thinking: null }, role: "quick" as const };
    const raw = templateOfDraft(d);
    expect(raw).toMatchObject({ id: "viet-tai-lieu", engine: "omp", skills: ["tdd-workflow", "e2e-testing"] });
    expect(raw).not.toHaveProperty("role");
    expect(raw).not.toHaveProperty("folderHint");
    expect(checkTemplate(raw).ok).toBe(true);
    expect(templateOfDraft({ ...d, name: "!!!" }).id).toBe("mau-moi");
  });

  it("says which field is wrong", () => {
    const r = checkTemplate(templateOfDraft({ ...BLANK_DRAFT, name: "A", purpose: "B", instructions: "1\n2\n3\n4\n5\n6\n7" }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Lời dặn") });
    expect(checkTemplate(templateOfDraft(BLANK_DRAFT)).ok).toBe(false);
  });

  it("copies under a name that still fits", () => {
    const t = { ...BUILT_IN_TEMPLATES[1]!, name: "x".repeat(40) };
    const c = copyDraft(t);
    expect(c.name.length).toBeLessThanOrEqual(40);
    expect(c.name.endsWith(" (bản sao)")).toBe(true);
    expect(checkTemplate(templateOfDraft(c)).ok).toBe(true);
  });
});
