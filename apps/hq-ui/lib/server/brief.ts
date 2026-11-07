// "Brief" of a room: what another room (or the Chief of Staff, or the Bots view) needs to know before
// handing it work, in ≤ BRIEF_MAX chars of text. Built from what HQ already reads: the office rooms
// (lib/server/office.ts loadOffice: label, project, status, doing, open question) and the tail of the
// room's transcript (lib/server/activity.ts, cached per file size + mtime): last ask, last reply, files
// it edited. No process per room, no model call.
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ProjectInfo } from "../office";
import { promptBody, type Turn } from "../room-turns";
import { readActivity, readOmpActivity, type ActivityEvent, type RoomLog } from "./activity";
import { getDb } from "./db";
import { ompTranscript } from "./floor";
import { loadOffice, type Room } from "./office";

export type Brief = {
  /** What /api/messages, /api/brief?room= and `hq.mjs send` address: an hq-* name, a Claude session id or an omp room id. */
  id: string;
  session_id: string | null;
  label: string;
  engine: "claude" | "omp";
  project: ProjectInfo | null;
  cwd: string | null;
  status: Room["status"];
  /** The current step / title. */
  doing: string | null;
  /** What it asks the owner right now (question, permission), only while it waits. */
  waiting: string | null;
  /** The last message it got (owner or a room), HQ's frame dropped. */
  lastAsk: string | null;
  /** Its last reply text. */
  lastReply: string | null;
  /** Files it edited lately, newest first, relative to its project. */
  files: string[];
  /** Last activity (unix ms), null when unknown. */
  updatedAt: number | null;
};

/** Text budget of one brief: label, project name, branch, doing, waiting, lastAsk, lastReply, files. */
export const BRIEF_MAX = 600;
const CAP = { label: 48, project: 48, branch: 48, doing: 120, waiting: 120, lastAsk: 120, lastReply: 200, file: 60 } as const;
const FILES_MAX = 4;
/** Steps of the transcript tail scanned for edited files (the turns come from the whole cached tail). */
const LOG_STEPS = 60;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "edit", "write", "ast_edit"]);

/** One line, at most `n` chars (`…` when cut); null when empty. */
export function cut(s: string | null | undefined, n: number): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const cs = [...t];
  return cs.length > n ? `${cs.slice(0, n - 1).join("")}…` : t;
}

const size = (s: string | null | undefined) => (s ? [...s].length : 0);

/** Chars of a brief's text fields (what BRIEF_MAX bounds). */
export function briefLength(b: Brief): number {
  return size(b.label) + size(b.project?.name) + size(b.project?.branch) + size(b.doing) + size(b.waiting) + size(b.lastAsk) + size(b.lastReply) + b.files.reduce((n, f) => n + size(f), 0);
}

function waitingOf(r: Room): string | null {
  const a = r.ask;
  if (a?.kind === "question") return cut(a.questions[0]?.question, CAP.waiting);
  if (a?.kind === "permission") return cut(`xin quyền ${a.tool}${a.what ? `: ${a.what}` : ""}`, CAP.waiting);
  if (r.waiting) return cut(r.waiting, CAP.waiting);
  return r.status === "needs_input" ? "đang chờ anh trả lời" : null;
}

/** `p` as the brief shows it: relative to the project root when inside it, else its last two parts. */
function shortPath(p: string, root: string | null): string {
  const norm = p.replace(/\\/g, "/");
  if (root) {
    const rel = path.relative(root, p).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  }
  return norm.split("/").filter(Boolean).slice(-2).join("/");
}

/** A file path, not an intent line ("Adding app status/open subcommand"): absolute, or one word with a `/` or an extension. */
const PATHISH = /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])\S|^[\w.@~-]+(?:[\\/][\w.@~-]+)+$|^[\w.@-]+\.\w{1,8}$/;

