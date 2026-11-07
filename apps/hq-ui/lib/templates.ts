// Bot templates for the Bots tab's "Bot mới" sheet (components/hq/bots/new-bot-sheet.tsx), as decided in
// su-code/research/hq-bots-groups.md §4. Built-in ones live here; the owner's own are JSON files in
// ~/.config/8sync/hq/templates/ (lib/server/templates.ts reads them through `parseTemplate`) and replace a
// built-in one with the same id. Text only: never a token, never client or CRM data. Pure and client-safe:
// the request builders below are what the sheet sends. Tested in tests/templates.test.ts.
import { isModelId, isRoleId, roleOf, type RoleId } from "./roles";
import { effortsFor, isClaudeEffort, isThinking, SELECTOR_RE, type ModelChoice } from "./room-model";
import { isOmpSessionName } from "./omp-workspace";

export type BotEngine = "claude" | "omp";
export const BOT_ENGINES: readonly BotEngine[] = ["claude", "omp"];
export const isBotEngine = (v: unknown): v is BotEngine => v === "claude" || v === "omp";

/** The accent a template card gets; the sheet maps each one to static Tailwind classes. */
export const TEMPLATE_COLORS = ["slate", "sky", "amber", "lime", "violet", "indigo", "rose", "orange", "emerald", "cyan", "fuchsia", "teal"] as const;
export type TemplateColor = (typeof TEMPLATE_COLORS)[number];

export type BotTemplate = {
  id: string;
  name: string;
  emoji: string;
  color: TemplateColor;
  /** One line, Vietnamese. */
  purpose: string;
  engine: BotEngine;
  /** Claude Code only (lib/roles.ts ROLES): the session's role. */
  role?: RoleId;
  /** Claude Code: a lib/roles.ts model id (else the role's); omp: `<provider>/<model>` (else omp's default). */
  model?: string;
  /** Claude Code: `--effort` level; omp: thinking level (needs `model`). Else the model's default. */
  thinking?: string;
  /** ≤6 lines, put in front of the first message. */
  instructions: string;
  /** Skill names the bot is reminded to load; never a skill's content. */
  skills: string[];
  /** Where it usually works: a folder suffix ("tools/content-post-agency"), matched against the project paths. */
  folderHint?: string;
  /** The first message's placeholder. */
  firstMessage?: string;
  builtIn?: boolean;
};

