// Bot groups: a named set of rooms the owner messages together (components/hq/bots/group-thread.tsx).
// Local-first: the setting is ~/.config/8sync/hq/groups.json (atomic tmp + rename, like chief.json),
// each group's thread an append-only ~/.local/state/8sync/hq/groups/<id>.jsonl. Nothing leaves the machine.
//
// Who answers: in "mention" mode only the bots the owner @-names get the message; a message naming nobody
// is only logged. In "chief" mode it goes to the Chief of Staff (lib/server/chief.ts), which picks bots.
//
// Loop guard (`GroupGuard`): every owner message to a group starts a turn. A room that got a message of a
// turn carries it: what it then sends another room (POST /api/messages, a room sender) counts against the
// turn: at most `maxBotMsgsPerTurn` bot→bot messages and `maxHops` deep, the same text from the same room
// within 60 s dropped. Past a limit the send answers 409 `hop-limit` until the owner continues the turn.
// Room traffic outside any group turn (a room's own `hq.mjs send`, the Chief of Staff's routing) is not
// touched. A bot message is never the owner's: it opens no merge/release (lib/sender.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isRoomId } from "./chief";
import { configDir, stateDir } from "./paths";

export const GROUP_MODES = ["mention", "chief"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

export type Group = {
  id: string;
  name: string;
  emoji: string | null;
  /** Room addresses (what /api/messages takes). A room that ended stays a member, shown asleep. */
  members: string[];
  mode: GroupMode;
  maxHops: number;
  maxBotMsgsPerTurn: number;
  maxParallel: number;
  createdAt: string;
};

export const GROUPS_MAX = 30;
/** What the owner's group message may hold: the Chief of Staff takes 2 500 and HQ adds the group line. */
export const GROUP_TEXT_MAX = 2400;
export const GROUP_NAME_MAX = 48;
export const GROUP_MEMBERS_MAX = 12;
const EMOJI_MAX = 8;
const LIMITS = {
  maxHops: { def: 3, min: 1, max: 10 },
  maxBotMsgsPerTurn: { def: 6, min: 1, max: 30 },
  maxParallel: { def: 3, min: 1, max: 6 },
} as const;
const ID = /^g_[a-z0-9_-]{1,40}$/;

export const groupsFile = () => path.join(configDir(), "groups.json");
export const groupLogFile = (id: string, dir = stateDir()) => path.join(dir, "groups", `${id}.jsonl`);
export const isGroupId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
export const newGroupId = () => `g_${crypto.randomBytes(5).toString("hex")}`;

type Norm<T> = { ok: true; value: T } | { ok: false; error: string };

const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();

function limit(r: Record<string, unknown>, key: keyof typeof LIMITS, base: number | undefined): Norm<number> {
  const l = LIMITS[key];
  if (!(key in r)) return { ok: true, value: base ?? l.def };
  const v = r[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < l.min || v > l.max) return { ok: false, error: `${key}: số nguyên ${l.min}–${l.max}` };
  return { ok: true, value: v };
}

/**
 * One group from a PUT body over the stored one (`base`, null for a new group): fields left out keep
 * their value. `live` resolves a room id (address or session id) to the address of a live room, null when
 * no live room has it. A member already in `base` may have ended and stays; a new one must be live.
 */
export function normGroup(v: unknown, base: Group | null, live: (id: string) => string | null, now = new Date()): Norm<Group> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "Cần JSON {name, members, mode?, emoji?}" };
  const r = v as Record<string, unknown>;
  const name = "name" in r ? (typeof r.name === "string" ? oneLine(r.name) : "") : (base?.name ?? "");
  if (!name) return { ok: false, error: "name: cần tên nhóm" };
  if ([...name].length > GROUP_NAME_MAX) return { ok: false, error: `name: tối đa ${GROUP_NAME_MAX} ký tự` };
  let emoji = base?.emoji ?? null;
  if ("emoji" in r) {
    if (r.emoji !== null && (typeof r.emoji !== "string" || /\s/.test(r.emoji) || [...r.emoji].length > EMOJI_MAX)) return { ok: false, error: "emoji: một emoji hoặc null" };
    emoji = (r.emoji as string | null) || null;
  }
  let mode = base?.mode ?? "mention";
  if ("mode" in r) {
    if (!(GROUP_MODES as readonly unknown[]).includes(r.mode)) return { ok: false, error: `mode: ${GROUP_MODES.join(" | ")}` };
    mode = r.mode as GroupMode;
  }
  let members = base?.members ?? [];
  if ("members" in r) {
    if (!Array.isArray(r.members) || !r.members.every(isRoomId)) return { ok: false, error: "members: danh sách id phòng" };
    const out: string[] = [];
    for (const m of r.members as string[]) {
      const id = base?.members.includes(m) ? m : live(m);
      if (!id) return { ok: false, error: `members: ${m} không phải phòng đang mở` };
      if (!out.includes(id)) out.push(id);
    }
    members = out;
  }
  if (members.length === 0) return { ok: false, error: "members: chọn ít nhất một bot" };
  if (members.length > GROUP_MEMBERS_MAX) return { ok: false, error: `members: tối đa ${GROUP_MEMBERS_MAX} bot` };
  const hops = limit(r, "maxHops", base?.maxHops);
  if (!hops.ok) return hops;
  const msgs = limit(r, "maxBotMsgsPerTurn", base?.maxBotMsgsPerTurn);
  if (!msgs.ok) return msgs;
  const par = limit(r, "maxParallel", base?.maxParallel);
  if (!par.ok) return par;
  return {
    ok: true,
    value: { id: base?.id ?? newGroupId(), name, emoji, members, mode, maxHops: hops.value, maxBotMsgsPerTurn: msgs.value, maxParallel: par.value, createdAt: base?.createdAt ?? now.toISOString() },
  };
}

