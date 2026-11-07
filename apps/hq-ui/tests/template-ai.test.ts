import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS, ROLE_IDS } from "@/lib/roles";
import { CLAUDE_EFFORTS, OMP_THINKING } from "@/lib/room-model";
import { BUILT_IN_TEMPLATES, TEMPLATE_COLORS, TEMPLATE_LIMITS, parseTemplate } from "@/lib/templates";

// "Tạo bằng AI" / "Viết lại bằng AI": the `claude -p` argv, the prompt's schema, and what the answer must be.
const m = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/server/proc", async (orig) => ({ ...(await orig<typeof import("@/lib/server/proc")>()), run: m.run }));

import { POST } from "@/app/api/templates/ai/route";
import { getToken } from "@/lib/server/auth";
import { AI_OUTPUT_MAX, AI_TIMEOUT_MS, GENERATOR_EXAMPLE, TEMPLATE_GENERATOR_PROMPT, aiArgs, parseGenerated } from "@/lib/server/template-ai";
import { ORIGIN, req, tempHome } from "./helpers";

const draft = { ...GENERATOR_EXAMPLE, id: "doc-writer", name: "Viết tài liệu", purpose: "Viết README" };
const reply = (stdout: string, extra: Record<string, unknown> = {}) => m.run.mockResolvedValueOnce({ ok: true, stdout, stderr: "", ...extra });
const post = (body: unknown, ui = true) => POST(req("/api/templates/ai", { method: "POST", token: getToken(), origin: ORIGIN, body, ui }));

beforeAll(() => tempHome());
beforeEach(() => m.run.mockReset());

describe("the generator prompt", () => {
  it("its example passes parseTemplate and names every field parseTemplate takes", () => {
    const t = parseTemplate(GENERATOR_EXAMPLE);
    expect(t).not.toBeNull();
    const fields = ["id", "name", "emoji", "color", "purpose", "engine", "role", "model", "thinking", "instructions", "skills", "folderHint", "firstMessage"];
    for (const f of fields) expect(TEMPLATE_GENERATOR_PROMPT, f).toContain(`- ${f}`);
    // Every key a parsed template can have (but the internal `builtIn`) is in the prompt.
    for (const k of Object.keys({ ...t, model: 1, folderHint: 1 })) if (k !== "builtIn") expect(fields).toContain(k);
  });
  it("states the same limits and choices parseTemplate checks", () => {
    const L = TEMPLATE_LIMITS;
    for (const n of [L.name, L.purpose, L.instructions, L.instructionLines, L.skills, L.skill, L.folderHint, L.firstMessage, L.model]) expect(TEMPLATE_GENERATOR_PROMPT).toContain(String(n));
    for (const v of [...TEMPLATE_COLORS, ...ROLE_IDS, ...MODELS, ...CLAUDE_EFFORTS, ...OMP_THINKING]) expect(TEMPLATE_GENERATOR_PROMPT).toContain(v);
    expect(TEMPLATE_GENERATOR_PROMPT).toMatch(/tiếng Việt/);
    expect(TEMPLATE_GENERATOR_PROMPT).toMatch(/không ghi secret/);
    expect(TEMPLATE_GENERATOR_PROMPT).not.toMatch(/8 ?sync|acoleads/i);
  });
  it("runs claude -p with no tools, nothing kept, the owner's text after --", () => {
    const a = aiArgs("-x mô tả");
    expect(a.slice(0, 9)).toEqual(["-p", "--model", "claude-sonnet-5-5", "--output-format", "text", "--no-session-persistence", "--tools", "", "--system-prompt"]);
    expect(a.slice(-2)).toEqual(["--", "-x mô tả"]);
  });
});

describe("parseGenerated", () => {
  it("good: bare JSON or inside a code fence", () => {
    expect(parseGenerated(JSON.stringify(draft))).toMatchObject({ ok: true, template: { id: "doc-writer", builtIn: false } });
    expect(parseGenerated(`Đây là mẫu:\n\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``)).toMatchObject({ ok: true });
  });
  it("garbage, broken JSON, a wrong field: an error, nothing to save", () => {
    expect(parseGenerated("Xin lỗi, tôi không làm được.")).toMatchObject({ ok: false, status: 502 });
    expect(parseGenerated("{ id: doc }")).toMatchObject({ ok: false });
    const r = parseGenerated(JSON.stringify({ ...draft, instructions: "1\n2\n3\n4\n5\n6\n7" }));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/6 dòng/);
  });
  it("too long: refused before parsing", () => {
    expect(parseGenerated(`${JSON.stringify(draft)}${" ".repeat(AI_OUTPUT_MAX)}`)).toMatchObject({ ok: false, error: expect.stringMatching(/quá dài/) });
  });
  it("rewrite keeps the id", () => {
    expect(parseGenerated(JSON.stringify(draft), "reviewer-2")).toMatchObject({ ok: true, template: { id: "reviewer-2" } });
  });
});

describe("POST /api/templates/ai", () => {
  it("is the owner's page only: a room gets 403 and nothing runs", async () => {
    expect((await post({ mode: "new", text: "bot viết test" }, false)).status).toBe(403);
    expect(m.run).not.toHaveBeenCalled();
  });
  it("new: one call, 60 s cap, the draft back (not saved)", async () => {
    reply(JSON.stringify(draft));
    const r = await post({ mode: "new", text: "Bot viết README cho dự án" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { template: unknown }).template).toMatchObject({ id: "doc-writer", name: "Viết tài liệu" });
    const [cmd, argv, timeout] = m.run.mock.calls[0] as [string, string[], number];
    expect(cmd).toBe("claude");
    expect(timeout).toBe(AI_TIMEOUT_MS);
    expect(argv.at(-1)).toBe("Viết một mẫu bot theo mô tả: Bot viết README cho dự án");
  });
  it("rewrite: sends the current template, keeps its id", async () => {
    reply(JSON.stringify({ ...draft, id: "other" }));
    const cur = { ...BUILT_IN_TEMPLATES.find((t) => t.id === "tester")!, id: "tester-2" };
    const r = await post({ mode: "rewrite", text: "Thêm bước chạy lint", template: cur });
    expect(((await r.json()) as { template: { id: string } }).template.id).toBe("tester-2");
    expect((m.run.mock.calls[0][1] as string[]).at(-1)).toContain('"id":"tester-2"');
  });
  it("bad input 422; a bad answer 502; past 60 s 504", async () => {
    for (const body of [{ mode: "new", text: "" }, { mode: "new", text: "x".repeat(501) }, { mode: "new", text: "a\x1bb" }, { mode: "x", text: "a" }, { mode: "rewrite", text: "a", template: { id: "Bad" } }]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(422);
    }
    expect(m.run).not.toHaveBeenCalled();
    reply("không phải JSON");
    expect((await post({ mode: "new", text: "a" })).status).toBe(502);
    reply("", { ok: false, killed: true });
    expect((await post({ mode: "new", text: "a" })).status).toBe(504);
    reply("", { ok: false, stderr: "not logged in\nmore" });
    const r = await post({ mode: "new", text: "a" });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toBe("Chưa chạy được claude: not logged in");
  });
});
