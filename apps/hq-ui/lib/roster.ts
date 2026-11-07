// The sidebar as a Bot roster (owner 2026-11-07, Grok Bot style: "thiết kế quanh Bot, không quanh
// phiên"): one row per teammate (face, a name no other row shares, role, state), the Primary Bot
// that coordinates the others, the owner's pins, a section per project and "Bot ẩn" at the bottom.
// Sessions, worktrees and subagents are a bot's history (its detail page), not sidebar rows.
// Pure, no React, no I/O. Tested in tests/roster.test.ts.
import { BOT_STATUS_LABEL, type Bot, type BotRoom } from "./bots";
import { roleOf } from "./roles";
import { groupKey, repoOf } from "./sidebar";
import { BUILT_IN_TEMPLATES } from "./templates";

/**
 * A room that is another room's helper, not a teammate: omp subagents (`__advisor`) and team workers
 * (`worker-ui`). They show in their bot's "Lịch sử phiên", never as roster rows.
 */
export function isHelperRoom(label: string): boolean {
  return /^__/.test(label) || /^worker-/i.test(label);
}

/** The repo a bot works in: a Claude Code worktree folds under its repo; null with no folder at all. */
export function botRepo(r: Pick<BotRoom, "project" | "cwd">): { root: string; name: string } | null {
  const dir = r.project?.root ?? r.cwd;
  if (!dir) return null;
  const x = repoOf(dir);
  return { root: x.root, name: x.name };
}

/**
 * A bot's identity across restarts: its label in its repo. A restarted omp room gets a new room key,
 * so pins and "Ẩn" are kept by this, not by the key.
 */
export function botId(r: Pick<BotRoom, "label" | "project" | "cwd">): string {
  return `${r.label.toLowerCase()}@${groupKey(botRepo(r)?.root ?? "")}`;
}

// Words a room label carries, mapped to the job it does (first match wins). `core` is 8sync's main
// room of a project: the one that splits the work and hands it to the others.
const ROLE_WORDS: [RegExp, string][] = [
  [/^core$|router|solo|chief/i, "Điều phối"],
  [/clean|disk/i, "Dọn máy"],
  [/learn|memory|know/i, "Học và ghi nhớ"],
  [/mkt|market/i, "Marketing"],
  [/content|post|reel|video/i, "Nội dung"],
  [/research|^rd\b/i, "Nghiên cứu"],
  [/review/i, "Review"],
  [/test|\bqa\b/i, "Kiểm thử"],
  [/game/i, "Làm game"],
  [/profile/i, "Hồ sơ"],
  [/coding|code|dev|fullstack|build/i, "Lập trình"],
];

/**
 * The role label under a bot's name: from its label's words, else the template it was made from
 * (`<template>-<project>`), else its HQ session role, else "Trợ lý".
 */
export function botRole(label: string, sessionRole: string | null = null): string {
  const t = BUILT_IN_TEMPLATES.find((x) => x.id !== "blank" && (label === x.id || label.startsWith(`${x.id}-`)));
  if (t) return t.name;
  for (const [re, word] of ROLE_WORDS) if (re.test(label)) return word;
  const r = roleOf(sessionRole);
  if (r) return r.labelVi.replace(/\s*\(.*\)$/, "");
  return "Trợ lý";
}

/** A roster row: the bot plus its identity, role and section. */
export type RosterBot<R extends BotRoom = BotRoom> = Bot<R> & { id: string; role: string; section: string; root: string | null };

/** Live bots the roster lists (helpers dropped), each with its identity, role and project section. */
export function rosterBots<R extends BotRoom>(bots: readonly Bot<R>[], roleOfRoom: (r: R) => string | null = () => null): RosterBot<R>[] {
  return bots
    .filter((b) => !isHelperRoom(b.room.label))
    .map((b) => {
      const repo = botRepo(b.room);
      return { ...b, id: botId(b.room), role: botRole(b.room.label, roleOfRoom(b.room)), section: repo?.name ?? "Khác", root: repo?.root ?? null };
    });
}

/**
 * The Primary Bot (Grok's "Primary": it checks in with the owner and coordinates the others): the
 * Chief of Staff while it runs; else the `core` room of the project whose `/solo` Router runs (the
 * newest one); else the `core` room active last. Null when no bot is a coordinator.
 */
export function primaryKey(
  bots: readonly Pick<RosterBot, "key" | "name" | "root" | "at">[],
  chief: string | null,
  soloRoots: readonly string[],
): string | null {
  if (chief != null && bots.some((b) => b.key === chief)) return chief;
  const cores = bots.filter((b) => b.name.toLowerCase() === "core");
  for (const root of soloRoots) {
    const hit = cores.find((b) => b.root != null && groupKey(b.root) === groupKey(root));
    if (hit) return hit.key;
  }
  return [...cores].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]?.key ?? null;
}

export type RosterSectionId = "needs" | "primary" | "pinned" | "hidden" | `p:${string}`;
export type RosterSection<B> = { id: RosterSectionId; title: string; bots: B[] };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

/**
 * The roster, top to bottom: "Chờ anh" (a bot waiting on the owner floats up from anywhere, even
 * from Bot ẩn), the Primary Bot, the owner's pins (pin order), one section per project (A→Z, "Khác"
 * last), then "Bot ẩn". Inside a section the incoming order holds (lib/bots botList: attention, then
 * newest). Every bot shows once; empty sections are left out.
 */
export function rosterSections<B extends Pick<RosterBot, "key" | "id" | "status" | "section">>(
  bots: readonly B[],
  o: { primary: string | null; pins: readonly string[]; hidden: readonly string[] },
): RosterSection<B>[] {
  const needs: B[] = [];
  const pinned: B[] = [];
  const hidden: B[] = [];
  const projects = new Map<string, B[]>();
  let primary: B | null = null;
  for (const b of bots) {
    if (b.status === "needs") needs.push(b);
    else if (b.key === o.primary) primary = b;
    else if (o.hidden.includes(b.id)) hidden.push(b);
    else if (o.pins.includes(b.id)) pinned.push(b);
    else projects.set(b.section, [...(projects.get(b.section) ?? []), b]);
  }
  pinned.sort((a, b) => o.pins.indexOf(a.id) - o.pins.indexOf(b.id));
  const names = [...projects.keys()].sort((a, b) => Number(a === "Khác") - Number(b === "Khác") || fold(a).localeCompare(fold(b)));
  const out: RosterSection<B>[] = [
    { id: "needs", title: BOT_STATUS_LABEL.needs, bots: needs },
    { id: "primary", title: "Điều phối", bots: primary ? [primary] : [] },
    { id: "pinned", title: "Đã ghim", bots: pinned },
    ...names.map((n): RosterSection<B> => ({ id: `p:${n}`, title: n, bots: projects.get(n)! })),
    { id: "hidden", title: "Bot ẩn", bots: hidden },
  ];
  return out.filter((s) => s.bots.length > 0);
}