/** A stored group as read back: anything malformed is dropped (a hand-edited file never breaks the list). */
function storedGroup(v: unknown): Group | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (!isGroupId(r.id) || !Array.isArray(r.members) || !r.members.every(isRoomId)) return null;
  const n = normGroup(r, { id: r.id, name: "", emoji: null, members: r.members as string[], mode: "mention", maxHops: 3, maxBotMsgsPerTurn: 6, maxParallel: 3, createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString() }, () => null);
  return n.ok ? n.value : null;
}

/** The groups on file; a missing or broken file is no groups. */
export function readGroups(file = groupsFile()): Group[] {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as { groups?: unknown };
    if (!Array.isArray(v?.groups)) return [];
    const seen = new Set<string>();
    const out: Group[] = [];
    for (const g of v.groups) {
      const s = storedGroup(g);
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }
    return out.slice(0, GROUPS_MAX);
  } catch {
    return [];
  }
}

export function writeGroups(groups: readonly Group[], file = groupsFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ groups }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** `g` in place of the stored group with its id, or added; 422 past GROUPS_MAX. */
export function upsertGroup(groups: readonly Group[], g: Group): Norm<Group[]> {
  const i = groups.findIndex((x) => x.id === g.id);
  if (i >= 0) return { ok: true, value: groups.map((x, j) => (j === i ? g : x)) };
  if (groups.length >= GROUPS_MAX) return { ok: false, error: `Tối đa ${GROUPS_MAX} nhóm` };
  return { ok: true, value: [...groups, g] };
}

// ---- The group's thread ----

export type GroupLogKind = "owner" | "room" | "held" | "dropped" | "note";
export type GroupLogEntry = {
  /** Line number in the log (1-based): `GET …/log?after=` pages by it. */
  n: number;
  ts: number;
  turn: string;
  kind: GroupLogKind;
  /** "owner" or the sending room's address. */
  from: string;
  to: string[];
  text: string;
  hop: number;
};

