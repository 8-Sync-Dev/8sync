// Bots: every live room (Claude Code or omp) as an always-on teammate the owner messages like a
// colleague, Grok Bot style. Pure rules behind components/hq/bots/*: status, order, avatar colour,
// names, one-line preview and the DM thread built from HQ's messages + the room's transcript turns.
// No React, no I/O. Tested in tests/bots.test.ts.
import { parseAttachments } from "./attachments";
import type { Ask } from "./ask";
import type { ProjectInfo } from "./office";
import { promptBody, type Turn } from "./room-turns";
import { stripContextLine } from "./room-context";
import type { ActivityEvent } from "./server/activity";

export const BOT_STATUSES = ["needs", "error", "working", "idle"] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export const BOT_STATUS_LABEL: Record<BotStatus, string> = {
  needs: "Chờ anh",
  error: "Lỗi",
  working: "Đang làm",
  idle: "Rảnh",
};

/** Attention order: a decision for the owner, then a stuck room, then work in progress, then the free ones. */
const RANK: Record<BotStatus, number> = { needs: 0, error: 1, working: 2, idle: 3 };

/** The office room fields a bot is drawn from (lib/server/office Room). */
export type BotRoom = {
  key: string;
  name: string;
  session_id: string | null;
  label: string;
  status: "running" | "idle" | "needs_input" | "ended";
  waiting: string | null;
  ask: Ask | null;
  cwd: string | null;
  project: ProjectInfo | null;
  doing: string | null;
  /** The desk state from `8sync ls` (lib/floor FloorState): "stalled" is a room stuck on an error. */
  state: string | null;
  last_active: number | null;
};

/** The HQ message fields the thread and the preview read (components/hq/types Message). */
export type BotMessage = { id: number; ts: number; session: string | null; kind: string; from_: string | null; to_: string | null; text: string | null };
/** The session fields used to tie messages to a room (components/hq/types Session). */
export type BotSession = { name: string; session_id: string | null };

export function botStatus(r: Pick<BotRoom, "status" | "waiting" | "state">): BotStatus {
  if (r.status === "needs_input" || r.waiting || r.state === "waiting") return "needs";
  if (r.state === "stalled") return "error";
  if (r.status === "running") return "working";
  return "idle";
}

/**
 * FNV-1a (32 bit) with murmur3's finalizer: the same room id always gives the same number, on every
 * machine and reload, and ids that differ in one character (omp-…) still land far apart on the wheel.
 */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A bot's soft colour, from its room id: one hue, a pastel face (light and dark theme) and a deep ink of
 * the same hue for the eyes. OKLCH keeps every hue at the same lightness, so no bot shouts.
 */
export function botColors(id: string): { hue: number; face: string; faceDark: string; ink: string } {
  const hue = hashId(id) % 360;
  return {
    hue,
    face: `oklch(0.86 0.08 ${hue})`,
    faceDark: `oklch(0.74 0.09 ${hue})`,
    ink: `oklch(0.27 0.05 ${hue})`,
  };
}

/** The project a room works in: its git repo, else its folder's name. */
export function botProject(r: Pick<BotRoom, "project" | "cwd">): string | null {
  return r.project?.name ?? (r.cwd ?? "").split(/[\\/]/).filter(Boolean).pop() ?? null;
}

/**
 * The name each bot goes by: its room label ("core", "learn"). Several rooms share a label (four `core`
 * rooms in four repos): each of those gets its project as a qualifier, and a short id when even that repeats.
 */
export function botNames(rooms: readonly Pick<BotRoom, "key" | "label" | "project" | "cwd">[]): Map<string, { name: string; qualifier: string | null }> {
  const count = (k: string, m: Map<string, number>) => m.set(k, (m.get(k) ?? 0) + 1);
  const byLabel = new Map<string, number>();
  for (const r of rooms) count(r.label.toLowerCase(), byLabel);
  const byPair = new Map<string, number>();
  for (const r of rooms) count(`${r.label.toLowerCase()}\n${(botProject(r) ?? "").toLowerCase()}`, byPair);
  const out = new Map<string, { name: string; qualifier: string | null }>();
  for (const r of rooms) {
    if ((byLabel.get(r.label.toLowerCase()) ?? 0) < 2) {
      out.set(r.key, { name: r.label, qualifier: null });
      continue;
    }
    const project = botProject(r);
    const twice = (byPair.get(`${r.label.toLowerCase()}\n${(project ?? "").toLowerCase()}`) ?? 0) > 1;
    const id = r.key.replace(/^omp-/, "").slice(0, 4);
    out.set(r.key, { name: r.label, qualifier: [project, twice ? `#${id}` : null].filter(Boolean).join(" ") || `#${id}` });
  }
  return out;
}

