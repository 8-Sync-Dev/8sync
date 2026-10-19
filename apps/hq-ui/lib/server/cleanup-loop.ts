// "Dọn định kỳ" (Máy tab): per project, every 6 h HQ re-measures the project and, when it finds
// abnormal sizes it has not sent in the last 24 h (same findings = same fingerprint), sends the
// prepared cleanup message (lib/disk.ts cleanupText) to the project's room. Owner (2026-10-19):
// "ccc cleanup loop thì càng tốt có nút bật tắt nhanh". HQ-side, started from instrumentation.ts;
// state on globalThis (instrumentation and the routes are separate bundles). Settings and what
// was sent persist in ~/.local/state/8sync/hq/cleanup.json.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { cleanupRoom, cleanupText, diskKey, fingerprint, projectRooms, type Finding } from "../disk";
import { deliverWatched, SessionWaiting } from "./channel";
import { getDb } from "./db";
import { diskProjects, diskState, startScan } from "./disk";
import { inboxLive, isInboxId, queueInbox } from "./inbox";
import { loadOffice, type Room } from "./office";
import { stateDir } from "./paths";
import { capturePlain, sendKeys } from "./proc";
import { ownerMessage } from "./queries";
import { isTmuxName } from "./validate";

export const LOOP_EVERY_MS = 6 * 3600_000;
/** The same findings go out at most once a day. */
export const RESEND_MS = 24 * 3600_000;
/** After an HQ start, the first run waits this long (a restart loop must not send in a burst). */
export const FIRST_DELAY_MS = 10 * 60_000;

/** `room`: the room key the owner picked; null = the project's lead room, else dev. */
export type LoopProject = { on: boolean; room: string | null };
/** A send that reached the room (only these hold back a resend for 24 h). */
export type LoopSent = { fp: string; at: number; room: string; n: number; delivery: string };
/** The last try that did not reach a room; cleared by the next send that does. Shown in the tab. */
export type LoopError = { at: number; room: string | null; error: string };
export type LoopSettings = { projects: Record<string, LoopProject>; sent: Record<string, LoopSent>; lastError: Record<string, LoopError>; lastRun: number | null };
export type LoopState = LoopSettings & { nextRun: number | null; running: boolean };

const file = () => path.join(stateDir(), "cleanup.json");
const obj = <T,>(v: unknown): Record<string, T> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, T>) : {});

export function readLoop(): LoopSettings {
  try {
    const v = JSON.parse(fs.readFileSync(file(), "utf8"));
    return { projects: obj(v?.projects), sent: obj(v?.sent), lastError: obj(v?.lastError), lastRun: typeof v?.lastRun === "number" ? v.lastRun : null };
  } catch {
    return { projects: {}, sent: {}, lastError: {}, lastRun: null };
  }
}