export function appendGroupLog(id: string, e: Omit<GroupLogEntry, "n">, dir = stateDir()): void {
  const file = groupLogFile(id, dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(e)}\n`);
}

/** Entries after line `after`, the newest `limit` of them; unreadable lines are skipped (they keep their number). */
export function readGroupLog(id: string, after = 0, limit = 200, dir = stateDir()): GroupLogEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(groupLogFile(id, dir), "utf8");
  } catch {
    return [];
  }
  const out: GroupLogEntry[] = [];
  raw.split("\n").forEach((line, i) => {
    if (i + 1 <= after || !line.trim()) return;
    try {
      const v = JSON.parse(line) as Omit<GroupLogEntry, "n">;
      if (typeof v.ts === "number" && typeof v.text === "string") out.push({ ...v, n: i + 1, to: Array.isArray(v.to) ? v.to : [] });
    } catch {
      /* a torn line: skipped */
    }
  });
  return out.slice(-limit);
}

export function removeGroupLog(id: string, dir = stateDir()): void {
  fs.rmSync(groupLogFile(id, dir), { force: true });
}

/** The line a group's message carries so the room knows where it is in the turn: `[nhóm Nội dung · hop 1/3]`. */
export function hopLine(name: string, hop: number, max: number): string {
  return `[nhóm ${oneLine(name).replace(/[[\]·]/g, " ").replace(/\s+/g, " ")} · hop ${hop}/${max}]`;
}

const HOP = /\[nhóm [^\]\n]* · hop (\d{1,3})\/(\d{1,3})\]/;
/** The hop line a room copied into its message, when there is one. */
export function readHopLine(text: string): { hop: number; max: number } | null {
  const m = HOP.exec(text);
  return m ? { hop: Number(m[1]), max: Number(m[2]) } : null;
}

/** The owner's group message as a member gets it: the owner's words first (a `/command` stays first), the group line under them. */
export function ownerGroupText(text: string, g: Pick<Group, "name" | "maxHops">): string {
  return `${text}\n\n${hopLine(g.name, 0, g.maxHops)} trả lời owner ngay trong phòng này; nhắn bot khác bằng hq.mjs send sẽ tính hop.`;
}

/** A room's message inside a group turn: its context line (when HQ added one) stays first, the hop line goes under it. */
export function roomGroupText(text: string, name: string, hop: number, max: number): string {
  const line = hopLine(name, hop, max);
  const clean = text.replace(HOP, "").replace(/\n{3,}/g, "\n\n");
  if (clean.startsWith("[từ phòng ")) {
    const nl = clean.indexOf("\n");
    return nl < 0 ? `${clean}\n${line}` : `${clean.slice(0, nl)}\n${line}\n${clean.slice(nl + 1)}`;
  }
  return `${line}\n${clean}`;
}

// ---- Loop guard ----

export const DUP_MS = 60_000;
/** A turn nobody touched for this long is over: its rooms send freely again. */
export const TURN_IDLE_MS = 30 * 60_000;
/** Outside group turns, one room may send another this many messages per `PAIR_WINDOW_MS` (room→room ping-pong). */
export const PAIR_MAX = 12;
export const PAIR_WINDOW_MS = 10 * 60_000;

export type PairCheck = { kind: "ok" } | { kind: "duplicate" } | { kind: "pair-limit"; count: number; max: number };

type Turn = { id: string; group: string; name: string; maxMsgs: number; hopCap: number; botMsgs: number; held: { hop: number; at: number } | null; lastAt: number };

export type GuardCheck =
  /** Not part of any group turn: send as today. */
  | { kind: "free" }
  | { kind: "ok"; turn: string; group: string; name: string; hop: number; hopCap: number }
  | { kind: "duplicate"; turn: string; group: string }
  | { kind: "hop-limit"; turn: string | null; group: string | null; hop: number; max: number; botMsgs: number; maxMsgs: number };

export type HeldTurn = { turn: string; hop: number; botMsgs: number; maxMsgs: number; hopCap: number; at: number };

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** A pair's text without the "[từ phòng …]" context line HQ puts on top (its "đang: …" part changes). */
const bare = (s: string) => norm(s.replace(/^\[từ phòng [^\n]*\]\n/, ""));

/** GET/PUT/DELETE /api/groups: the groups and, by group id, the turn the guard holds ("Cho thêm"). */
export type GroupsView = { groups: Group[]; held: Record<string, HeldTurn> };

/**
 * The per-turn counters, and per ordered room pair for room→room messages outside any turn. In memory
 * only: an HQ restart forgets every turn and pair, so rooms start over from 0 (the hop line a room copies
 * still stops a chain past its max, see `check`). Accepted (research hq-bots-groups.md "Rủi ro mở"): the
 * owner's next message starts a new turn anyway.
 */
export class GroupGuard {
  /** `room` answers `turn` from hop 0 too (the Chief of Staff a "chief" group hands the owner's message to). */
  join(turn: string, room: string): void {
    if (this.turns.has(turn)) this.rooms.set(room, { turn, hop: 0 });
  }

  private turns = new Map<string, Turn>();
  /** room address → the turn it is answering and how deep. */
  private rooms = new Map<string, { turn: string; hop: number }>();
  private recent = new Map<string, { text: string; at: number }[]>();
  /** "from\nto" → that pair's messages outside group turns within `PAIR_WINDOW_MS`. */
  private pairs = new Map<string, { text: string; at: number }[]>();

  /** The owner's message to a group: a new turn, its recipients at hop 0 (any turn they had is left). */
  startTurn(g: Pick<Group, "id" | "name" | "maxHops" | "maxBotMsgsPerTurn">, recipients: readonly string[], now = Date.now()): string {
    this.sweep(now);
    const id = `t_${now.toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    this.turns.set(id, { id, group: g.id, name: g.name, maxMsgs: g.maxBotMsgsPerTurn, hopCap: g.maxHops, botMsgs: 0, held: null, lastAt: now });
    for (const r of recipients) {
      this.rooms.set(r, { turn: id, hop: 0 });
      this.resetPairs(r);
    }
    return id;
  }

  /** The owner wrote to this room outside the group (its DM, the Chief box): it no longer answers a group turn, and its room pairs start over. */
  leave(room: string): void {
    this.rooms.delete(room);
    this.resetPairs(room);
  }

  /**
   * A room→room message outside any group turn: dropped when the pair sent the same text within 60 s,
   * refused past `PAIR_MAX` per `PAIR_WINDOW_MS` until the owner writes to either room. Counted on `pairCommit`.
   */
  pairCheck(from: string, to: string, text: string, now = Date.now()): PairCheck {
    const list = (this.pairs.get(`${from}\n${to}`) ?? []).filter((r) => now - r.at < PAIR_WINDOW_MS);
    const n = bare(text);
    if (list.some((r) => r.text === n && now - r.at < DUP_MS)) return { kind: "duplicate" };
    if (list.length >= PAIR_MAX) return { kind: "pair-limit", count: list.length, max: PAIR_MAX };
    return { kind: "ok" };
  }

  pairCommit(from: string, to: string, text: string, now = Date.now()): void {
    const key = `${from}\n${to}`;
    this.pairs.set(key, [...(this.pairs.get(key) ?? []).filter((r) => now - r.at < PAIR_WINDOW_MS), { text: bare(text), at: now }]);
  }

  private resetPairs(room: string): void {
    for (const key of this.pairs.keys()) {
      const [a, b] = key.split("\n");
      if (a === room || b === room) this.pairs.delete(key);
    }
  }

  /**
   * A room's message to `to`: free when the sender answers no group turn (and copied no hop line past
   * its max), else ok / duplicate / hop-limit. Nothing is counted until `commit` (after delivery).
   */
  check(from: string | null, text: string, now = Date.now()): GuardCheck {
    const at = from ? this.rooms.get(from) : undefined;
    const t = at ? this.turns.get(at.turn) : undefined;
    if (!at || !t || now - t.lastAt > TURN_IDLE_MS) {
      const h = readHopLine(text);
      if (h && h.hop + 1 > h.max) return { kind: "hop-limit", turn: null, group: null, hop: h.hop + 1, max: h.max, botMsgs: 0, maxMsgs: 0 };
      return { kind: "free" };
    }
    const hop = at.hop + 1;
    const key = `${t.id}\n${from}`;
    const n = norm(text);
    if ((this.recent.get(key) ?? []).some((r) => r.text === n && now - r.at < DUP_MS)) return { kind: "duplicate", turn: t.id, group: t.group };
    if (t.botMsgs >= t.maxMsgs || hop > t.hopCap) {
      t.held = { hop, at: now };
      t.lastAt = now;
      return { kind: "hop-limit", turn: t.id, group: t.group, hop, max: t.hopCap, botMsgs: t.botMsgs, maxMsgs: t.maxMsgs };
    }
    return { kind: "ok", turn: t.id, group: t.group, name: t.name, hop, hopCap: t.hopCap };
  }

  /** A delivered message of a turn: counted, the recipient now answers the turn one hop deeper. */
  commit(c: Extract<GuardCheck, { kind: "ok" }>, from: string, to: string, text: string, now = Date.now()): void {
    const t = this.turns.get(c.turn);
    if (!t) return;
    t.botMsgs += 1;
    t.lastAt = now;
    this.rooms.set(to, { turn: t.id, hop: c.hop });
    const key = `${t.id}\n${from}`;
    this.recent.set(key, [...(this.recent.get(key) ?? []).filter((r) => now - r.at < DUP_MS), { text: norm(text), at: now }]);
  }

  /** The owner lets a held turn go on: the message count starts over and `extra` more hops are allowed. */
  continueTurn(turn: string, group: string, extra: number, now = Date.now()): HeldTurn | null {
    const t = this.turns.get(turn);
    if (!t || t.group !== group) return null;
    t.botMsgs = 0;
    t.hopCap += extra;
    t.held = null;
    t.lastAt = now;
    return { turn: t.id, hop: 0, botMsgs: 0, maxMsgs: t.maxMsgs, hopCap: t.hopCap, at: now };
  }

  /** The newest held turn of a group (the "Cho thêm" banner), null when none waits. */
  held(group: string, now = Date.now()): HeldTurn | null {
    let best: Turn | null = null;
    for (const t of this.turns.values()) if (t.group === group && t.held && now - t.lastAt <= TURN_IDLE_MS && (!best || t.held.at > best.held!.at)) best = t;
    return best?.held ? { turn: best.id, hop: best.held.hop, botMsgs: best.botMsgs, maxMsgs: best.maxMsgs, hopCap: best.hopCap, at: best.held.at } : null;
  }

  /** Forget a deleted group's turns. */
  dropGroup(group: string): void {
    for (const [id, t] of this.turns) if (t.group === group) this.turns.delete(id);
  }

  private sweep(now: number): void {
    for (const [id, t] of this.turns) if (now - t.lastAt > TURN_IDLE_MS) this.turns.delete(id);
    for (const [room, at] of this.rooms) if (!this.turns.has(at.turn)) this.rooms.delete(room);
    for (const [key, list] of this.recent) {
      const keep = list.filter((r) => now - r.at < DUP_MS);
      if (keep.length) this.recent.set(key, keep);
      else this.recent.delete(key);
    }
    for (const [key, list] of this.pairs) {
      const keep = list.filter((r) => now - r.at < PAIR_WINDOW_MS);
      if (keep.length) this.pairs.set(key, keep);
      else this.pairs.delete(key);
    }
  }
}

const KEY = Symbol.for("hq.groupGuard");
/** The one guard of this HQ process (kept across dev reloads; gone on restart, see GroupGuard). */
export function groupGuard(): GroupGuard {
  const g = globalThis as unknown as Record<symbol, GroupGuard | undefined>;
  return (g[KEY] ??= new GroupGuard());
}