/** Caps on a template file's fields (custom templates are typed by hand). */
export const TEMPLATE_LIMITS = { name: 40, emoji: 16, purpose: 140, instructions: 1200, instructionLines: 6, skills: 12, skill: 64, folderHint: 200, firstMessage: 600, model: 128 } as const;
/** A template id: the same shape as a session name, so `<id>-<project>` stays a valid one. */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SKILL_RE = /^[a-z0-9][a-z0-9:._-]*$/;
/** A folder hint: relative path segments, no `..`, no drive or leading slash. */
const HINT_RE = /^(?![\\/])(?![a-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\0<>|"?*]+$/i;

const ok = (s: unknown, max: number): s is string => typeof s === "string" && s.trim() !== "" && s.length <= max;
const optional = (s: unknown, max: number): boolean => s === undefined || s === null || s === "" || ok(s, max);
// Control characters (except a newline in the instructions) never belong in a template.
const clean = (s: string, newlines = false) => !(newlines ? /[\0-\x09\x0b-\x1f\x7f]/ : /[\0-\x1f\x7f]/).test(s);

/** A template from a file (or anything else), checked field by field; null when any field is wrong. Never `builtIn`. */
export function parseTemplate(raw: unknown): BotTemplate | null {
  const r = checkTemplate(raw);
  return r.ok ? r.template : null;
}

/** parseTemplate with the reason (Vietnamese, one field) when a field is wrong: the editor and the API show it. */
export function checkTemplate(raw: unknown): { ok: true; template: BotTemplate } | { ok: false; error: string } {
  const no = (error: string) => ({ ok: false as const, error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return no("Mẫu phải là một object JSON.");
  const t = raw as Record<string, unknown>;
  const L = TEMPLATE_LIMITS;
  if (typeof t.id !== "string" || !ID_RE.test(t.id)) return no("Mã mẫu: chữ thường, số, gạch nối, tối đa 32 ký tự.");
  if (!ok(t.name, L.name) || !clean(t.name)) return no(`Tên: 1 đến ${L.name} ký tự, một dòng.`);
  if (!ok(t.emoji, L.emoji) || !clean(t.emoji)) return no("Emoji: chọn một emoji.");
  if (!ok(t.purpose, L.purpose) || !clean(t.purpose)) return no(`Mục đích: 1 đến ${L.purpose} ký tự, một dòng.`);
  if (!(TEMPLATE_COLORS as readonly unknown[]).includes(t.color)) return no("Màu: chọn một màu trong danh sách.");
  if (t.engine !== "claude" && t.engine !== "omp") return no("Engine: claude hoặc omp.");
  if (t.role !== undefined && (t.engine === "omp" || !isRoleId(t.role))) return no("Vai trò: chỉ Claude Code có, chọn trong danh sách.");
  if (t.model !== undefined && (t.engine === "claude" ? !isModelId(t.model) : typeof t.model !== "string" || t.model.length > L.model || !SELECTOR_RE.test(t.model))) {
    return no(t.engine === "claude" ? "Model: chọn một model Claude trong danh sách." : "Model omp: dạng <provider>/<model>.");
  }
  if (t.thinking !== undefined && (t.engine === "claude" ? !isClaudeEffort(t.thinking) : !isThinking(t.thinking) || t.model === undefined)) {
    return no(t.engine === "omp" && t.model === undefined ? "Mức suy nghĩ của omp cần một model." : "Mức suy nghĩ không hợp lệ.");
  }
  const instructions = t.instructions ?? "";
  if (typeof instructions !== "string" || instructions.length > L.instructions || !clean(instructions, true)) return no(`Lời dặn: tối đa ${L.instructions} ký tự.`);
  if (instructions.split("\n").length > L.instructionLines) return no(`Lời dặn: tối đa ${L.instructionLines} dòng.`);
  const skills = t.skills ?? [];
  if (!Array.isArray(skills) || skills.length > L.skills || !skills.every((s) => typeof s === "string" && s.length <= L.skill && SKILL_RE.test(s))) {
    return no(`Skill: tối đa ${L.skills} tên, chữ thường, số và . _ : -`);
  }
  if (!optional(t.folderHint, L.folderHint) || (typeof t.folderHint === "string" && t.folderHint !== "" && !HINT_RE.test(t.folderHint))) {
    return no("Thư mục hay làm: đường dẫn tương đối, không có '..'.");
  }
  if (!optional(t.firstMessage, L.firstMessage) || (typeof t.firstMessage === "string" && !clean(t.firstMessage))) return no(`Tin nhắn đầu: một dòng, tối đa ${L.firstMessage} ký tự.`);
  return {
    ok: true,
    template: {
      id: t.id,
      name: t.name.trim(),
      emoji: t.emoji.trim(),
      color: t.color as TemplateColor,
      purpose: t.purpose.trim(),
      engine: t.engine,
      ...(t.role !== undefined ? { role: t.role as RoleId } : {}),
      ...(t.model !== undefined ? { model: t.model as string } : {}),
      ...(t.thinking !== undefined ? { thinking: t.thinking as string } : {}),
      instructions: instructions.trim(),
      skills: [...new Set(skills as string[])],
      ...(typeof t.folderHint === "string" && t.folderHint ? { folderHint: t.folderHint.trim() } : {}),
      ...(typeof t.firstMessage === "string" && t.firstMessage ? { firstMessage: t.firstMessage.trim() } : {}),
      builtIn: false,
    },
  };
}

/** Built-in first (a custom one with the same id takes its place), then the owner's other templates by name. */
export function mergeTemplates(builtIn: readonly BotTemplate[], custom: readonly BotTemplate[]): BotTemplate[] {
  const own = new Map(custom.map((t) => [t.id, t]));
  const head = builtIn.map((t) => own.get(t.id) ?? t);
  const rest = custom.filter((t) => !builtIn.some((b) => b.id === t.id)).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return [...head, ...rest];
}

export const BLANK_TEMPLATE_ID = "blank";

export const BUILT_IN_TEMPLATES: readonly BotTemplate[] = (
  [
    // General.
    { id: "blank", name: "Trống", emoji: "💬", color: "slate", purpose: "Phiên trống, anh tự giao việc", engine: "claude", role: "quick", instructions: "", skills: [] },
    {
      id: "fullstack",
      name: "Dev fullstack",
      emoji: "🛠️",
      color: "sky",
      purpose: "Làm tính năng theo card, có test",
      engine: "claude",
      role: "fullstack",
      instructions: "Làm tính năng theo card được giao. Viết test trước, chạy test và build trước khi báo xong.\nCập nhật CHANGELOG.md. Không push, merge hay release khi chưa có lệnh của owner.",
      skills: ["tdd-workflow", "verification-loop"],
      firstMessage: "Làm card này giúp anh: …",
    },
    {
      id: "reviewer",
      name: "Reviewer",
      emoji: "🔍",
      color: "amber",
      purpose: "Review diff, chỉ báo lỗi có bằng chứng",
      engine: "claude",
      role: "reviewer",
      instructions: "Đọc diff so với origin/main. Chỉ báo lỗi có file:line và cách tái hiện. Không sửa code.\nKết thúc bằng: chặn / cần sửa / ổn.",
      skills: ["security-review", "karpathy-guidelines"],
      firstMessage: "Review nhánh hiện tại",
    },
    {
      id: "tester",
      name: "Tester",
      emoji: "🧪",
      color: "lime",
      purpose: "Viết và chạy e2e, regression",
      engine: "claude",
      role: "tester",
      instructions: "Viết và chạy test e2e/regression cho phần được giao. Báo lệnh đã chạy và kết quả thật, không đoán.\nKhông sửa code sản phẩm, chỉ sửa test.",
      skills: ["e2e-testing", "tdd-workflow"],
      firstMessage: "Viết test cho luồng: …",
    },
    {
      id: "researcher",
      name: "Nghiên cứu",
      emoji: "📚",
      color: "violet",
      purpose: "Báo cáo có trích nguồn",
      engine: "omp",
      instructions: "Mỗi nhận định phải có URL nguồn. Ghi 'chưa kiểm' khi chưa đọc được nguồn chính thức.\nGhi báo cáo thành file Markdown trong thư mục research/ của dự án. Không sửa code.",
      skills: ["deep-research-web", "last30days"],
      firstMessage: "Nghiên cứu giúp anh: …",
    },
    {
      id: "planner",
      name: "Lập kế hoạch",
      emoji: "🧭",
      color: "indigo",
      purpose: "Chia việc thành card, không sửa code",
      engine: "claude",
      role: "plan",
      instructions: "Chia việc thành các card nhỏ, mỗi card có tiêu chí xong đo được. Không sửa code.",
      skills: ["full-flow", "feature"],
      firstMessage: "Lên kế hoạch cho: …",
    },
  ] satisfies Omit<BotTemplate, "builtIn">[]
).map((t) => ({ ...t, builtIn: true }));

/** The three cards the empty Bots list suggests. */
export const SUGGESTED_TEMPLATE_IDS = ["fullstack", "researcher", "reviewer"] as const;

// ── folders ──────────────────────────────────────────────────────────────────

const key = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** The folder is the template's hint: its path ends with the hint's segments ("…/tools/content-post-agency"). */
export function matchesHint(folder: string, hint: string | undefined): boolean {
  const h = hint ? key(hint).replace(/^\/+/, "") : "";
  if (!h) return false;
  const f = key(folder);
  return f === h || f.endsWith(`/${h}`);
}

/** Projects for the folder step: the template's hint first (flagged), then the most recently used, then the rest by name. */
export function orderFolders<P extends { path: string; name: string; lastUsed?: number | null }>(projects: readonly P[], hint: string | undefined): (P & { hinted: boolean })[] {
  return projects
    .map((p) => ({ ...p, hinted: matchesHint(p.path, hint) }))
    .sort((a, b) => Number(b.hinted) - Number(a.hinted) || (b.lastUsed ?? 0) - (a.lastUsed ?? 0) || a.name.localeCompare(b.name, "vi"));
}

// ── names ────────────────────────────────────────────────────────────────────

/** A session name: what both `POST /api/sessions` (lib/server/validate.ts SESSION_NAME_RE) and an omp session take. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NAME_MAX = 32;

/** "Content Post Agency" -> "content-post-agency"; accents dropped ("Dự án" -> "du-an"). */
export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `<template>-<project>` (just the project for "Trống"), ≤32 chars, never one of `taken` (`-2`, `-3`… appended). */
export function suggestName(templateId: string, project: string, taken: readonly string[]): string {
  const p = slugify(project);
  const base = (templateId === BLANK_TEMPLATE_ID ? p || "bot" : [templateId, p].filter(Boolean).join("-")).slice(0, NAME_MAX).replace(/-+$/, "") || "bot";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const tail = `-${n}`;
    const name = `${base.slice(0, NAME_MAX - tail.length).replace(/-+$/, "")}${tail}`;
    if (!used.has(name)) return name;
  }
}

/** Why `name` cannot be used (Vietnamese, for the field), or null. `taken`: names of live bots. */
export function nameProblem(name: string, engine: BotEngine, taken: readonly string[]): string | null {
  const n = name.trim();
  if (!n) return "Đặt tên cho bot.";
  if (!NAME_RE.test(n) || (engine === "omp" && !isOmpSessionName(n))) return "Tên chỉ gồm chữ thường không dấu, số và '-', tối đa 32 ký tự, bắt đầu bằng chữ hoặc số.";
  if (taken.includes(n)) return "Đã có bot tên này. Đặt tên khác để không mở nhầm bot cũ.";
  return null;
}

// ── the create request ───────────────────────────────────────────────────────

/** The first message a new bot gets: the template's instructions and skills, then the owner's message. Null when all are empty. */
export function firstPrompt(t: Pick<BotTemplate, "instructions" | "skills">, message: string): string | null {
  const brief = [t.instructions.trim(), t.skills.length ? `Skill nên nạp: ${t.skills.join(", ")}.` : ""].filter(Boolean).join("\n");
  const text = [brief, message.trim()].filter(Boolean).join("\n\n");
  return text || null;
}

/** How a bot runs: its engine, model (null = the engine's default) and thinking/effort level (null = the model's). */
export type BotRun = { engine: BotEngine; model: string | null; thinking: string | null };

/** What the template starts a bot on: its engine; its model, else (Claude Code) its role's; its level. */
export function templateRun(t: BotTemplate): BotRun {
  return { engine: t.engine, model: t.model ?? (t.engine === "claude" ? (roleOf(t.role)?.model ?? null) : null), thinking: t.thinking ?? null };
}

/**
 * The run after the owner switches the engine: the template's own run when it is that engine, else the
 * engine's default (no model, no level).
 */
export function runForEngine(t: BotTemplate, engine: BotEngine): BotRun {
  return t.engine === engine ? templateRun(t) : { engine, model: null, thinking: null };
}

/** Picking a level: the same one again clears it (the model's default). omp takes a level only with a model. */
export function withThinking(run: BotRun, t: string): BotRun {
  if (run.engine === "omp" && run.model === null) return run;
  return { ...run, thinking: t === run.thinking ? null : t };
}

/** Picking a model (null = the engine's default): the level stays when the new model takes it, else it clears. */
export function withModel(run: BotRun, model: string | null, choices: readonly ModelChoice[]): BotRun {
  if (run.engine === "claude" || run.thinking === null) return { ...run, model };
  const choice = choices.find((c) => c.selector === model);
  return { ...run, model, thinking: model !== null && effortsFor("omp", choice).includes(run.thinking) ? run.thinking : null };
}

export type CreateInput = {
  template: BotTemplate;
  /** Engine/model/level the owner picked; the template's (templateRun) when absent. */
  run?: BotRun;
  name: string;
  /** The folder; `id` is its registered project (Claude Code needs one). */
  project: { id: number | null; path: string };
  message: string;
  /** "Tạo và gửi" (true) or "Chỉ tạo" (false: the owner's message stays out; the template's brief still goes). */
  send: boolean;
  /** omp only: its own git worktree. */
  worktree?: boolean;
};

type RunFields = { model?: string; thinking?: string };
export type CreateRequest = {
  url: "/api/sessions";
  body:
    | ({ engine: "claude"; name: string; project: number; role?: RoleId; prompt?: string } & RunFields)
    | ({ engine: "omp"; cwd: string; name: string; worktree?: true; prompt?: string } & RunFields);
};

/**
 * The POST that creates the bot: `POST /api/sessions` with the engine. Claude Code: a registered project, the
 * template's role, `--model`/`--effort`, the prompt passed to `claude` at start. omp: the folder, `--model
 * <selector>:<level>`, the prompt queued in its inbox. Throws when Claude Code has no project id.
 */
export function createRequest(i: CreateInput): CreateRequest {
  const name = i.name.trim();
  const prompt = firstPrompt(i.template, i.send ? i.message : "");
  const run = i.run ?? templateRun(i.template);
  const fields: RunFields = { ...(run.model ? { model: run.model } : {}), ...(run.thinking ? { thinking: run.thinking } : {}) };
  if (run.engine === "omp") {
    return { url: "/api/sessions", body: { engine: "omp", cwd: i.project.path, name, ...fields, ...(i.worktree ? { worktree: true as const } : {}), ...(prompt ? { prompt } : {}) } };
  }
  if (i.project.id == null) throw new Error("Claude Code cần một dự án đã đăng ký");
  const role = i.template.engine === "claude" ? i.template.role : undefined;
  return { url: "/api/sessions", body: { engine: "claude", name, project: i.project.id, ...(role ? { role } : {}), ...fields, ...(prompt ? { prompt } : {}) } };
}

/** The new bot's key in the Bots list (lib/server/office.ts: a room's key is its session name). */
export function botKeyOf(req: CreateRequest, res: { id?: string; session?: { name?: string } }): string | null {
  return req.body.engine === "omp" ? (res.id ?? null) : (res.session?.name ?? `hq-${req.body.name}`);
}
