// Slash commands for the composer's "/" autocomplete (GET /api/commands): the owner's omp commands
// (`~/.omp/agent/commands/*.md`) and Claude Code commands (`~/.claude/commands/*.md`). The name is the
// file name; the description comes from the frontmatter (else the first line of the body). Names and
// descriptions only, never the command bodies. Tested in tests/commands.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SlashCommand } from "../mention";

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

/** omp's commands first, then Claude Code's. */
export function listCommands(home = os.homedir()): SlashCommand[] {
  return [...readCommands(path.join(home, ".omp", "agent", "commands"), "omp"), ...readCommands(path.join(home, ".claude", "commands"), "claude")];
}

const TTL_MS = 30_000;
let cache: { at: number; home: string; v: SlashCommand[] } | null = null;

/** [listCommands], read again at most every 30 s. */
export function cachedCommands(home = os.homedir(), now = Date.now()): SlashCommand[] {
  if (!cache || cache.home !== home || now - cache.at > TTL_MS) cache = { at: now, home, v: listCommands(home) };
  return cache.v;
}
