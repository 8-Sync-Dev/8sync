// "Tự soi ảnh": the switch (one `eye` room added to / stopped in a running team, argv only) and the
// tick GET /api/preview runs after each scan: new images of open cards go to the eye room through
// `8sync ccc msg eye` (its inbox), one message per card (lib/eye.ts eyeDue, eyeSend).
import type { DatabaseSync } from "node:sqlite";
import { EYE_ROOM, eyeDue, eyeSend, type EyePending } from "../eye";
import { rootKey, type ProjectPreviews } from "../preview";
import { readBoard, type ProjectBoard } from "./board";
import { tx } from "./db";
import { run } from "./proc";
import { projectsInView } from "./in-view";
import { listPreviews } from "./preview";
import { tail } from "./team";

export const eyeArgs = (on: boolean) => (on ? ["ccc", "auto", "up", "--add", EYE_ROOM] : ["ccc", "auto", "down", "--only", EYE_ROOM]);

/** When the switch went on for this project, else null. */
export function eyeSince(db: DatabaseSync, root: string): number | null {
  const r = db.prepare("SELECT since FROM eye_on WHERE key = ?").get(rootKey(root)) as { since: number } | undefined;
  return r ? Number(r.since) : null;
}

export type EyeResult = { ok: boolean; on: boolean; output: string; error: string | null };

const switching = new Set<string>();

/** On: `auto up --add eye` (the team must run here), then remembered. Off: forgotten first, then `auto down --only eye`. */
export async function setEye(db: DatabaseSync, root: string, on: boolean, now = Date.now()): Promise<EyeResult> {
  const key = rootKey(root);
  if (switching.has(key)) return { ok: false, on: eyeSince(db, root) != null, output: "", error: "đang bật/tắt soi ảnh, đợi lần trước xong" };
  switching.add(key);
  try {
    // Off never waits on the CLI: nothing more is sent even if stopping the room fails.
    if (!on) db.prepare("DELETE FROM eye_on WHERE key = ?").run(key);
    const r = await run("8sync", eyeArgs(on), on ? 180_000 : 60_000, root);
    const output = tail(`${r.stdout}\n${r.stderr}`, 8);
    if (!r.ok) return { ok: false, on: eyeSince(db, root) != null, output, error: tail(r.stderr, 4).replace(/^Error:\s*/, "") || "8sync ccc auto thất bại" };
    if (on) db.prepare("INSERT INTO eye_on(key, root, since) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING").run(key, root, now);
    return { ok: true, on, output, error: null };
  } finally {
    switching.delete(key);
  }
}

/** A card whose message cannot go out now (closed or gone from the board, board unreadable, `ccc msg` failed) waits this long. */
export const EYE_BACKOFF_MS = 10 * 60_000;

/** Per project: cards waiting out their debounce, cards backing off (card → until, ms). Memory only. */
type Mem = { pending: EyePending; backoff: Map<number, number> };
const g = globalThis as unknown as { __hqEye?: { projects: Map<string, Mem>; busy: Set<string> } };

/**
 * One pass over the projects whose switch is on. The board is read only when a card is due (no
 * process while images wait out their debounce or back off). Never throws; returns the cards it messaged.
 */
export async function eyeTick(db: DatabaseSync, projects: ProjectPreviews[], now = Date.now(), board: (p: { root: string; name: string }) => Promise<ProjectBoard> = (p) => readBoard({ ...p, branch: null })): Promise<{ root: string; card: number }[]> {
  const sent: { root: string; card: number }[] = [];
  const m = (g.__hqEye ??= { projects: new Map(), busy: new Set() });
  for (const p of projects) {
    const key = rootKey(p.root);
    const since = eyeSince(db, p.root);
    if (since == null) {
      m.projects.delete(key);
      continue;
    }
    if (m.busy.has(key)) continue;
    const mem = m.projects.get(key) ?? { pending: new Map(), backoff: new Map() };
    m.projects.set(key, mem);
    for (const [card, until] of mem.backoff) if (until <= now) mem.backoff.delete(card);
    const done = new Set((db.prepare("SELECT image FROM eye_sent WHERE key = ?").all(key) as { image: string }[]).map((r) => r.image));
    const due = eyeDue({ items: p.items, since, sent: done, pending: mem.pending, now, skip: (c) => mem.backoff.has(c) });
    if (!due.length) continue;
    const wait = (card: number) => {
      mem.pending.delete(card);
      mem.backoff.set(card, now + EYE_BACKOFF_MS);
    };
    m.busy.add(key);
    try {
      const b = await board(p);
      for (const d of due) {
        const s = b.board ? eyeSend(d, b.board) : null;
        if (!s) {
          wait(d.card);
          continue;
        }
        const r = await run("8sync", ["ccc", "msg", EYE_ROOM, s.text], 30_000, p.root);
        if (!r.ok) {
          wait(d.card);
          continue;
        }
        tx(db, () => {
          const ins = db.prepare("INSERT OR IGNORE INTO eye_sent(key, image, at) VALUES (?, ?, ?)");
          for (const k of s.keys) ins.run(key, k, now);
        });
        mem.pending.delete(s.card);
        sent.push({ root: p.root, card: s.card });
      }
    } catch {
      /* next poll tries again */
    } finally {
      m.busy.delete(key);
    }
  }
  return sent;
}

let autoRun: Promise<unknown> | null = null;

/**
 * The same pass from GET /api/auto (every open HQ tab polls it), so images go out whatever tab is
 * open. Nothing at all while no project has the switch on; one run at a time; only those projects scanned.
 */
export async function eyeAutoTick(db: DatabaseSync): Promise<{ root: string; card: number }[]> {
  if (autoRun || !db.prepare("SELECT 1 FROM eye_on LIMIT 1").get()) return [];
  const on = new Set((db.prepare("SELECT key FROM eye_on").all() as { key: string }[]).map((r) => r.key));
  const job = (async () => {
    const live = (await projectsInView(db)).filter((p) => on.has(rootKey(p.root)));
    return live.length ? eyeTick(db, await listPreviews(live)) : [];
  })();
  autoRun = job;
  try {
    return await job;
  } catch {
    return [];
  } finally {
    autoRun = null;
  }
}
