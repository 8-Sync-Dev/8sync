// Delivering the "ai đang làm gì" digest (lib/digest.ts). HQ puts it under the owner's words when it hands a
// bot the owner's message (lib/server/deliver.ts deliverOrWaiting): the bot reads it at the start of the very
// turn, with no tool call of its own. It goes only when it differs from the last one that bot got, never
// under a `/command` (its arguments are the owner's), and never to a bot the owner switched it off for.
// A bot may also pull it (`hq.mjs digest`, POST /api/digest). What each bot last got, and the switch, sit in
// ~/.config/8sync/hq/digests.json (tmp + rename). Local only.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { buildDigest } from "../digest";
import { liveRooms } from "./brief";
import { readFacts } from "./facts";
import { configDir } from "./paths";

export type DigestEntry = { hash: string | null; at: number | null; text: string | null; optOut: boolean };
type DigestState = Record<string, DigestEntry>;

/** Bots remembered: the ones that got a digest longest ago go first past this. */
const ROOMS_MAX = 200;
export const EMPTY_ENTRY: DigestEntry = { hash: null, at: null, text: null, optOut: false };

export const digestsFile = () => path.join(configDir(), "digests.json");
export const digestHash = (text: string) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

export function readDigests(file = digestsFile()): DigestState {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as { rooms?: unknown };
    const rooms = v?.rooms && typeof v.rooms === "object" && !Array.isArray(v.rooms) ? (v.rooms as Record<string, unknown>) : {};
    const out: DigestState = {};
    for (const [k, e] of Object.entries(rooms)) {
      if (!e || typeof e !== "object") continue;
      const r = e as Record<string, unknown>;
      out[k] = {
        hash: typeof r.hash === "string" ? r.hash : null,
        at: typeof r.at === "number" ? r.at : null,
        text: typeof r.text === "string" ? r.text : null,
        optOut: r.optOut === true,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeDigests(state: DigestState, file: string): void {
  const keep = Object.entries(state)
    .sort(([, a], [, b]) => (b.optOut ? 1 : 0) - (a.optOut ? 1 : 0) || (b.at ?? 0) - (a.at ?? 0))
    .slice(0, ROOMS_MAX);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ rooms: Object.fromEntries(keep) }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** What bot `room` last got, and whether the owner switched it off. */
export const digestEntry = (room: string, file = digestsFile()): DigestEntry => readDigests(file)[room] ?? EMPTY_ENTRY;

/** Remember `text` as what `room` got at `now`. */
export function recordDigest(room: string, text: string, now = Date.now(), file = digestsFile()): void {
  const s = readDigests(file);
  writeDigests({ ...s, [room]: { ...(s[room] ?? EMPTY_ENTRY), hash: digestHash(text), at: now, text } }, file);
}

/** The owner's switch for `room` (true: no digest under its messages). */
export function setDigestOptOut(room: string, optOut: boolean, file = digestsFile()): DigestEntry {
  const s = readDigests(file);
  const e = { ...(s[room] ?? EMPTY_ENTRY), optOut };
  writeDigests({ ...s, [room]: e }, file);
  return e;
}

export type DigestSkip = "opt-out" | "command" | "empty" | "same";

/** Whether `digest` goes under the owner's `text` to a bot whose last digest is `last`. Pure. */
export function planDigest(last: DigestEntry, digest: string | null, text: string): { attach: string } | { skip: DigestSkip } {
  if (last.optOut) return { skip: "opt-out" };
  if (text.trimStart().startsWith("/")) return { skip: "command" };
  if (!digest) return { skip: "empty" };
  if (last.hash === digestHash(digest)) return { skip: "same" };
  return { attach: digest };
}

/** The digest for bot `id` now (fresh from the office and the facts file), and the key it is remembered under (its address). */
export async function currentDigest(db: DatabaseSync, id: string): Promise<{ room: string; text: string | null }> {
  const rooms = await liveRooms(db);
  return { room: rooms.find((r) => r.name === id || r.session_id === id)?.name ?? id, text: buildDigest(rooms, id, readFacts().facts.map((f) => f.text)) };
}

/**
 * The owner's `text` to bot `id` with the digest under it when it should go, and `commit` to call once it
 * was delivered (a message held by an open dialog did not reach the bot). Never fails a delivery: an error
 * reading the office or the files sends the text alone.
 */
export async function withOwnerDigest(db: DatabaseSync, id: string, text: string): Promise<{ text: string; commit: () => void }> {
  const none = { text, commit: () => {} };
  try {
    const d = await currentDigest(db, id);
    const plan = planDigest(digestEntry(d.room), d.text, text);
    if (!("attach" in plan)) return none;
    return { text: `${text}\n\n${plan.attach}`, commit: () => recordDigest(d.room, plan.attach) };
  } catch (e) {
    console.error("[hq] digest skipped", e);
    return none;
  }
}
