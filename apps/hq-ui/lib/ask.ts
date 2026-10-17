// What a session that waits for the owner is asking, read from its Claude Code transcript (JSONL):
// the newest tool call that has no result yet. An AskUserQuestion shows its questions and options;
// any other tool is a permission prompt, shown by its description, never its raw input (a command
// line may hold a secret). Pure; the file read lives in lib/server/ask.ts. Tested in tests/ask.test.ts.

export type AskOption = { label: string; description: string | null };
export type AskQuestion = { header: string | null; question: string; options: AskOption[]; multi: boolean };
export type Ask =
  | { kind: "question"; questions: AskQuestion[]; at: number | null }
  | { kind: "permission"; tool: string; what: string | null; at: number | null };

const MAX_TEXT = 600;
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 6;

function text(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

type Block = { type?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown };
type Row = { type?: unknown; timestamp?: unknown; isMeta?: unknown; message?: { id?: unknown; content?: unknown } };

function questionsOf(input: unknown): AskQuestion[] {
  const qs = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs)) return [];
  return qs.slice(0, MAX_QUESTIONS).flatMap((q: Record<string, unknown>) => {
    const question = text(q?.question);
    if (!question) return [];
    const options = (Array.isArray(q.options) ? q.options : []).slice(0, MAX_OPTIONS).flatMap((o: Record<string, unknown>) => {
      const label = text(o?.label, 120);
      return label ? [{ label, description: text(o.description, 300) }] : [];
    });
    return [{ header: text(q.header, 40), question, options, multi: q.multiSelect === true }];
  });
}

/** One line for a permission prompt: the tool's own description or the file it touches. */
function permissionWhat(name: string, input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.description === "string") return text(i.description, 200);
  if (typeof i.file_path === "string") return text(i.file_path, 200);
  if (typeof i.url === "string") {
    try {
      return new URL(i.url).host;
    } catch {
      return null;
    }
  }
  return name === "ExitPlanMode" ? "Duyệt plan để bắt đầu làm" : null;
}

/**
 * `lines`: transcript JSONL lines, oldest first (a tail read may start mid-line: unparsable lines are skipped).
 * Claude Code writes each block of one assistant message as its own line (same `message.id`), and the
 * results of its calls as later `user` lines. Only the newest message with a tool call counts: an open
 * call in an older message, or one followed by a typed prompt or newer assistant text, is left over
 * from a crash or a resume, not what the session waits on now.
 */
export function pendingAsk(lines: string[]): Ask | null {
  const answered = new Set<string>();
  let fallback: Ask | null = null;
  /** Message id of the newest call found: older lines count only while they belong to it. */
  let only: string | null | undefined;
  /** Message id of assistant text newer than any call (undefined: none seen). */
  let textAfter: string | null | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    let row: Row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (row?.isMeta === true) continue;
    const content = row?.message?.content;
    if (row?.type === "user") {
      // A typed prompt: whatever is older is history.
      if (typeof content === "string") return fallback;
      if (!Array.isArray(content)) continue;
      let results = 0;
      for (const b of content as Block[]) {
        if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
          answered.add(b.tool_use_id);
          results++;
        }
      }
      if (!results && (content as Block[]).some((b) => b?.type === "text")) return fallback;
      continue;
    }
    if (row?.type !== "assistant" || !Array.isArray(content)) continue;
    const mid = typeof row.message?.id === "string" ? row.message.id : null;
    if (only !== undefined && (mid == null || mid !== only)) return fallback;
    const calls = (content as Block[]).filter((b) => b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string");
    if (!calls.length) {
      if (only === undefined && textAfter === undefined && (content as Block[]).some((b) => b?.type === "text")) textAfter = mid;
      continue;
    }
    // The model wrote on in a newer message: this call was abandoned.
    if (only === undefined && textAfter !== undefined && (textAfter == null || textAfter !== mid)) return null;
    only = mid;
    const open = calls.filter((b) => !answered.has(b.id as string));
    if (!open.length) {
      // A message without an id cannot be followed further back.
      if (mid == null) return fallback;
      continue;
    }
    const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) || null : null;
    const ask = open.find((b) => b.name === "AskUserQuestion");
    if (ask) {
      const questions = questionsOf(ask.input);
      if (questions.length) return { kind: "question", questions, at };
    }
    // Parallel calls are separate lines of the same message: keep looking for an AskUserQuestion among them.
    const b = open[open.length - 1];
    fallback ??= { kind: "permission", tool: b.name as string, what: permissionWhat(b.name as string, b.input), at };
  }
  return fallback;
}

/** The short id `claude attach` takes (it also accepts the full id or part of the name). */
export function attachCommand(sessionId: string): string {
  return `claude attach ${sessionId.slice(0, 8)}`;
}

/** What the owner is asked to do, in the words the page uses. */
export const TOOL_ASK: Record<string, string> = {
  Bash: "Xin quyền chạy lệnh",
  PowerShell: "Xin quyền chạy lệnh",
  Edit: "Xin quyền sửa file",
  Write: "Xin quyền ghi file",
  MultiEdit: "Xin quyền sửa file",
  NotebookEdit: "Xin quyền sửa notebook",
  WebFetch: "Xin quyền mở trang",
  ExitPlanMode: "Chờ anh duyệt plan",
  EnterWorktree: "Xin quyền tạo worktree",
};

/** One line for a room card / roster row: the first question, or what permission it asks for. */
export function askLine(a: Ask | null | undefined): string | null {
  if (!a) return null;
  if (a.kind === "question") {
    const q = a.questions[0];
    return q.header ? `${q.header}: ${q.question}` : q.question;
  }
  return a.what ? `${askTitle(a)}: ${a.what}` : askTitle(a);
}

export function askTitle(a: Ask): string {
  if (a.kind === "question") return a.questions.length > 1 ? `Hỏi anh ${a.questions.length} câu` : "Hỏi anh";
  return TOOL_ASK[a.tool] ?? `Xin quyền dùng ${a.tool}`;
}
