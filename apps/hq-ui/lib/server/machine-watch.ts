// "Canh máy" (owner 2026-11-07): a room the owner picks watches the machine for every project. Each
// `everyMin` (30 by default) HQ runs `8sync ccc eco scan --json` and hands the room what it found;
// a CPU / RAM / GPU spike held for SPIKE_TICKS minutes sends at once ("urgent"), and the owner can
// send one now from the Máy tab. The room never kills on sight: the task says to look at each
// suspect first (duplicate, spam-opened, orphan, hog), and `8sync ccc eco kill <pid:start>` refuses
// sessions, Claude, HQ, 8sync, the OS and recycled pids. A routine pass with nothing new and no
// spike sends nothing, so the room's context does not fill with "máy ổn".
// "Quan sát phòng" (`observe`, off by default) rides the same tick: lib/server/observer.ts reads every
// live room and nudges a stuck / looping one, or pages the Canh máy room; it never kills either.
import fs from "node:fs";
import path from "node:path";
import type { FloorRow } from "../floor";
import { AUTO, withSenderHeader } from "../sender";
import { SessionWaiting } from "./channel";
import { getDb } from "./db";
import { loadFloor, targetOf } from "./floor";
import { inboxLive, isInboxId, queueInbox } from "./inbox";
import { machine, run8, type Machine, type Run8 } from "./machine";
import { configDir } from "./paths";
import { nudgeText, OBSERVE_DEFAULT, observeStep, observeZero, pageText, type ObserveAction, type ObserveState } from "./observer";
import { ownerMessage } from "./queries";

export const WATCH_TICK_MS = 60_000;
export const EVERY_CHOICES = [15, 30, 60, 120, 240] as const;
/** A metric over its line this many ticks in a row is a spike. */
export const SPIKE_TICKS = 2;
/** One urgent per metric at most this often. */
export const SPIKE_GAP_MS = 15 * 60_000;
const SCAN_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 30_000;
const MAX_SUSPECTS = 12;
const MAX_ROWS = 4;

export type Metric = "cpu" | "ram" | "gpu";
/** `observe`: "Quan sát phòng" (lib/server/observer.ts) on the same tick; `observeSkip`: rooms it never looks at. */
export type WatchConfig = { on: boolean; room: string | null; everyMin: number; cpu: number; ram: number; gpu: number; observe: boolean; observeSkip: string[] };
export const WATCH_DEFAULT: WatchConfig = { on: false, room: null, everyMin: 30, cpu: 85, ram: 90, gpu: 95, observe: false, observeSkip: [] };
export const OBSERVE_SKIP_MAX = 50;
/** Observer actions the Máy tab lists. */
const OBSERVED_MAX = 20;

export type ScanRow = { id: string; pid: number; image: string; mb: number; cpu: number; procs: number; ageMin: number; cmd: string };
export type Suspect = { kind: "duplicate" | "spam" | "orphan" | "hog"; image: string; reason: string; keep?: string; kill: string[]; canKill: boolean; procs: ScanRow[] };
export type Scan = {
  at: number;
  ram: number | null;
  cpu: number | null;
  memMb: { total: number; used: number } | null;
  gpus: { name: string; util: number; memUsed: number; memTotal: number }[];
  procs: number;
  top: { image: string; n: number; cpu: number; mb: number }[];
  suspects: Suspect[];
};

export const watchFile = () => path.join(configDir(), "machine-watch.json");

const pct = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(99, Math.max(30, Math.round(v))) : d);

/** `v` as a config: unknown fields dropped, numbers clamped, `everyMin` one of {@link EVERY_CHOICES}. */
export function normWatch(v: unknown, base: WatchConfig = WATCH_DEFAULT): WatchConfig {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const every = typeof r.everyMin === "number" && (EVERY_CHOICES as readonly number[]).includes(r.everyMin) ? r.everyMin : base.everyMin;
  return {
    on: typeof r.on === "boolean" ? r.on : base.on,
    room: r.room === null ? null : isInboxId(r.room) ? (r.room as string) : base.room,
    everyMin: every,
    cpu: pct(r.cpu, base.cpu),
    ram: pct(r.ram, base.ram),
    gpu: pct(r.gpu, base.gpu),
    observe: typeof r.observe === "boolean" ? r.observe : base.observe,
    observeSkip: Array.isArray(r.observeSkip) ? [...new Set(r.observeSkip.filter(isInboxId))].slice(0, OBSERVE_SKIP_MAX) : base.observeSkip,
  };
}

