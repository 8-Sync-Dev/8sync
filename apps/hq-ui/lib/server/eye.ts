// "Tự soi ảnh": the switch (one `eye` room added to / stopped in a running team, argv only) and the
// tick GET /api/preview runs after each scan: new images of open cards go to the eye room through
// `8sync ccc msg eye` (its inbox), one message per card (lib/eye.ts eyePlan).
import type { DatabaseSync } from "node:sqlite";
import { EYE_ROOM, eyePlan, imageKey, type EyePending } from "../eye";
import { rootKey, type ProjectPreviews } from "../preview";
import { readBoard, type ProjectBoard } from "./board";
import { tx } from "./db";
import { mergedSessions, run } from "./proc";
import { projectOf } from "./office";
import { listPreviews } from "./preview";
import { liveProjects } from "./targets";
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

const g = globalThis as unknown as { __hqEye?: { pending: Map<string, EyePending>; busy: Set<string> } };

/** One pass over the projects whose switch is on. Never throws; returns the cards it messaged. */
export async function eyeTick(db: DatabaseSync, projects: ProjectPreviews[], now = Date.now(), board: (p: { root: string; name: string }) => Promise<ProjectBoard> = (p) => readBoard({ ...p, branch: null })): Promise<{ root: string; card: number }[]> {
  const sent: { root: string; card: number }[] = [];
  const m = (g.__hqEye ??= { pending: new Map(), busy: new Set() });
  for (const p of projects) {
    const key = rootKey(p.root);
    const since = eyeSince(db, p.root);
    if (since == null) {
      m.pending.delete(key);
      continue;
    }
    if (m.busy.has(key)) continue;
    const done = new Set((db.prepare("SELECT image FROM eye_sent WHERE key = ?").all(key) as { image: string }[]).map((r) => r.image));
    // No board read (a process) unless an image could go out.
    if (!p.items.some((i) => i.card != null && i.at >= since && !done.has(imageKey(i)))) {
      m.pending.delete(key);
      continue;
    }
    m.busy.add(key);
    try {
      const b = await board(p);
      if (!b.board) continue;
      const pending = m.pending.get(key) ?? new Map();
      m.pending.set(key, pending);
      for (const s of eyePlan({ items: p.items, board: b.board, since, sent: done, pending, now })) {
        const r = await run("8sync", ["ccc", "msg", EYE_ROOM, s.text], 30_000, p.root);
        if (!r.ok) continue;
        tx(db, () => {
          const ins = db.prepare("INSERT OR IGNORE INTO eye_sent(key, image, at) VALUES (?, ?, ?)");
          for (const k of s.keys) ins.run(key, k, now);
        });
        pending.delete(s.card);
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
    const live = liveProjects(await mergedSessions(db), (cwd) => projectOf(cwd)).filter((p) => on.has(rootKey(p.root)));
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