/** Files the room edited, newest first: the summary of an edit tool call when it is a path (a Claude Code `Edit` shows its `file_path`). */
export function editedFiles(events: readonly ActivityEvent[], root: string | null): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < FILES_MAX; i--) {
    const e = events[i];
    if (e.kind !== "tool" || !e.tool || !EDIT_TOOLS.has(e.tool) || e.status === "error") continue;
    const t = e.text.trim();
    if (!PATHISH.test(t)) continue;
    const f = cut(shortPath(t, root), CAP.file);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** The newest turn that has a prompt / an output. */
const lastOf = (turns: readonly Turn[], pick: (t: Turn) => string | null) => {
  for (let i = turns.length - 1; i >= 0; i--) {
    const v = pick(turns[i]);
    if (v) return v;
  }
  return null;
};

/** Trim the longest free-text fields until the brief fits BRIEF_MAX. */
function fit(b: Brief): Brief {
  let over = briefLength(b) - BRIEF_MAX;
  if (over <= 0) return b;
  const out = { ...b, files: [...b.files] };
  while (over > 0 && out.files.length > 1) over -= size(out.files.pop());
  for (const k of ["lastReply", "lastAsk", "waiting", "doing"] as const) {
    if (over <= 0) break;
    const n = size(out[k]);
    if (!n) continue;
    const keep = Math.max(0, n - over);
    out[k] = keep >= 8 ? cut(out[k], keep) : null;
    over -= n - size(out[k]);
  }
  return out;
}

/** A room's brief from its office row and transcript tail (null: no transcript found). Pure. */
export function briefFrom(r: Room, log: RoomLog | null): Brief {
  const events = log?.events ?? [];
  const turns = log?.turns ?? [];
  const lastText = [...events].reverse().find((e) => e.kind === "text")?.text ?? null;
  const prompt = lastOf(turns, (t) => (t.prompt ? promptBody(t.prompt) : null));
  const at = events.reduce<number | null>((m, e) => (e.at != null && (m == null || e.at > m) ? e.at : m), null);
  const project = r.project ? { root: r.project.root, name: cut(r.project.name, CAP.project) ?? r.project.name, branch: cut(r.project.branch, CAP.branch) } : null;
  return fit({
    id: r.name,
    session_id: r.session_id,
    label: cut(r.label, CAP.label) ?? r.name,
    engine: r.engine === "omp" ? "omp" : "claude",
    project,
    cwd: r.cwd,
    status: r.status,
    doing: cut(r.doing, CAP.doing),
    waiting: waitingOf(r),
    lastAsk: cut(prompt, CAP.lastAsk),
    lastReply: cut(lastText ?? lastOf(turns, (t) => t.output), CAP.lastReply),
    files: editedFiles(events, r.project?.root ?? r.cwd),
    updatedAt: Math.max(r.last_active ?? 0, at ?? 0) || null,
  });
}

/** The transcript tail of a live room: a Claude Code session's by its id, an omp room's by the file `8sync ls` names. Its turns come from the whole cached tail. */
export async function logOf(db: DatabaseSync, r: Room): Promise<RoomLog | null> {
  if (r.engine === "omp") {
    const f = await ompTranscript(db, r.name);
    return f ? readOmpActivity(f, LOG_STEPS) : null;
  }
  return r.session_id ? readActivity(r.session_id, r.cwd, LOG_STEPS) : null;
}

/** A live room's brief. */
export async function briefOf(r: Room, db: DatabaseSync = getDb()): Promise<Brief> {
  return briefFrom(r, await logOf(db, r));
}

/** The room `id` names: its address, its session id, or (when only one has it) its label. */
export function findRoom<T extends Pick<Room, "name" | "session_id" | "label">>(rooms: readonly T[], id: string): T | undefined {
  const exact = rooms.find((r) => r.name === id || r.session_id === id);
  if (exact) return exact;
  const byLabel = rooms.filter((r) => r.label.toLowerCase() === id.toLowerCase());
  return byLabel.length === 1 ? byLabel[0] : undefined;
}

/** Every live room's brief (the office's order). */
export async function roster(db: DatabaseSync = getDb()): Promise<Brief[]> {
  const { rooms } = await loadOffice(db);
  return Promise.all(rooms.map((r) => briefOf(r, db)));
}

/** The live rooms, without reading transcripts (the header line and pickers need no more). */
export async function liveRooms(db: DatabaseSync = getDb()): Promise<Room[]> {
  return (await loadOffice(db)).rooms;
}

/**
 * The live room a room-to-room message comes from: hq.mjs names its session (`CLAUDE_CODE_SESSION_ID`,
 * a Claude Code room) and its folder. The session wins; else the one room working in that folder (never
 * `to`, the recipient). Context only: the source line the room gets still says `[phòng …]`.
 */
export function senderRoomOf<T extends Pick<Room, "name" | "session_id" | "cwd">>(rooms: readonly T[], from: { session?: unknown; cwd?: unknown }, to: string): T | null {
  const sid = typeof from.session === "string" && from.session ? from.session : null;
  if (sid) {
    const r = rooms.find((x) => x.session_id === sid || x.name === sid);
    if (r) return r.name === to || r.session_id === to ? null : r;
  }
  if (typeof from.cwd !== "string" || !from.cwd) return null;
  const key = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  const want = key(from.cwd);
  const here = rooms.filter((x) => x.cwd && key(x.cwd) === want && x.name !== to && x.session_id !== to);
  return here.length === 1 ? here[0] : null;
}
