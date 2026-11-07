// "Tạo bằng AI" / "Viết lại bằng AI" in the template editor (components/hq/bots/template-editor.tsx): one
// `claude -p` call (argv only, no tools, no session kept, 60 s cap) whose answer must pass checkTemplate.
// Nothing is saved here: the route returns the draft and the owner reviews it before "Lưu".
import os from "node:os";
import { MODELS, ROLE_IDS } from "@/lib/roles";
import { CLAUDE_EFFORTS, OMP_THINKING } from "@/lib/room-model";
import { checkTemplate, TEMPLATE_COLORS, TEMPLATE_LIMITS as L, type BotTemplate } from "@/lib/templates";
import { run } from "./proc";

/** The example the prompt shows; tests/template-ai.test.ts checks it passes parseTemplate. */
export const GENERATOR_EXAMPLE = {
  id: "api-tester",
  name: "Kiểm thử API",
  emoji: "🧪",
  color: "lime",
  purpose: "Viết và chạy test cho các endpoint REST của dự án",
  engine: "claude",
  role: "tester",
  thinking: "medium",
  instructions:
    "Đọc route trong thư mục API, liệt kê endpoint chưa có test.\nViết test cho từng endpoint: trường hợp đúng, sai quyền, dữ liệu thiếu.\nChạy bộ test, báo lệnh đã chạy và kết quả thật.\nChỉ sửa file test, không sửa code sản phẩm.",
  skills: ["api-design", "tdd-workflow"],
  firstMessage: "Viết test cho các endpoint đơn hàng: tạo, sửa, huỷ",
} as const;

/** The system prompt: every field parseTemplate takes, with its limit. Built from the same constants it checks. */
export const TEMPLATE_GENERATOR_PROMPT = [
  "Bạn viết MẪU BOT cho HQ: một phiên Claude Code hoặc omp làm việc trong một thư mục code.",
  "Trả về DUY NHẤT một object JSON hợp lệ, không markdown, không lời dẫn. Mọi chữ viết bằng tiếng Việt (tên lệnh, thuật ngữ kỹ thuật giữ tiếng Anh). Không ký tự điều khiển.",
  "Các trường:",
  `- id: chữ thường a-z, số, gạch nối; bắt đầu bằng chữ hoặc số; tối đa 32 ký tự.`,
  `- name: tên ngắn, tối đa ${L.name} ký tự.`,
  `- emoji: đúng 1 emoji.`,
  `- color: một trong ${TEMPLATE_COLORS.join(", ")}.`,
  `- purpose: một dòng nói bot làm gì, tối đa ${L.purpose} ký tự.`,
  `- engine: "claude" (Claude Code) hoặc "omp". Mặc định "claude".`,
  `- role (chỉ khi engine "claude", có thể bỏ): một trong ${ROLE_IDS.join(", ")}.`,
  `- model (có thể bỏ): engine "claude" thì một trong ${MODELS.join(", ")}; engine "omp" thì bỏ, trừ khi người dùng ghi rõ "<provider>/<model>" (tối đa ${L.model} ký tự).`,
  `- thinking (có thể bỏ): engine "claude" thì một trong ${CLAUDE_EFFORTS.join(", ")}; engine "omp" chỉ khi có model, một trong ${OMP_THINKING.join(", ")}.`,
  `- instructions: lời dặn bot, tối đa ${L.instructionLines} dòng (ngăn bằng \\n), tối đa ${L.instructions} ký tự. Mỗi dòng một việc cụ thể, kiểm chứng được (lệnh chạy, tiêu chí xong), và nói rõ việc không được làm.`,
  `- skills: mảng tối đa ${L.skills} tên skill (chữ thường, số, . _ : -, mỗi tên tối đa ${L.skill} ký tự), có thể rỗng. Chỉ tên, không nội dung.`,
  `- folderHint (có thể bỏ): đường dẫn tương đối của thư mục hay làm, tối đa ${L.folderHint} ký tự, không "..", không bắt đầu bằng "/" hay ổ đĩa.`,
  `- firstMessage: tin nhắn đầu tiên cụ thể chủ sẽ gửi bot, một dòng, tối đa ${L.firstMessage} ký tự.`,
  "Luật: không ghi secret (token, mật khẩu, API key, nội dung .env), không ghi tên khách hàng, dữ liệu CRM hay thông tin cá nhân, không bịa số liệu. Không push, merge, release hay đăng bài khi chủ chưa ra lệnh.",
  `Ví dụ: ${JSON.stringify(GENERATOR_EXAMPLE)}`,
].join("\n");

