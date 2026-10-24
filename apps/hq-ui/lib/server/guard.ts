// "Bảo vệ máy" in the Máy tab: the ccc auto resource guard. Read from the `guard` field of
// `8sync ccc auto status --json` (validated strictly, anything off → null); set with the fixed argv
// `8sync ccc auto guard <30..95>|off|cap <10..90>|off|eco on|off`. Only a validated integer or a literal reaches argv.
import { run } from "./proc";

export type GuardAction = { at: number; text: string };
export type GuardProject = {
  root: string;
  /** 0 bình thường · 1 dọn mạnh · 2 khởi động lại phòng nặng · 3 tạm dừng bớt phòng. */
  level: 0 | 1 | 2 | 3;
  at: number | null;
  ram: number | null;
  /** Machine CPU %, averaged over the last guard tick. */
  cpu: number | null;
  /** MsMpEng's share of the whole machine's CPU %, last guard tick (Windows only). */
  defender_cpu: number | null;
  paused: string[];
  /** Newest last. */
  actions: GuardAction[];
  /** A PowerShell command for the owner to run as admin (set whenever the guard ran on Windows); HQ never runs it. */
  defender: string | null;
  /** Live rooms, heaviest RAM first: whole process tree RAM (MB) and CPU % of the machine over the last tick. */
  rooms: GuardRoom[];
  /** ≤ 3 heaviest CPU eaters, e.g. "MCP trail 24% (dev2)". */
  top: string[];
  /** Since when (unix s) each breach has held; null = not breaching. */
  breach: GuardBreach | null;
  /** The latest action. */
  last: GuardAction | null;
  /** Where the RAM was at the last pass over the threshold (null under it or on an 8sync without it). */
  ram_split: GuardRamSplit | null;
};
export type GuardRoom = { name: string; mb: number; cpu: number | null };
/** MB: every room tree (all projects), omp/8sync outside them, everything else with its ≤ 4 heaviest apps; `stuck`: rooms + omp under the overshoot, cleaning them cannot reach the threshold. */
export type GuardRamSplit = { rooms_mb: number; omp_mb: number; other_mb: number; top: { name: string; mb: number }[]; stuck: boolean };
export type GuardBreach = { ram: number | null; ram_hi: number | null; cpu: number | null; cpu_max: number | null };
/** Size of %TEMP%\qa-card-* / qa-fetch* (full repo copies QA rooms extracted); `partial`: the count stopped early. */
export type TempQa = { mb: number; dirs: number; partial: boolean; at: number };
/**
 * `pct` null = guard off; it is the RAM threshold, `cpuPct` the CPU one (null on an 8sync with one threshold for both).
 * `eco`: rooms run in Efficiency mode + below-normal priority; null on an 8sync without it.
 * `cap`: rooms + Claude Code daemon pinned to `capN` of `cpus` logical CPUs (null = off or an 8sync without it);
 * `capTight`: halved while CPU is over the CPU threshold.
 */
export type Guard = {
  pct: number | null;
  cpuPct: number | null;
  eco: boolean | null;
  cap: number | null;
  capN: number | null;
  cpus: number | null;
  capTight: boolean;
  projects: GuardProject[];
  temp_qa: TempQa | null;
};

const STR_MAX = 300;
const PROJECTS_MAX = 50;
const PAUSED_MAX = 50;
const ACTIONS_MAX = 10;
const ROOMS_MAX = 20;
const NAME_MAX = 64;
const TOP_MAX = 3;
const RAM_TOP_MAX = 4;
export const GUARD_MIN = 30;
export const GUARD_MAX = 95;
export const CAP_MIN = 10;
export const CAP_MAX = 90;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, STR_MAX) : null);
const obj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
/** A percentage 0..100, anything else null. */
const pct = (v: unknown) => (num(v) && v >= 0 && v <= 100 ? v : null);
const time = (v: unknown) => (num(v) && v >= 0 ? v : null);
const action = (a: unknown): GuardAction | null => (obj(a) && num(a.at) && typeof a.text === "string" ? { at: a.at, text: a.text.slice(0, STR_MAX) } : null);

function parseBreach(b: unknown): GuardBreach | null {
  return obj(b) ? { ram: time(b.ram), ram_hi: time(b.ram_hi), cpu: time(b.cpu), cpu_max: time(b.cpu_max) } : null;
}

function parseRamSplit(r: unknown): GuardRamSplit | null {
  if (!obj(r) || !num(r.rooms_mb) || !num(r.omp_mb) || !num(r.other_mb) || r.rooms_mb < 0 || r.omp_mb < 0 || r.other_mb < 0) return null;
  const top = (Array.isArray(r.top) ? r.top : []).flatMap((t) => (obj(t) && typeof t.name === "string" && t.name && num(t.mb) && t.mb >= 0 ? [{ name: t.name.slice(0, NAME_MAX), mb: t.mb }] : [])).slice(0, RAM_TOP_MAX);
  return { rooms_mb: r.rooms_mb, omp_mb: r.omp_mb, other_mb: r.other_mb, top, stuck: r.stuck === true };
}

function parseTempQa(t: unknown): TempQa | null {
  if (!obj(t) || !num(t.mb) || t.mb < 0 || !Number.isInteger(t.dirs) || (t.dirs as number) < 0 || typeof t.partial !== "boolean" || !num(t.at)) return null;
  return { mb: t.mb, dirs: t.dirs as number, partial: t.partial, at: t.at };
}

