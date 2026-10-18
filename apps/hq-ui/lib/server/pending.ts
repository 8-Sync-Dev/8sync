// Questions and permission prompts a room is waiting on while the owner is away (contract C5).
// The kit hook (`8sync ccc hook delegate` / `hook permission`) writes `<id>.json` and polls for
// `<id>.answer.json` until `deadline`; HQ lists the open ones and writes the owner's answer.
// Never an automatic answer: only an authenticated owner request reaches answerPending.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pendingDir } from "./paths";
import { hasControlChars } from "./validate";
import type { Pending, PendingQuestion } from "../pending";

export const PENDING_ID_RE = /^[a-f0-9]{16}$/;
const REQUEST_FILE_RE = /^([a-f0-9]{16})\.json$/;
const MAX_FILE = 64 * 1024;
export const MAX_ANSWER = 500;

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? Array.from(v).slice(0, max).join("") : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A member of parsed JSON, checked: undefined unless `o` is an object. */
const field = (o: unknown, k: string): unknown => (o !== null && typeof o === "object" ? Reflect.get(o, k) : undefined);

function parseQuestions(v: unknown): PendingQuestion[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 8).flatMap((q: unknown): PendingQuestion[] => {
    // Never cut: the question text is the key of the answer the hook hands back to Claude.
    const question = str(field(q, "question"), MAX_FILE);
    if (!question) return [];
    const raw = field(q, "options");
    const options = Array.isArray(raw)
      ? raw.slice(0, 12).flatMap((o: unknown) => {
          const label = str(field(o, "label"), 200);
          return label ? [{ label, description: str(field(o, "description"), 500) ?? "" }] : [];
        })
      : [];
    return [{ question, header: str(field(q, "header"), 60) ?? "", options, multiSelect: field(q, "multiSelect") === true }];
  });
}

/** One request file -> a clean object; null when it is not a v1 request of a known kind. */
export function parsePending(text: string, id: string): Pending | null {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || v.v !== 1 || v.id !== id) return null;
  const kind = v.kind === "question" || v.kind === "permission" ? v.kind : null;
  const deadline = num(v.deadline);
  if (!kind || deadline === null) return null;
  const questions = kind === "question" ? parseQuestions(v.questions) : [];
  if (kind === "question" && !questions.length) return null;
  const fallback = v.fallback === "critic" || v.fallback === "deny" || v.fallback === "dialog" ? v.fallback : kind === "permission" ? "deny" : "critic";
  return {
    id,
    kind,
    session_id: str(v.session_id, 64),
    cwd: str(v.cwd, 1024),
    room: str(v.room, 80),
    created: num(v.created) ?? deadline,
    deadline,
    questions,
    tool: kind === "permission" ? str(v.tool, 80) : null,
    summary: kind === "permission" ? str(v.summary, 300) : null,
    owner_only: v.owner_only === true,
    fallback,
  };
}

const requestFile = (id: string) => path.join(pendingDir(), `${id}.json`);
const answerFile = (id: string) => path.join(pendingDir(), `${id}.answer.json`);

function readRequest(id: string): Pending | null {
  try {
    const file = requestFile(id);
    if (fs.statSync(file).size > MAX_FILE) return null;
    return parsePending(fs.readFileSync(file, "utf8"), id);
  } catch {
    return null;
  }
}

/** Open requests (deadline in the future, not answered yet), soonest deadline first. */
export function listPending(now = Date.now()): Pending[] {
  let names: string[];
  try {
    names = fs.readdirSync(pendingDir());
  } catch {
    return [];
  }
  const answered = new Set(names.filter((n) => n.endsWith(".answer.json")).map((n) => n.slice(0, -".answer.json".length)));
  const out: Pending[] = [];
  for (const n of names.slice(0, 500)) {
    const id = REQUEST_FILE_RE.exec(n)?.[1];
    if (!id || answered.has(id)) continue;
    const p = readRequest(id);
    if (p && p.deadline > now) out.push(p);
  }
  return out.sort((a, b) => a.deadline - b.deadline);
}

export type AnswerResult = { ok: true; answer: Record<string, unknown> } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): AnswerResult => ({ ok: false, status, error });

/** Owner text going into a Claude tool input: trimmed, 1..500 chars, no control characters. */
function cleanAnswer(v: unknown, what: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof v !== "string") return { ok: false, error: `${what} must be a string` };
  const t = v.replace(/\r\n/g, "\n").trim();
  if (!t) return { ok: false, error: `${what} is empty` };
  if (Array.from(t).length > MAX_ANSWER) return { ok: false, error: `${what}: at most ${MAX_ANSWER} characters` };
  if (hasControlChars(t)) return { ok: false, error: `${what} must not contain control characters` };
  return { ok: true, value: t };
}

/**
 * Validates the owner's answer against the open request and writes `<id>.answer.json`
 * atomically (0600 tmp file in the same dir, then rename). Question: `{answers: {<question>:
 * <option label(s) or free text>}}` covering every question and nothing else. Permission:
 * `{allow: boolean}`. Optional `note` (≤ 500) for both.
 */
export function answerPending(id: unknown, body: Record<string, unknown>, now = Date.now()): AnswerResult {
  if (typeof id !== "string" || !PENDING_ID_RE.test(id)) return fail(422, "id must be 16 lowercase hex characters");
  const req = readRequest(id);
  if (!req) return fail(404, "no such request");
  if (req.deadline <= now) return fail(410, "request expired");
  if (fs.existsSync(answerFile(id))) return fail(409, "already answered");
  const answer: Record<string, unknown> = { v: 1 };
  if (req.kind === "question") {
    const a = body.answers;
    if (!a || typeof a !== "object" || Array.isArray(a) || "allow" in body) return fail(422, "answers must be an object {question: label}");
    const asked = new Set(req.questions.map((q) => q.question));
    const out: Record<string, string> = {};
    for (const [q, v] of Object.entries(a as Record<string, unknown>)) {
      if (!asked.has(q)) return fail(422, "answers: unknown question");
      const c = cleanAnswer(v, "answer");
      if (!c.ok) return fail(422, c.error);
      out[q] = c.value;
    }
    if (Object.keys(out).length !== asked.size) return fail(422, "answers: every question needs an answer");
    answer.answers = out;
  } else {
    if (typeof body.allow !== "boolean" || "answers" in body) return fail(422, "allow must be true or false");
    answer.allow = body.allow;
  }
  if (body.note != null && body.note !== "") {
    const c = cleanAnswer(body.note, "note");
    if (!c.ok) return fail(422, c.error);
    answer.note = c.value;
  }
  const dir = pendingDir();
  // Not `*.json`: the hook never mistakes a half-written tmp file for a request or an answer.
  const tmp = path.join(dir, `.${id}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(answer), { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, answerFile(id));
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return { ok: true, answer };
}