/** What the owner types: one sentence (new) or one instruction (rewrite). */
export const AI_TEXT_MAX = 500;
/** A template is ~1-2 KB of JSON; a longer answer is not one. */
export const AI_OUTPUT_MAX = 8000;
export const AI_TIMEOUT_MS = 60_000;
/** Writing a template is short work: the mid model. */
const AI_MODEL = "claude-sonnet-5-5";

export type AiInput = { mode: "new"; text: string } | { mode: "rewrite"; text: string; template: BotTemplate };
export type AiResult = { ok: true; template: BotTemplate } | { ok: false; status: number; error: string };

/** The user turn: the owner's sentence, or the current template + the change asked (its id kept). */
export function aiUserMessage(input: AiInput): string {
  if (input.mode === "new") return `Viết một mẫu bot theo mô tả: ${input.text}`;
  const t = input.template;
  return `Mẫu hiện tại: ${JSON.stringify({ ...t, builtIn: undefined })}\nViết lại mẫu này theo yêu cầu: ${input.text}\nGiữ nguyên id "${t.id}". Trả về mẫu mới đầy đủ.`;
}

/** argv for `claude -p`: no tools, nothing kept, the prompt after `--` (a leading dash is not a flag). */
export function aiArgs(user: string): string[] {
  return ["-p", "--model", AI_MODEL, "--output-format", "text", "--no-session-persistence", "--tools", "", "--system-prompt", TEMPLATE_GENERATOR_PROMPT, "--", user];
}

/** The model's answer as a template: the JSON object in it (code fences allowed), checked like a file. */
export function parseGenerated(out: string, keepId?: string): AiResult {
  const no = (error: string): AiResult => ({ ok: false, status: 502, error });
  if (out.length > AI_OUTPUT_MAX) return no("AI trả lời quá dài, không phải một mẫu. Thử lại.");
  const a = out.indexOf("{");
  const b = out.lastIndexOf("}");
  if (a < 0 || b <= a) return no("AI không trả về JSON. Thử lại.");
  let raw: unknown;
  try {
    raw = JSON.parse(out.slice(a, b + 1));
  } catch {
    return no("AI trả về JSON hỏng. Thử lại.");
  }
  if (keepId && raw && typeof raw === "object" && !Array.isArray(raw)) raw = { ...raw, id: keepId };
  const r = checkTemplate(raw);
  return r.ok ? { ok: true, template: r.template } : no(`AI trả về mẫu chưa hợp lệ (${r.error}) Thử lại.`);
}

type Exec = typeof run;

/** One `claude -p` call; the draft (never saved) or why there is none. */
export async function generateTemplate(input: AiInput, exec: Exec = run): Promise<AiResult> {
  const r = await exec("claude", aiArgs(aiUserMessage(input)), AI_TIMEOUT_MS, os.tmpdir());
  if (!r.ok) {
    if (r.killed) return { ok: false, status: 504, error: "AI quá 60 giây chưa xong. Thử lại." };
    const why = r.stderr.trim().split("\n")[0]?.slice(0, 200);
    return { ok: false, status: 502, error: `Chưa chạy được claude${why ? `: ${why}` : "."}` };
  }
  return parseGenerated(r.stdout, input.mode === "rewrite" ? input.template.id : undefined);
}
