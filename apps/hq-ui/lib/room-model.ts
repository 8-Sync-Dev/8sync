// Model + effort for one room, picked in the composer.
// omp rooms: HQ queues one control message (`/8sync-model {json}`) into the room's inbox; the
// `8sync-inbox` extension (assets/extensions/8sync-inbox.ts, same prefix) applies it with
// `pi.setModel` / `pi.setThinkingLevel` (this session only, config untouched) and writes what the
// session now runs to `<state>/omp-model/<id>.json`.
// Claude Code rooms: `/model <alias>` and `/effort <level>`, typed into the room's terminal.
// A new bot ("Bot mới") picks its model + level at start: `claude --model <id> --effort <level>`, or
// omp's `--model <provider>/<model>:<level>` (8sync ccc term --omp-new).
import { MODELS, modelShort } from "./roles";

/** One model the picker lists. `thinking`: the levels the model takes, without "off". */
export type ModelChoice = { selector: string; provider: string; name: string; thinking: string[] };

/** What an omp room runs now, as its extension last wrote it. */
export type RoomModel = { model: string | null; thinking: string | null; error: string | null; at: number };

/** `GET /api/models` */
export type ModelsReply = { engine: "omp" | "claude"; models: ModelChoice[]; efforts: string[]; current: RoomModel | null; apply: "inbox" | "terminal" | null };

export const MODEL_CONTROL = "/8sync-model";

/** omp's thinking selector (pi-agent-core ThinkingLevel, without "inherit"). */
export const OMP_THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** `claude --effort` / `/effort` (Claude Code 2.1). Claude Code's "ultracode" is a Claude-only setting; omp has none. */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** `/model` aliases: each tracks the latest model of its family. */
export const CLAUDE_MODELS: ModelChoice[] = [
  { selector: "opus", provider: "claude", name: "Opus (bản mới nhất)", thinking: [...CLAUDE_EFFORTS] },
  { selector: "sonnet", provider: "claude", name: "Sonnet (bản mới nhất)", thinking: [...CLAUDE_EFFORTS] },
  { selector: "haiku", provider: "claude", name: "Haiku (nhanh, rẻ)", thinking: [...CLAUDE_EFFORTS] },
  { selector: "opusplan", provider: "claude", name: "Opus lên plan, Sonnet làm", thinking: [...CLAUDE_EFFORTS] },
  { selector: "default", provider: "claude", name: "Mặc định của tài khoản", thinking: [...CLAUDE_EFFORTS] },
];

/** The models a new Claude Code bot starts on (`claude --model`): the pinned ids roles and templates use. */
export const CLAUDE_START_MODELS: ModelChoice[] = MODELS.map((id) => ({ selector: id, provider: "claude", name: modelShort(id), thinking: [...CLAUDE_EFFORTS] }));

/** omp's `--model` for a new session: the selector, with the thinking level as its `:` suffix. */
export const ompStartModel = (selector: string, thinking: string | null): string => (thinking ? `${selector}:${thinking}` : selector);

/** `<provider>/<model>`: no colon (omp reads `:` as the thinking suffix), no spaces. */
export const SELECTOR_RE = /^[A-Za-z0-9][\w.-]*\/[\w.@+/-]+$/;

export const isClaudeEffort = (s: unknown): s is string => typeof s === "string" && (CLAUDE_EFFORTS as readonly string[]).includes(s);

export const isThinking = (s: unknown): s is string => typeof s === "string" && (OMP_THINKING as readonly string[]).includes(s);

/** The control message an omp room's extension applies. */
export function ompControl(c: { model?: string | null; thinking?: string | null }): string {
  return `${MODEL_CONTROL} ${JSON.stringify({ ...(c.model ? { model: c.model } : {}), ...(c.thinking ? { thinking: c.thinking } : {}) })}`;
}

/** The slash commands that make a Claude Code session switch. */
export function claudeCommands(c: { model?: string | null; thinking?: string | null }): string[] {
  return [...(c.model ? [`/model ${c.model}`] : []), ...(c.thinking ? [`/effort ${c.thinking}`] : [])];
}

/** The levels the effort row offers for `m`: omp adds "off" in front; an unknown model gets every level. */
export function effortsFor(engine: "omp" | "claude", m: ModelChoice | undefined): string[] {
  if (engine === "claude") return [...CLAUDE_EFFORTS];
  if (!m) return [...OMP_THINKING];
  return ["off", ...m.thinking.filter((t) => t !== "off")];
}

/**
 * The list entry for a room's current model: an exact selector, else the same model id under any
 * provider (`8sync ls` gives the id alone), preferring `provider` when known.
 */
export function findChoice(models: ModelChoice[], current: string | null | undefined): ModelChoice | undefined {
  const raw = current?.trim();
  if (!raw) return undefined;
  const sel = raw.split(":")[0];
  const exact = models.find((m) => m.selector === sel);
  if (exact) return exact;
  const id = sel.slice(sel.lastIndexOf("/") + 1);
  return models.find((m) => m.selector.slice(m.selector.indexOf("/") + 1) === id);
}

/** Filter by every whitespace-separated word, in name or selector. */
export function filterModels(models: ModelChoice[], q: string): ModelChoice[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return models;
  return models.filter((m) => {
    const hay = `${m.selector} ${m.name}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Labels the owner can tell apart: a name two or more entries share gets "· <provider>"; when the provider
 * is shared too (dated ids, aliases) it gets "· <model id>" instead. Unique names stay as they are.
 */
export function distinctNames(models: ModelChoice[]): ModelChoice[] {
  const count = (key: (m: ModelChoice) => string) => {
    const n = new Map<string, number>();
    for (const m of models) n.set(key(m), (n.get(key(m)) ?? 0) + 1);
    return n;
  };
  const byName = count((m) => m.name);
  const byNameProvider = count((m) => `${m.name}\n${m.provider}`);
  return models.map((m) => {
    if ((byName.get(m.name) ?? 0) < 2) return m;
    const suffix = (byNameProvider.get(`${m.name}\n${m.provider}`) ?? 0) < 2 ? m.provider : m.selector.slice(m.selector.indexOf("/") + 1);
    return { ...m, name: `${m.name} · ${suffix}` };
  });
}