export function readWatch(file = watchFile()): WatchConfig {
  try {
    return normWatch(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return { ...WATCH_DEFAULT };
  }
}

export function writeWatch(cfg: WatchConfig, file = watchFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export type Levels = Record<Metric, number | null>;

/** CPU %, RAM %, the busiest GPU's utilisation %. */
export function levels(m: Pick<Machine, "cpu" | "mem" | "gpus">): Levels {
  const ram = m.mem.totalMb > 0 ? Math.round((100 * m.mem.usedMb) / m.mem.totalMb) : null;
  const gpu = m.gpus?.length ? Math.max(...m.gpus.map((g) => g.util)) : null;
  return { cpu: m.cpu.pct, ram, gpu };
}

/** `over`: ticks in a row over the line; `sentAt`: the last urgent per metric (0 = never). */
export type SpikeState = { over: Record<Metric, number>; sentAt: Record<Metric, number> };
export const spikeZero = (): SpikeState => ({ over: { cpu: 0, ram: 0, gpu: 0 }, sentAt: { cpu: 0, ram: 0, gpu: 0 } });

const LABEL: Record<Metric, string> = { cpu: "CPU", ram: "RAM", gpu: "GPU" };

/** One tick of the spike rule (pure): the metrics that just became an urgent, and the next state. */
export function spikeStep(st: SpikeState, lv: Levels, cfg: WatchConfig, now: number): { fire: Metric[]; next: SpikeState } {
  const next: SpikeState = { over: { ...st.over }, sentAt: { ...st.sentAt } };
  const fire: Metric[] = [];
  for (const k of ["cpu", "ram", "gpu"] as Metric[]) {
    const v = lv[k];
    next.over[k] = v != null && v >= cfg[k] ? st.over[k] + 1 : 0;
    if (next.over[k] >= SPIKE_TICKS && (!st.sentAt[k] || now - st.sentAt[k] >= SPIKE_GAP_MS)) {
      fire.push(k);
      next.sentAt[k] = now;
    }
  }
  return { fire, next };
}

export function spikeReason(fire: readonly Metric[], lv: Levels, cfg: WatchConfig): string {
  return fire.map((k) => `${LABEL[k]} ${lv[k]}% ≥ ${cfg[k]}% suốt ${SPIKE_TICKS} phút`).join(", ");
}

/** What a routine pass would hand the room: anyone can be killed, keyed so the same findings send once. */
export function findingsKey(s: Scan): string {
  return s.suspects
    .filter((x) => x.canKill && x.kill.length)
    .flatMap((x) => x.kill.map((id) => `${x.kind}:${id}`))
    .sort()
    .join(" ");
}

const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;

export function machineLine(s: Scan): string {
  const parts = [`RAM ${s.ram ?? "?"}%${s.memMb ? ` (${gb(s.memMb.used)}/${gb(s.memMb.total)})` : ""}`, `CPU ${s.cpu ?? "?"}%`];
  for (const g of s.gpus) parts.push(`GPU ${g.util}% (VRAM ${gb(g.memUsed)}/${gb(g.memTotal)})`);
  return parts.join(" · ");
}

export type SendKind = "routine" | "spike" | "owner";

/** The room's task. `why`: the spike, or null for a routine / owner pass. */
export function watchText(kind: SendKind, why: string | null, s: Scan, now: number): string {
  const head = kind === "spike" ? `[HQ Canh máy · KHẨN: ${why}]` : kind === "owner" ? "[HQ Canh máy · KHẨN, chủ bấm gửi]" : "[HQ Canh máy · định kỳ]";
  const at = new Date(now).toTimeString().slice(0, 5);
  const top = s.top.map((t) => `${t.image}(${t.n}x) ${t.cpu}% ${gb(t.mb)}`).join(" · ");
  const sus = s.suspects.slice(0, MAX_SUSPECTS).flatMap((x) => {
    const tag = x.canKill ? (x.kill.length ? `kill được: ${x.kill.join(" ")}` : "không có gì để kill") : "được bảo vệ, chỉ báo";
    const keep = x.keep ? ` · giữ ${x.keep}` : "";
    return [
      `- [${x.kind}] ${x.reason}${keep} · ${tag}`,
      ...x.procs.slice(0, MAX_ROWS).map((r) => `    ${r.id} ${r.image} ${r.mb} MB ${r.cpu}% CPU ${r.procs} tiến trình ${r.ageMin} phút · ${r.cmd}`),
      ...(x.procs.length > MAX_ROWS ? [`    … còn ${x.procs.length - MAX_ROWS} bản`] : []),
    ];
  });
  const more = s.suspects.length > MAX_SUSPECTS ? [`- … còn ${s.suspects.length - MAX_SUSPECTS} nghi vấn (8sync ccc eco scan)`] : [];
  return [
    `${head} ${at} · ${machineLine(s)}`,
    `Nặng nhất: ${top || "?"}`,
    s.suspects.length ? "Nghi vấn (8sync ccc eco scan):" : "Không có nghi vấn: vẫn xem top phía trên có gì bất thường.",
    ...sus,
    ...more,
    "",
    "Việc: KHÔNG kill ngay. Với từng nghi vấn, xem kĩ trước (8sync ccc eco scan, tasklist /v, wmic/Get-CimInstance theo pid):",
    "1. Nó thuộc phòng / dự án nào (dòng lệnh, thư mục, tiến trình cha), có đang được dùng không (dev server đang mở trong HQ, build / render đang chạy)?",
    "2. Có thật là mở trùng / spam / mồ côi / ngốn bất thường không, hay là việc bình thường đang nặng?",
    "3. Rác thật → 8sync ccc eco kill <pid:start> (thêm --tree để kill cả cây). Lệnh từ chối phiên claude/omp, Claude Desktop, HQ, 8sync, tiến trình hệ thống và pid đã đổi chủ; phiên trùng thì báo chủ, không tự đóng.",
    "4. Tìm nguồn gây ra (script / skill / hook nào mở trùng hoặc spam) và sửa hoặc báo.",
    "Xong báo một dòng: đã kill gì, giải phóng bao nhiêu RAM / CPU, giữ gì vì sao.",
  ].join("\n");
}

/** `{…scan json…}` → the scan, or null when it is not one (an 8sync without `eco scan`). */
export function parseScan(out: string): Scan | null {
  try {
    const v = JSON.parse(out) as Partial<Scan>;
    return v && Array.isArray(v.suspects) && Array.isArray(v.top) ? ({ gpus: [], memMb: null, ...v } as Scan) : null;
  } catch {
    return null;
  }
}

type State = {
  timer: NodeJS.Timeout | null;
  busy: boolean;
  spike: SpikeState;
  lastCheck: number;
  lastSent: { at: number; kind: SendKind; room: string; why: string | null } | null;
  lastKey: string | null;
  note: string | null;
  scan: { at: number; v: Scan } | null;
  scanning: Promise<Scan | null> | null;
  observe: ObserveState;
  observed: Observed[];
  observeNote: string | null;
};
/** An observer action as the Máy tab lists it; `outcome`: why a nudge / page did not go out (null: sent or a note). */
export type Observed = ObserveAction & { outcome: string | null };
/** On `globalThis`: instrumentation.ts and the route handlers are separate bundles. */
const g = globalThis as unknown as { __hqWatch?: State };
const S = (g.__hqWatch ??= { timer: null, busy: false, spike: spikeZero(), lastCheck: 0, lastSent: null, lastKey: null, note: null, scan: null, scanning: null, observe: observeZero(), observed: [], observeNote: null });
// A state made by an older build of this module (dev reload) has no observer fields yet.
S.observe ??= observeZero();
S.observed ??= [];
S.observeNote ??= null;

/** `8sync ccc eco scan --json`, one at a time; a scan younger than `fresh` ms is reused. */
export function scanNow(fresh = 0, r: Run8 = run8): Promise<Scan | null> {
  if (S.scan && Date.now() - S.scan.at < fresh) return Promise.resolve(S.scan.v);
  S.scanning ??= r(["ccc", "eco", "scan", "--json"], SCAN_TIMEOUT_MS)
    .then((x) => {
      const v = x.ok ? parseScan(x.stdout) : null;
      if (v) S.scan = { at: Date.now(), v };
      return v;
    })
    .finally(() => {
      S.scanning = null;
    });
  return S.scanning;
}

export type KillRow = { id: string; ok: boolean; killed: number; error: string | null };
export const KILL_ID_RE = /^\d{1,10}:\d{1,12}$/;

/** `8sync ccc eco kill <id…> [--tree] --json` (exit 1 when any id was refused; the rows still say which). */
export async function killIds(ids: readonly string[], tree: boolean, r: Run8 = run8): Promise<KillRow[] | null> {
  const x = await r(["ccc", "eco", "kill", ...ids, ...(tree ? ["--tree"] : []), "--json"], KILL_TIMEOUT_MS);
  S.scan = null;
  try {
    const v = JSON.parse(x.stdout) as { results?: KillRow[] };
    return Array.isArray(v.results) ? v.results : null;
  } catch {
    return null;
  }
}

/** Rooms the owner can pick: live and reading their inbox. */
export function watchRooms(rows: readonly FloorRow[], live: (id: string) => boolean = inboxLive): FloorRow[] {
  return rows.filter((r) => r.live && isInboxId(r.inbox_id) && live(r.inbox_id as string));
}

export type Sent = { sent: SendKind; session: string } | { skipped: string };

/** What a tick reads and where it writes (the test swaps them). */
export type WatchDeps = {
  floor: () => Promise<FloorRow[]>;
  live: (id: string) => boolean;
  scan: () => Promise<Scan | null>;
  levels: () => Promise<Levels>;
  deliver: (room: FloorRow, id: string, text: string, now: number) => void;
};

function liveDeps(): WatchDeps {
  return {
    floor: () => loadFloor(getDb()),
    live: inboxLive,
    scan: () => scanNow(0),
    levels: async () => levels(await machine(process.platform, undefined, false)),
    deliver: (room, id, text, now) => {
      queueInbox(id, text, AUTO, targetOf(room, id), now);
      ownerMessage(getDb(), id, withSenderHeader(text, AUTO), "inbox");
    },
  };
}

async function send(d: WatchDeps, cfg: WatchConfig, kind: SendKind, why: string | null, now: number, scan: Scan | null): Promise<Sent> {
  if (!cfg.room) return { skipped: "Chưa chọn phòng canh máy" };
  const room = (await d.floor()).find((r) => r.inbox_id === cfg.room);
  if (!room || !watchRooms([room], d.live).length) return { skipped: "Phòng canh máy không live: mở lại phòng hoặc chọn phòng khác" };
  const s = scan ?? (await d.scan());
  if (!s) return { skipped: "8sync ccc eco scan không chạy được (8sync cũ? chạy 8sync up)" };
  d.deliver(room, cfg.room, watchText(kind, why, s, now), now);
  S.lastSent = { at: now, kind, room: cfg.room, why };
  S.lastKey = findingsKey(s);
  return { sent: kind, session: cfg.room };
}

/** The owner's "Gửi urgent ngay". */
export function sendUrgent(now = Date.now(), cfg = readWatch(), deps: Partial<WatchDeps> = {}): Promise<Sent> {
  return send({ ...liveDeps(), ...deps }, cfg, "owner", null, now, null);
}

/**
 * "Quan sát phòng" on this tick: the observer's rules over the rooms HQ can reach, then each nudge
 * into its room and each page into the Canh máy room through `deliver`. Nothing is retried: a failed
 * delivery (a dialog open, a write error) is listed with its reason and the ladder still moves on.
 */
export async function observeTick(d: WatchDeps, cfg: WatchConfig, now: number): Promise<Observed[]> {
  const rows = watchRooms(await d.floor(), d.live);
  const { actions, next } = observeStep(S.observe, rows, now, OBSERVE_DEFAULT, { skip: cfg.observeSkip, watchRoom: cfg.room });
  S.observe = next;
  const watch = cfg.room ? rows.find((r) => r.inbox_id === cfg.room) : undefined;
  const out = actions.map((a): Observed => {
    if (a.level === "note") return { ...a, outcome: null };
    const to = a.level === "nudge" ? rows.find((r) => r.inbox_id === a.room) : watch;
    if (!to?.inbox_id) return { ...a, outcome: "Chưa có phòng canh máy đang mở để báo" };
    try {
      d.deliver(to, to.inbox_id, a.level === "nudge" ? nudgeText(a) : pageText(a), now);
      return { ...a, outcome: null };
    } catch (e) {
      return { ...a, outcome: e instanceof SessionWaiting ? `Phòng đang mở hộp thoại (${e.dialog}): không gửi` : `Gửi lỗi: ${(e as Error).message}` };
    }
  });
  S.observed = [...out.reverse(), ...S.observed].slice(0, OBSERVED_MAX);
  return out;
}

/** One tick (the timer calls it every WATCH_TICK_MS). */
export async function watchTick(now = Date.now(), cfg = readWatch(), deps: Partial<WatchDeps> = {}): Promise<Sent | null> {
  const d = { ...liveDeps(), ...deps };
  if (cfg.observe) {
    try {
      await observeTick(d, cfg, now);
      S.observeNote = cfg.room ? null : "Chưa chọn phòng Canh máy để báo anh: quan sát chỉ ghi chú và nhắc phòng, không báo lên";
    } catch (e) {
      S.observeNote = `Quan sát phòng lỗi: ${(e as Error).message}`;
    }
  } else S.observe = observeZero();
  if (!cfg.on || !cfg.room) {
    S.spike = spikeZero();
    return null;
  }
  const l = await d.levels();
  const { fire, next } = spikeStep(S.spike, l, cfg, now);
  S.spike = next;
  if (fire.length) {
    const r = await send(d, cfg, "spike", spikeReason(fire, l, cfg), now, null);
    S.note = "skipped" in r ? r.skipped : null;
    return r;
  }
  if (now - S.lastCheck < cfg.everyMin * 60_000) return null;
  S.lastCheck = now;
  const s = await d.scan();
  if (!s) {
    S.note = "8sync ccc eco scan không chạy được (8sync cũ? chạy 8sync up)";
    return { skipped: S.note };
  }
  const key = findingsKey(s);
  if (!key || key === S.lastKey) {
    S.note = key ? "Định kỳ: không có gì mới so với lần gửi trước, không gửi" : "Định kỳ: không có gì kill được, không gửi";
    return { skipped: S.note };
  }
  const r = await send(d, cfg, "routine", null, now, s);
  S.note = "skipped" in r ? r.skipped : null;
  return r;
}

/** What the Máy tab shows next to the settings. */
export function watchStatus(cfg: WatchConfig) {
  return {
    lastCheck: S.lastCheck || null,
    nextCheck: cfg.on && cfg.room ? (S.lastCheck ? S.lastCheck + cfg.everyMin * 60_000 : null) : null,
    lastSent: S.lastSent,
    note: S.note,
    over: S.spike.over,
    observed: S.observed,
    observeNote: cfg.observe ? S.observeNote : null,
  };
}

/** Resets the routine clock (a new interval or room starts counting now). */
export function watchChanged(): void {
  S.lastCheck = 0;
  S.lastKey = null;
  S.spike = spikeZero();
}

async function tick(): Promise<void> {
  if (S.busy) return;
  S.busy = true;
  try {
    const r = await watchTick();
    if (r && "sent" in r) console.log(`[hq] machine watch ${r.sent} → ${r.session}`);
  } catch (e) {
    console.error("[hq] machine watch", e);
  } finally {
    S.busy = false;
  }
}

/** Server start (instrumentation.ts): first look two minutes in (rooms come up), then every minute. */
export function startMachineWatch(): void {
  if (S.timer) return;
  const first = setTimeout(() => void tick(), 120_000);
  first.unref?.();
  S.timer = setInterval(() => void tick(), WATCH_TICK_MS);
  S.timer.unref?.();
}