function parseProject(p: unknown): GuardProject | null {
  if (!obj(p)) return null;
  const root = str(p.root);
  if (!root || !Number.isInteger(p.level) || (p.level as number) < 0 || (p.level as number) > 3) return null;
  if (p.at != null && !num(p.at)) return null;
  if (p.ram != null && !num(p.ram)) return null;
  if (!Array.isArray(p.paused) || !Array.isArray(p.actions)) return null;
  if (p.defender != null && typeof p.defender !== "string") return null;
  const paused = p.paused.flatMap((r) => (typeof r === "string" ? [r.slice(0, STR_MAX)] : [])).slice(0, PAUSED_MAX);
  const actions = p.actions.flatMap((a) => action(a) ?? []).slice(-ACTIONS_MAX);
  // Added later: absent = none; a malformed entry is dropped, the project stays.
  const rooms = (Array.isArray(p.rooms) ? p.rooms : [])
    .flatMap((r) => (obj(r) && typeof r.name === "string" && r.name && num(r.mb) && r.mb >= 0 ? [{ name: r.name.slice(0, NAME_MAX), mb: r.mb, cpu: pct(r.cpu) }] : []))
    .slice(0, ROOMS_MAX);
  const top = (Array.isArray(p.top) ? p.top : []).flatMap((t) => (typeof t === "string" && t ? [t.slice(0, STR_MAX)] : [])).slice(0, TOP_MAX);
  return {
    root,
    level: p.level as GuardProject["level"],
    at: (p.at as number | null) ?? null,
    ram: (p.ram as number | null) ?? null,
    cpu: pct(p.cpu),
    defender_cpu: pct(p.defender_cpu),
    paused,
    actions,
    defender: str(p.defender),
    rooms,
    top,
    breach: parseBreach(p.breach),
    last: action(p.last),
    ram_split: parseRamSplit(p.ram_split),
  };
}

/** The `guard` field; null when missing or malformed (the Máy tab then hides the section). */
export function parseGuard(v: unknown): Guard | null {
  if (!obj(v) || !Array.isArray(v.projects)) return null;
  if (v.pct != null && !(Number.isInteger(v.pct) && (v.pct as number) >= 0 && (v.pct as number) <= 100)) return null;
  const projects: GuardProject[] = [];
  for (const p of v.projects.slice(0, PROJECTS_MAX)) {
    const g = parseProject(p);
    if (!g) return null;
    projects.push(g);
  }
  const int = (x: unknown, lo: number, hi: number) => (Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? (x as number) : null);
  return {
    pct: (v.pct as number | null) ?? null,
    cpuPct: v.pct == null ? null : int(v.cpu_pct, GUARD_MIN, GUARD_MAX),
    eco: typeof v.eco === "boolean" ? v.eco : null,
    cap: int(v.cap, CAP_MIN, CAP_MAX),
    capN: int(v.cap_n, 1, 64),
    cpus: int(v.cpus, 1, 64),
    capTight: v.cap_tight === true,
    projects,
    temp_qa: parseTempQa(v.temp_qa),
  };
}

/**
 * Request body → argv; null when invalid. Exactly one of `pct` (RAM threshold: an integer 30..95, or null = off),
 * `cpu` (CPU threshold: an integer 30..95), `cap` (an integer 10..90, or null = off) or `eco` (boolean). Only a
 * validated integer or a literal reaches argv.
 */
export function guardArgv(body: unknown): string[] | null {
  if (!obj(body) || ["pct", "cpu", "cap", "eco"].filter((k) => k in body).length !== 1) return null;
  if ("eco" in body) return typeof body.eco === "boolean" ? ["ccc", "auto", "guard", "eco", body.eco ? "on" : "off"] : null;
  if ("cpu" in body) {
    const c = body.cpu;
    if (!Number.isInteger(c) || (c as number) < GUARD_MIN || (c as number) > GUARD_MAX) return null;
    return ["ccc", "auto", "guard", "cpu", String(c)];
  }
  if ("cap" in body) {
    const c = body.cap;
    if (c === null) return ["ccc", "auto", "guard", "cap", "off"];
    if (!Number.isInteger(c) || (c as number) < CAP_MIN || (c as number) > CAP_MAX) return null;
    return ["ccc", "auto", "guard", "cap", String(c)];
  }
  const p = body.pct;
  if (p === null) return ["ccc", "auto", "guard", "off"];
  if (!Number.isInteger(p) || (p as number) < GUARD_MIN || (p as number) > GUARD_MAX) return null;
  return ["ccc", "auto", "guard", String(p)];
}

const SET_TIMEOUT_MS = 15_000;
const S = globalThis as typeof globalThis & { __hqGuardSetting?: boolean };

/** Set the threshold, off, or eco. One change at a time: a second request while one runs is refused, never queued. */
export async function setGuard(argv: string[]): Promise<{ ok: boolean; message: string }> {
  if (S.__hqGuardSetting) return { ok: false, message: "Đang đổi cài đặt bảo vệ máy, thử lại sau vài giây" };
  S.__hqGuardSetting = true;
  try {
    const r = await run("8sync", argv, SET_TIMEOUT_MS);
    const line = (s: string) => s.trim().replace(/^Error:\s*/, "").split(/\r?\n/)[0]?.slice(0, STR_MAX) ?? "";
    if (r.ok) return { ok: true, message: line(r.stdout) || "Đã lưu cài đặt bảo vệ máy" };
    return { ok: false, message: line(r.stderr) || line(r.stdout) || `8sync ${argv.join(" ")} không chạy được` };
  } finally {
    S.__hqGuardSetting = false;
  }
}