/** One line, markdown marks and runs of space folded, cut at `max`. */
export function oneLine(s: string, max = 140): string {
  const t = s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[ \t]*(?:#{1,6}|>)[ \t]*/gm, "")
    .replace(/`|\*\*|__/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** What a waiting room asks, in one line: its first question, or the tool it wants permission for. */
export function askLine(ask: Ask | null): string | null {
  if (!ask) return null;
  if (ask.kind === "question") return ask.questions[0]?.question ? oneLine(ask.questions[0].question) : null;
  return `Xin quyền ${ask.tool}${ask.what ? `: ${oneLine(ask.what, 100)}` : ""}`;
}

/** Every name a room's messages may carry: its own, its Claude session id, its HQ session's. */
export function botKeys(r: Pick<BotRoom, "name" | "session_id">, sessions: readonly BotSession[]): Set<string> {
  const keys = new Set<string>([r.name, r.session_id].filter((x): x is string => !!x));
  for (const s of sessions) if (s.name === r.name || (r.session_id != null && s.session_id === r.session_id)) for (const k of [s.name, s.session_id]) if (k) keys.add(k);
  return keys;
}

/** The room's own messages (to it, from it, about it), oldest first. */
export function botMessages<M extends BotMessage>(r: Pick<BotRoom, "name" | "session_id">, sessions: readonly BotSession[], messages: readonly M[]): M[] {
  const keys = botKeys(r, sessions);
  return messages.filter((m) => [m.session, m.from_, m.to_].some((x) => x != null && keys.has(x))).sort((a, b) => a.ts - b.ts || a.id - b.id);
}

const CHAT: Record<string, true> = { owner_message: true, session_reply: true, session_message: true };

/** A message as one preview line: the owner's own words are prefixed "Anh: ", HQ's frame and file list dropped. */
export function messageLine(m: Pick<BotMessage, "kind" | "text">): string | null {
  if (!CHAT[m.kind] || !m.text) return null;
  const body = oneLine(promptBody(parseAttachments(m.text).body));
  if (!body) return null;
  return m.kind === "owner_message" && messageSender(m.text).from.kind === "owner" ? `Anh: ${body}` : body;
}

/**
 * The list row's second line and its time: what it asks while it waits for the owner, else what it is
 * doing (`8sync ls`) or the newest chat line, whichever is newer.
 */
export function botPreview(r: Pick<BotRoom, "status" | "waiting" | "state" | "ask" | "doing" | "last_active">, messages: readonly BotMessage[]): { text: string; at: number | null } {
  const status = botStatus(r);
  let last: { text: string; at: number } | null = null;
  for (let i = messages.length - 1; i >= 0 && !last; i--) {
    const line = messageLine(messages[i]);
    if (line) last = { text: line, at: messages[i].ts };
  }
  const doing = r.doing ? { text: oneLine(r.doing), at: r.last_active } : null;
  const at = Math.max(r.last_active ?? 0, last?.at ?? 0) || null;
  if (status === "needs") return { text: askLine(r.ask) ?? (r.waiting ? oneLine(r.waiting) : "Đang chờ anh trả lời"), at };
  if (status === "working" && doing) return doing;
  if (doing && last) return (doing.at ?? 0) >= last.at ? doing : last;
  return doing ?? last ?? { text: "Chưa có hoạt động nào", at };
}

export type Bot<R extends BotRoom = BotRoom> = {
  key: string;
  room: R;
  name: string;
  qualifier: string | null;
  status: BotStatus;
  project: string | null;
  branch: string | null;
  preview: string;
  at: number | null;
};

/** Live rooms as bots, in attention order: Chờ anh, Lỗi, Đang làm, Rảnh; the newest first inside each. */
export function botList<R extends BotRoom>(rooms: readonly R[], sessions: readonly BotSession[], messages: readonly BotMessage[]): Bot<R>[] {
  const live = rooms.filter((r) => r.status !== "ended");
  const names = botNames(live);
  return live
    .map((r) => {
      const p = botPreview(r, botMessages(r, sessions, messages));
      const n = names.get(r.key)!;
      return { key: r.key, room: r, name: n.name, qualifier: n.qualifier, status: botStatus(r), project: botProject(r), branch: r.project?.branch ?? null, preview: p.text, at: p.at };
    })
    .sort((a, b) => RANK[a.status] - RANK[b.status] || (b.at ?? 0) - (a.at ?? 0) || a.name.localeCompare(b.name));
}

/**
 * The Chief of Staff (GET /api/chief `cfg.room`, only while `cfg.on && live`) as the first row; the
 * rest keep their order. `chief` is its bot key, null when the chief is off or its room is not a bot.
 */
export function pinChief<B extends Pick<Bot, "key" | "room">>(bots: readonly B[], room: string | null): { bots: B[]; chief: string | null } {
  const i = room == null ? -1 : bots.findIndex((b) => b.key === room || b.room.name === room || b.room.session_id === room);
  if (i < 0) return { bots: [...bots], chief: null };
  return { bots: [bots[i], ...bots.slice(0, i), ...bots.slice(i + 1)], chief: bots[i].key };
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

export type BotFilter = "all" | BotStatus;

/** The search box (accents optional: "cho anh" finds "Chờ anh") and the status filter. */
export function filterBots<B extends Pick<Bot, "name" | "qualifier" | "project" | "branch" | "preview" | "status">>(bots: readonly B[], query: string, filter: BotFilter = "all"): B[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return bots.filter((b) => {
    if (filter !== "all" && b.status !== filter) return false;
    if (!words.length) return true;
    const hay = fold([b.name, b.qualifier, b.project, b.branch, b.preview, BOT_STATUS_LABEL[b.status]].filter(Boolean).join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/** Bots per status, for the filter chips. */
export function botCounts(bots: readonly Pick<Bot, "status">[]): Record<BotStatus, number> {
  const out: Record<BotStatus, number> = { needs: 0, error: 0, working: 0, idle: 0 };
  for (const b of bots) out[b.status]++;
  return out;
}

/** "2 chờ anh · 3 đang làm · 1 rảnh" (only states that occur, attention order). */
export function botSummary(bots: readonly Pick<Bot, "status">[]): string {
  const n = botCounts(bots);
  return BOT_STATUSES.filter((s) => n[s] > 0)
    .map((s) => `${n[s]} ${BOT_STATUS_LABEL[s].toLowerCase()}`)
    .join(" · ");
}

/** ↑/↓ in the list: the next key (clamped at the ends); the first one when nothing is selected. */
export function stepKey(keys: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (!keys.length) return null;
  const i = current == null ? -1 : keys.indexOf(current);
  if (i < 0) return dir === 1 ? keys[0] : keys[keys.length - 1];
  return keys[Math.min(keys.length - 1, Math.max(0, i + dir))];
}

// ---- The DM thread ----

export type PromptSender = { kind: "owner" } | { kind: "auto" } | { kind: "room"; name: string };

/** Who wrote a transcript prompt, from HQ's frame: another room (bots talking), HQ's automation, else the owner. */
export function promptSender(prompt: string): PromptSender {
  const room = /^\[phòng ([^\]\n]+?)(?: → [^\]\n]+)?\]/.exec(prompt);
  if (room) return { kind: "room", name: room[1].trim() };
  if (/^\[tự động(?: → [^\]\n]+)?\]/.test(prompt)) return { kind: "auto" };
  return { kind: "owner" };
}

/**
 * The tool calls and subagents of each turn, keyed like lib/room-turns `turnsFrom` keys its turns
 * (a prompt starts a turn; events before the first prompt form a head turn). Only the transcript tail
 * the log carries: an older turn may show fewer steps than its count.
 */
export function stepsByTurn(events: readonly ActivityEvent[]): Map<string, ActivityEvent[]> {
  const out = new Map<string, ActivityEvent[]>();
  let key: string | null = null;
  for (const ev of events) {
    if (ev.kind === "prompt" || key == null) {
      key = ev.kind === "prompt" ? `${ev.at ?? 0}:${ev.text.length}` : `head:${ev.at ?? 0}`;
      if (!out.has(key)) out.set(key, []);
      if (ev.kind === "prompt") continue;
    }
    if (ev.kind === "tool" || ev.kind === "agent") out.get(key)!.push(ev);
  }
  return out;
}

export type ThreadItem<M extends BotMessage = BotMessage> =
  | {
      kind: "turn";
      key: string;
      at: number;
      turn: Turn;
      /** The owner's HQ message that started it (with its files and delivery), when one matches. */
      sent: M | null;
      /** Its prompt as the sender wrote it (HQ frame dropped), when no HQ message stands for it. */
      prompt: string | null;
      from: PromptSender | null;
      steps: ActivityEvent[];
    }
  | {
      kind: "message";
      key: string;
      at: number;
      m: M;
      /** Who wrote an HQ `owner_message` row (its source line): a room's lands on the left, never as the owner's. */
      from: PromptSender | null;
      /** That row's words without its source and context lines, when it is not the owner's. */
      body: string | null;
    };

/**
 * Who an `owner_message` row is from, read from its FIRST line only (the source line HQ puts there:
 * lib/sender.ts `[phòng web]`, the same line the ship grant and `[owner]` detection read), and its words
 * below it with a room's `[từ phòng …]` context line dropped. The owner's own rows carry no source line.
 */
export function messageSender(text: string | null): { from: PromptSender; body: string | null } {
  const t = text ?? "";
  const nl = t.indexOf("\n");
  const from = promptSender(nl < 0 ? t : t.slice(0, nl));
  if (from.kind === "owner") return { from, body: null };
  return { from, body: stripContextLine(nl < 0 ? "" : t.slice(nl + 1)).trim() };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const SLACK_MS = 60_000;
const PICKUP_MS = 30 * 60_000;

/** The turn an owner message started (same rule as lib/room-turns `turnForMessage`), among the turns not yet claimed. */
function turnOf(turns: readonly Turn[], m: BotMessage, taken: Set<string>): Turn | null {
  if (!m.text) return null;
  const text = promptBody(parseAttachments(m.text).body);
  const cmd = /^\/[\w:.-]+\s+([\s\S]+)$/.exec(text);
  const needle = norm(cmd ? cmd[1] : text).slice(0, 80);
  if (!needle) return null;
  return turns.find((t) => !taken.has(t.key) && t.prompt != null && (t.at == null || (t.at >= m.ts - SLACK_MS && t.at <= m.ts + PICKUP_MS)) && norm(t.prompt).includes(needle)) ?? null;
}

/**
 * One conversation per bot, oldest first: each transcript turn (what was asked, its steps folded, what
 * the bot answered), the owner's HQ messages folded into the turn they started (or on their own while the
 * room has not picked them up), a channel reply only when no turn already shows the same answer, and
 * the room's start/stop/notification events.
 */
export function threadItems<M extends BotMessage>(messages: readonly M[], turns: readonly Turn[], events: readonly ActivityEvent[]): ThreadItem<M>[] {
  const steps = stepsByTurn(events);
  const taken = new Set<string>();
  const sentBy = new Map<string, M>();
  const byOther = new Map<string, { from: PromptSender; body: string | null }>();
  const out: ThreadItem<M>[] = [];
  const outputs = turns.map((t) => (t.output ? norm(t.output) : "")).filter(Boolean);
  for (const m of messages) {
    const who = m.kind === "owner_message" ? messageSender(m.text) : null;
    if (m.kind === "owner_message") {
      const t = turnOf(turns, m, taken);
      if (t) {
        taken.add(t.key);
        if (who?.from.kind === "owner") sentBy.set(t.key, m);
        else if (who) byOther.set(t.key, who);
        continue;
      }
    }
    if (m.kind === "session_reply" && m.text) {
      const head = norm(m.text).slice(0, 60);
      if (head && outputs.some((o) => o.startsWith(head) || head.startsWith(o.slice(0, 60)))) continue;
    }
    out.push({ kind: "message", key: `m${m.id}`, at: m.ts, m, from: who?.from ?? null, body: who?.body ?? null });
  }
  for (const t of turns) {
    const sent = sentBy.get(t.key) ?? null;
    const other = byOther.get(t.key);
    out.push({
      kind: "turn",
      key: `t${t.key}`,
      at: t.at ?? sent?.ts ?? t.outputAt ?? 0,
      turn: t,
      sent,
      prompt: sent ? null : (other?.body ?? (t.prompt == null ? null : promptBody(t.prompt))),
      from: other?.from ?? (t.prompt == null ? null : promptSender(t.prompt)),
      steps: steps.get(t.key) ?? [],
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

const EDIT_TOOLS: Record<string, true> = { edit: true, write: true, multiedit: true, notebookedit: true, ast_edit: true };
const PATHISH = /^(?:[a-z]:)?[\w.@~-]*(?:[\\/][\w.@ -]+)*\.[\w]{1,8}$/i;

/** Files the room wrote lately (its Edit/Write steps), newest first, each once. */
export function recentFiles(events: readonly ActivityEvent[], max = 6): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < max; i--) {
    const e = events[i];
    if (e.kind !== "tool" || !e.tool || !EDIT_TOOLS[e.tool.toLowerCase()] || e.status === "error") continue;
    const p = e.text.trim();
    if (PATHISH.test(p) && !out.includes(p)) out.push(p);
  }
  return out;
}
