import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as templatesRoute from "@/app/api/templates/route";
import { getToken } from "@/lib/server/auth";
import { allTemplates, readCustomTemplates, templatesDir } from "@/lib/server/templates";
import {
  BUILT_IN_TEMPLATES,
  SUGGESTED_TEMPLATE_IDS,
  botKeyOf,
  createRequest,
  firstPrompt,
  matchesHint,
  mergeTemplates,
  nameProblem,
  orderFolders,
  parseTemplate,
  slugify,
  suggestName,
  type BotTemplate,
} from "@/lib/templates";
import { ORIGIN, req, tempHome } from "./helpers";

const valid = { id: "my-bot", name: "Bot của tôi", emoji: "🤖", color: "sky", purpose: "Việc riêng", engine: "claude", role: "quick", instructions: "Dòng 1\nDòng 2", skills: ["tdd-workflow"] };
const tpl = (id: string): BotTemplate => BUILT_IN_TEMPLATES.find((t) => t.id === id)!;

describe("built-in templates", () => {
  it("are the 12 of the research doc, each one valid and unique", () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.id)).toEqual([
      "blank",
      "fullstack",
      "reviewer",
      "tester",
      "researcher",
      "planner",
      "cpa-full",
      "research-mkt",
      "course-writer",
      "news-curator",
      "zus-release",
      "tia-release",
    ]);
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.builtIn).toBe(true);
      // A built-in one passes the same check a file does (only `builtIn` differs).
      expect(parseTemplate(t), t.id).toEqual({ ...t, builtIn: false });
    }
    for (const id of SUGGESTED_TEMPLATE_IDS) expect(tpl(id)).toBeDefined();
  });
  it("never ask to touch client or CRM data", () => {
    for (const t of BUILT_IN_TEMPLATES) expect(t.instructions).not.toMatch(/token|password|api key/i);
    expect(tpl("research-mkt").instructions).toContain("Không đụng dữ liệu CRM/AcoLeads");
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
  it("Claude Code: POST /api/sessions with the template's role and the prompt", () => {
    const r = createRequest({ template: tpl("reviewer"), name: " review-su-code ", project: folder, message: "Review nhánh này", send: true });
    expect(r).toEqual({ url: "/api/sessions", body: { name: "review-su-code", project: 7, role: "reviewer", prompt: firstPrompt(tpl("reviewer"), "Review nhánh này") } });
    expect(botKeyOf(r, { session: { name: "hq-review-su-code" } })).toBe("hq-review-su-code");
    expect(botKeyOf(r, {})).toBe("hq-review-su-code");
  });
  it("'Chỉ tạo' leaves the owner's message out; a blank template sends no prompt", () => {
    expect(createRequest({ template: tpl("reviewer"), name: "r", project: folder, message: "Bỏ qua", send: false }).body).toMatchObject({ prompt: firstPrompt(tpl("reviewer"), "") });
    expect(createRequest({ template: tpl("blank"), name: "b", project: folder, message: "x", send: false })).toEqual({ url: "/api/sessions", body: { name: "b", project: 7, role: "quick" } });
  });
  it("Claude Code needs a registered project", () => {
    expect(() => createRequest({ template: tpl("blank"), name: "b", project: { id: null, path: "/x" }, message: "", send: false })).toThrow();
  });
  it("omp: POST /api/omp/sessions with the folder, worktree and prompt = instructions + message", () => {
    const r = createRequest({ template: tpl("cpa-full"), name: "cpa-full-content", project: { id: null, path: "C:\\t\\content-post-agency" }, message: "Làm bộ nội dung hôm nay", send: true, worktree: true });
    expect(r).toEqual({
      url: "/api/omp/sessions",
      body: { cwd: "C:\\t\\content-post-agency", name: "cpa-full-content", worktree: true, prompt: `${tpl("cpa-full").instructions}\nSkill nên nạp: cpa-ops-cli, cpa-app-attach, brand-8sync.\n\nLàm bộ nội dung hôm nay` },
    });
    expect(createRequest({ template: { ...tpl("cpa-full"), instructions: "", skills: [] }, name: "c", project: folder, message: "", send: true })).toEqual({ url: "/api/omp/sessions", body: { cwd: folder.path, name: "c" } });
    expect(botKeyOf(r, { id: "omp-abc" })).toBe("omp-abc");
  });
});