function writeLoop(s: LoopSettings) {
  fs.mkdirSync(stateDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

type Sched = { timer: NodeJS.Timeout | null; next: number | null; running: boolean };
const g = globalThis as unknown as { __hqCleanupLoop?: Sched };
const S = (): Sched => (g.__hqCleanupLoop ??= { timer: null, next: null, running: false });

export function loopState(): LoopState {
  const s = S();
  return { ...readLoop(), nextRun: s.next, running: s.running };
}

/** Switch one project on/off or pick its room; keyed by its folder (diskKey). */
export function setLoopProject(root: string, patch: Partial<LoopProject>): LoopState {
  const s = readLoop();
  const k = diskKey(root);
  const cur = s.projects[k] ?? { on: false, room: null };
  s.projects[k] = { on: patch.on ?? cur.on, room: patch.room === undefined ? cur.room : patch.room };
  writeLoop(s);
  return loopState();
}

/** Send when there is something to say and it is not what went out in the last 24 h. */
export function shouldSend(fs: Finding[], last: LoopSent | undefined, now: number): boolean {
  if (!fs.length) return false;
  return !(last && last.fp === fingerprint(fs) && now - last.at < RESEND_MS);
}

/** What POST /api/messages does for one room, without the HTTP: inbox rooms queue, hq-* rooms get typed into. */
export async function deliverTo(db: DatabaseSync, room: Pick<Room, "name">, text: string): Promise<{ delivery: string | null; error: string | null }> {
  const to = room.name;
  if (isInboxId(to)) {
    queueInbox(to, text);
    ownerMessage(db, to, text, "inbox");
    return { delivery: inboxLive(to) ? "inbox-live" : "inbox", error: null };
  }
  if (!isTmuxName(to)) return { delivery: null, error: "phòng không nhận tin từ HQ" };
  try {
    const r = await deliverWatched(db, to, text, { sendKeys, capture: capturePlain });
    return { delivery: r.delivery, error: r.error ?? (r.delivery === "failed" ? "gõ vào terminal không được" : null) };
  } catch (e) {
    if (e instanceof SessionWaiting) return { delivery: null, error: "phòng đang chờ anh trả lời" };
    return { delivery: null, error: (e as Error).message.slice(0, 200) };
  }
}

/** One pass over the projects that have the loop on. */
export async function runLoop(now = Date.now(), db: DatabaseSync = getDb()): Promise<void> {
  const s = readLoop();
  const sent: Record<string, LoopSent> = {};
  // null: a send went through, the old error goes.
  const errors: Record<string, LoopError | null> = {};
  if (Object.values(s.projects).some((p) => p.on)) {
    const projects = (await diskProjects(db)).filter((p) => s.projects[diskKey(p.root)]?.on);
    await startScan(projects);
    const rooms = (await loadOffice(db)).rooms;
    for (const p of diskState(projects, now).projects) {
      const k = diskKey(p.root);
      if (!shouldSend(p.findings, s.sent[k], now)) continue;
      const picked = s.projects[k]?.room;
      const room = (picked && projectRooms(rooms, p.root).find((r) => r.key === picked)) || cleanupRoom(rooms, p.root);
      if (!room) {
        errors[k] = { at: now, room: null, error: "dự án chưa có phòng nào chạy" };
        continue;
      }
      const r = await deliverTo(db, room, cleanupText(p, p.findings));
      if (r.error == null && r.delivery != null && r.delivery !== "failed") {
        sent[k] = { fp: fingerprint(p.findings), at: now, room: room.label, n: p.findings.length, delivery: r.delivery };
        errors[k] = null;
      } else {
        // Not recorded as sent: the next run tries again instead of waiting 24 h.
        errors[k] = { at: now, room: room.label, error: r.error ?? "không gửi được" };
      }
    }
  }
  // Re-read before writing: the owner may have flipped a switch while the scan ran.
  const fresh = readLoop();
  const lastError = { ...fresh.lastError };
  for (const [k, e] of Object.entries(errors)) {
    if (e) lastError[k] = e;
    else delete lastError[k];
  }
  writeLoop({ ...fresh, sent: { ...fresh.sent, ...sent }, lastError, lastRun: now });
}

/** Starts the 6-hourly loop once per process (instrumentation.ts). */
export function startCleanupLoop(now = Date.now()): void {
  const st = S();
  if (st.timer) return;
  const last = readLoop().lastRun;
  const schedule = (at: number) => {
    st.next = at;
    st.timer = setTimeout(() => void tick(), Math.max(0, at - Date.now()));
    st.timer.unref();
  };
  const tick = async () => {
    st.running = true;
    try {
      await runLoop();
    } catch (e) {
      console.error("[hq] cleanup loop failed:", e instanceof Error ? e.message : String(e));
    } finally {
      st.running = false;
      schedule(Date.now() + LOOP_EVERY_MS);
    }
  };
  schedule(last == null ? now + FIRST_DELAY_MS : Math.max(now + FIRST_DELAY_MS, last + LOOP_EVERY_MS));
}

/** Test seam: stop the timer and forget the schedule. */
export function stopCleanupLoop(): void {
  clearTimeout(g.__hqCleanupLoop?.timer ?? undefined);
  delete g.__hqCleanupLoop;
}
