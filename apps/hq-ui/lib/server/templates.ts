import fs from "node:fs";
import path from "node:path";
import { BUILT_IN_TEMPLATES, mergeTemplates, parseTemplate, type BotTemplate } from "@/lib/templates";
import { configDir } from "./paths";

/** The owner's own bot templates: one `<id>.json` each. Local only, never synced anywhere. */
export const templatesDir = () => path.join(configDir(), "templates");

/** A template file is a few hundred bytes; anything bigger is not one. */
const MAX_FILE_BYTES = 16 * 1024;
const MAX_FILES = 100;

/**
 * Every valid template file in `dir`, by file name. A broken file (bad JSON, a wrong field, too big,
 * unreadable) is skipped, never fatal: the sheet still shows the rest. Two files with one id: the first wins.
 */
export function readCustomTemplates(dir = templatesDir()): BotTemplate[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".json")).sort().slice(0, MAX_FILES);
  } catch {
    return [];
  }
  const out = new Map<string, BotTemplate>();
  for (const n of names) {
    const file = path.join(dir, n);
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const t = parseTemplate(JSON.parse(fs.readFileSync(file, "utf8")));
      if (t && !out.has(t.id)) out.set(t.id, t);
    } catch {
      // Not JSON or unreadable: skipped.
    }
  }
  return [...out.values()];
}

/** Built-in templates with the owner's on top (same id replaces), for GET /api/templates. */
export function allTemplates(dir = templatesDir()): BotTemplate[] {
  return mergeTemplates(BUILT_IN_TEMPLATES, readCustomTemplates(dir));
}
