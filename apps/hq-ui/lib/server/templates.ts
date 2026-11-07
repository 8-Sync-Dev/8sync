import fs from "node:fs";
import path from "node:path";
import { BUILT_IN_TEMPLATES, checkTemplate, mergeTemplates, parseTemplate, type BotTemplate } from "@/lib/templates";
import { configDir } from "./paths";

/** The owner's own bot templates: one `<id>.json` each. Local only, never synced anywhere. */
export const templatesDir = () => path.join(configDir(), "templates");

/** A template file is a few hundred bytes; anything bigger is not one. */
const MAX_FILE_BYTES = 16 * 1024;
export const MAX_TEMPLATE_FILES = 100;
const ID_MAX = 32;

const jsonNames = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".json")).sort();
  } catch {
    return [];
  }
};

/**
 * Every valid template file in `dir` with its file. A broken file (bad JSON, a wrong field, too big,
 * unreadable) is skipped, never fatal: the sheet still shows the rest. Two files with one id: the first wins.
 */
function scan(dir: string): Map<string, { file: string; template: BotTemplate }> {
  const out = new Map<string, { file: string; template: BotTemplate }>();
  for (const n of jsonNames(dir).slice(0, MAX_TEMPLATE_FILES)) {
    const file = path.join(dir, n);
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const t = parseTemplate(JSON.parse(fs.readFileSync(file, "utf8")));
      if (t && !out.has(t.id)) out.set(t.id, { file, template: t });
    } catch {
      // Not JSON or unreadable: skipped.
    }
  }
  return out;
}

export function readCustomTemplates(dir = templatesDir()): BotTemplate[] {
  return [...scan(dir).values()].map((v) => v.template);
}

/** Built-in templates with the owner's on top (same id replaces), for GET /api/templates. */
export function allTemplates(dir = templatesDir()): BotTemplate[] {
  return mergeTemplates(BUILT_IN_TEMPLATES, readCustomTemplates(dir));
}

export type SaveResult = { ok: true; template: BotTemplate } | { ok: false; status: number; error: string };

/** Temp file + rename: a reader sees the old file or the new one, never half of one. */
function writeFile(file: string, t: BotTemplate): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    // `builtIn: undefined` drops the flag: a file is never a built-in.
    fs.writeFileSync(tmp, `${JSON.stringify({ ...t, builtIn: undefined }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** `id`, else `id-2`, `id-3`… (≤32 chars) not in `taken`. */
export function freeId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n++) {
    const tail = `-${n}`;
    const next = `${id.slice(0, ID_MAX - tail.length).replace(/-+$/, "")}${tail}`;
    if (!taken.has(next)) return next;
  }
}

/**
 * A new template file. Its id never takes a built-in's, another template's or any file's name (a broken
 * file is left alone): `-2`, `-3`… is appended, so a copy of "reviewer" becomes "reviewer-2", the owner's.
 */
export function createTemplate(raw: unknown, dir = templatesDir()): SaveResult {
  const r = checkTemplate(raw);
  if (!r.ok) return { ok: false, status: 422, error: r.error };
  const names = jsonNames(dir);
  if (names.length >= MAX_TEMPLATE_FILES) return { ok: false, status: 409, error: `Đã có ${MAX_TEMPLATE_FILES} mẫu riêng, xoá bớt trước.` };
  const taken = new Set([...BUILT_IN_TEMPLATES.map((t) => t.id), ...scan(dir).keys(), ...names.map((n) => n.slice(0, -5).toLowerCase())]);
  const template = { ...r.template, id: freeId(r.template.id, taken) };
  writeFile(path.join(dir, `${template.id}.json`), template);
  return { ok: true, template };
}

/** The owner's template `id`, replaced in its own file (the id stays). A built-in one is copied, not edited. */
export function updateTemplate(id: string, raw: unknown, dir = templatesDir()): SaveResult {
  const cur = scan(dir).get(id);
  if (!cur) return { ok: false, status: 404, error: "Không có mẫu riêng này (mẫu có sẵn thì Nhân bản rồi sửa)." };
  const r = checkTemplate(raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw, id } : raw);
  if (!r.ok) return { ok: false, status: 422, error: r.error };
  writeFile(cur.file, r.template);
  return { ok: true, template: r.template };
}

/** Deletes the owner's template `id` (its file). */
export function deleteTemplate(id: string, dir = templatesDir()): boolean {
  const cur = scan(dir).get(id);
  if (!cur) return false;
  fs.rmSync(cur.file, { force: true });
  return true;
}
