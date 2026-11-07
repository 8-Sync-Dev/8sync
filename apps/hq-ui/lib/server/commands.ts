// Slash commands for the composer's "/" autocomplete (GET /api/commands), first name wins:
// omp's built-ins (/model, /settings, /compact: lib/server/omp-builtins.ts), the owner's omp commands
// (`~/.omp/agent/commands/*.md`, where 8sync also deploys /solo, /autopilot, /ship-*), what a running
// omp reports through the 8sync-inbox extension (`<state>/omp-commands.json`: `/skill:<name>`, plugin,
// MCP-prompt and extension commands), then Claude Code commands (`~/.claude/commands/*.md`) and the
// skills Claude Code also runs as `/name` (`~/.claude/skills/<name>/SKILL.md`, e.g. /solo, /ship-loop;
// `user-invocable: false` hides one from Claude Code's "/" list, so here too). The name is the file or
// folder name; the description comes from the frontmatter (else the first line of the body). Names and
// descriptions only, never the command bodies. Tested in tests/commands.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SlashCommand } from "../mention";
import { OMP_BUILTINS } from "./omp-builtins";

const DESC_MAX = 160;
const PER_SOURCE_MAX = 300;
const NAME_RE = /^[A-Za-z0-9][\w.:-]{0,63}$/;

/** `description:` of a markdown file's `---` frontmatter (quotes dropped), else its first prose line. */
export function commandDescription(text: string): string {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let body = src;
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(src);
  if (fm) {
    body = src.slice(fm[0].length);
    const line = fm[1].split("\n").find((l) => /^description\s*:/.test(l));
    const v = line?.replace(/^description\s*:\s*/, "").trim().replace(/^(['"])(.*)\1$/, "$2").trim();
    if (v && v !== "|" && v !== ">") return v.slice(0, DESC_MAX);
  }
  const first = body.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l.length > 0) ?? "";
  return first.slice(0, DESC_MAX);
}

/** The `*.md` commands in `dir`, sorted by name; a missing folder is none. */
export function readCommands(dir: string, source: SlashCommand["source"]): SlashCommand[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: SlashCommand[] = [];
  for (const f of names) {
    if (!f.endsWith(".md")) continue;
    const name = f.slice(0, -3);
    if (!NAME_RE.test(name)) continue;
    let text: string;
    try {
      const p = path.join(dir, f);
      if (!fs.statSync(p).isFile()) continue;
      text = fs.readFileSync(p, "utf8").slice(0, 8192);
    } catch {
      continue;
    }
    out.push({ name, description: commandDescription(text), source });
    if (out.length >= PER_SOURCE_MAX) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The skills in `dir` (`<name>/SKILL.md`) Claude Code offers as `/name`, sorted; a missing folder is none. */
export function readSkills(dir: string): SlashCommand[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: SlashCommand[] = [];
  for (const name of names) {
    if (!NAME_RE.test(name)) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, name, "SKILL.md"), "utf8").slice(0, 8192);
    } catch {
      continue;
    }
    const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (fm && /^user-invocable\s*:\s*false\s*$/m.test(fm[1])) continue;
    out.push({ name, description: commandDescription(text), source: "claude" });
    if (out.length >= PER_SOURCE_MAX) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The commands a running omp reported (`{"commands":[{"name","description"}]}`, written by the
 * 8sync-inbox extension at session start); a missing or broken file is none.
 */
export function readOmpSession(file: string): SlashCommand[] {
  let v: unknown;
  try {
    v = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const list = v !== null && typeof v === "object" && "commands" in v && Array.isArray(v.commands) ? (v.commands as unknown[]) : [];
  const out: SlashCommand[] = [];
  for (const c of list) {
    if (c === null || typeof c !== "object" || !("name" in c) || typeof c.name !== "string" || !NAME_RE.test(c.name)) continue;
    const d = "description" in c && typeof c.description === "string" ? c.description.replace(/\s+/g, " ").trim().slice(0, DESC_MAX) : "";
    out.push({ name: c.name, description: d, source: "omp" });
    if (out.length >= PER_SOURCE_MAX * 2) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** omp's built-ins, its command files, the live session's list, then Claude Code's commands and skills; first name wins. */
export function listCommands(home = os.homedir()): SlashCommand[] {
  const all: SlashCommand[] = [
    ...OMP_BUILTINS.map(([name, description]): SlashCommand => ({ name, description, source: "omp" })),
    ...readCommands(path.join(home, ".omp", "agent", "commands"), "omp"),
    ...readOmpSession(path.join(home, ".local", "state", "8sync", "hq", "omp-commands.json")),
    ...readCommands(path.join(home, ".claude", "commands"), "claude"),
    ...readSkills(path.join(home, ".claude", "skills")),
  ];
  const seen = new Set<string>();
  return all.filter((c) => !seen.has(c.name) && (seen.add(c.name), true));
}

const TTL_MS = 30_000;
let cache: { at: number; home: string; v: SlashCommand[] } | null = null;

/** [listCommands], read again at most every 30 s. */
export function cachedCommands(home = os.homedir(), now = Date.now()): SlashCommand[] {
  if (!cache || cache.home !== home || now - cache.at > TTL_MS) cache = { at: now, home, v: listCommands(home) };
  return cache.v;
}
