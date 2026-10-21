// "Máy" tab: how loaded this machine is while the rooms run. RAM and CPU from Node; GPU from
// `nvidia-smi` when there is one; how much RAM Claude Code and Node processes hold, from `tasklist`
// (Windows) or `ps` (macOS, Linux). argv only, short timeouts, a failed probe is just left out.
// `spec()`: what the machine is (CPU, RAM, GPU, OS), read once per HQ process.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { coreGet } from "./core";

const TIMEOUT_MS = 4_000;
/** `8sync clean` can take minutes (package caches, journal). */
const CLEAN_TIMEOUT_MS = 300_000;

export type Gpu = { name: string; util: number; memUsed: number; memTotal: number; temp: number | null };
export type ProcGroup = { n: number; mb: number };
export type Machine = {
  platform: NodeJS.Platform;
  mem: { totalMb: number; usedMb: number };
  cpu: { cores: number; pct: number | null };
  gpus: Gpu[] | null;
  procs: { claude: ProcGroup; node: ProcGroup } | null;
  /** `8sync clean` only does something on Linux. */
  canClean: boolean;
  at: number;
};

type Times = { idle: number; total: number };

export function cpuTimes(cpus: os.CpuInfo[] = os.cpus()): Times {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

/** Busy share between two samples, 0-100; null when there is no gap to measure. */
export function cpuPct(a: Times, b: Times): number | null {
  const total = b.total - a.total;
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((100 * (total - (b.idle - a.idle))) / total)));
}

/** `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits` */
export function parseNvidiaSmi(out: string): Gpu[] {
  const gpus: Gpu[] = [];
  for (const line of out.split(/\r?\n/)) {
    const f = line.split(",").map((s) => s.trim());
    if (f.length < 5 || !f[0]) continue;
    const n = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : null);
    const [util, used, total] = [n(f[1]), n(f[2]), n(f[3])];
    if (util == null || used == null || total == null) continue;
    gpus.push({ name: f[0].slice(0, 60), util, memUsed: used, memTotal: total, temp: n(f[4]) });
  }
  return gpus;
}

const kind = (name: string): "claude" | "node" | null => {
  const b = name.toLowerCase().replace(/^.*[\\/]/, "").replace(/\.exe$/, "");
  return b === "claude" ? "claude" : b === "node" ? "node" : null;
};

function add(g: { claude: ProcGroup; node: ProcGroup }, name: string, kb: number) {
  const k = kind(name);
  if (!k || !Number.isFinite(kb)) return;
  g[k].n += 1;
  g[k].mb += kb / 1024;
}

const round = (g: { claude: ProcGroup; node: ProcGroup }) => ({
  claude: { n: g.claude.n, mb: Math.round(g.claude.mb) },
  node: { n: g.node.n, mb: Math.round(g.node.mb) },
});

/** `tasklist /FO CSV /NH`: "claude.exe","123","Console","1","245,312 K" (thousands separator varies by locale). */
export function parseTasklist(out: string) {
  const g = { claude: { n: 0, mb: 0 }, node: { n: 0, mb: 0 } };
  for (const line of out.split(/\r?\n/)) {
    const f = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (f.length < 5) continue;
    add(g, f[0], Number(f[4].replace(/[^\d]/g, "")));
  }
  return round(g);
}

/** `ps -A -o rss=,comm=`: "245312 /usr/local/bin/node". */
export function parsePs(out: string) {
  const g = { claude: { n: 0, mb: 0 }, node: { n: 0, mb: 0 } };
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) add(g, m[2], Number(m[1]));
  }
  return round(g);
}

export type Exec = (cmd: string, args: string[], timeoutMs?: number) => Promise<string | null>;

export const exec: Exec = (cmd, args, timeoutMs = TIMEOUT_MS) =>
  new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
    } catch {
      resolve(null);
    }
  });

let last: Times | null = null;

type CoreMachine = Pick<Machine, "cpu" | "gpus" | "procs" | "at"> & { mem: Machine["mem"] | null };

/**
 * One snapshot. CPU is the busy share since the previous call (the first call samples 250 ms).
 * With the core: its sampler's reading (Toolhelp + NVML in process, no tasklist / nvidia-smi).
 * `procs: false` (the guard trigger's 5 s loop) skips the tasklist / ps probe.
 */
export async function machine(platform: NodeJS.Platform = process.platform, run: Exec = exec, procs = true): Promise<Machine> {
  const c = (await coreGet("/v1/machine"))?.v as CoreMachine | undefined;
  if (c?.cpu) {
    const totalMb = Math.round(os.totalmem() / 2 ** 20);
    const mem = c.mem ?? { totalMb, usedMb: totalMb - Math.round(os.freemem() / 2 ** 20) };
    return { platform, mem, cpu: c.cpu, gpus: c.gpus, procs: c.procs, canClean: platform === "linux", at: c.at };
  }
  let prev = last;
  if (!prev) {
    prev = cpuTimes();
    await new Promise((r) => setTimeout(r, 250));
  }
  const now = cpuTimes();
  last = now;
  const [smi, list] = await Promise.all([
    run("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"]),
    !procs ? null : platform === "win32" ? run("tasklist", ["/FO", "CSV", "/NH"]) : run("ps", ["-A", "-o", "rss=,comm="]),
  ]);
  const totalMb = Math.round(os.totalmem() / 2 ** 20);
  return {
    platform,
    mem: { totalMb, usedMb: totalMb - Math.round(os.freemem() / 2 ** 20) },
    cpu: { cores: os.cpus().length, pct: cpuPct(prev, now) },
    gpus: smi == null ? null : parseNvidiaSmi(smi),
    procs: list == null ? null : platform === "win32" ? parseTasklist(list) : parsePs(list),
    canClean: platform === "linux",
    at: Date.now(),
  };
}

/** `8sync clean` (safe reclaim + report; Linux only). Never `--deep`, `--ram` or a timer from the page. */
export async function clean(dryRun: boolean, run: Exec = exec): Promise<string | null> {
  // One at a time: a double click must not start two cleans.
  if (cleaning) return cleaning;
  cleaning = run("8sync", dryRun ? ["clean", "--dry-run"] : ["clean"], CLEAN_TIMEOUT_MS).finally(() => {
    cleaning = null;
  });
  return cleaning;
}

let cleaning: Promise<string | null> | null = null;

export type Spec = {
  cpu: { model: string; cores: number | null; threads: number };
  memTotalMb: number;
  gpus: { name: string; vramMb: number }[] | null;
  os: { name: string; version: string; arch: string };
};

/** Windows 11 keeps "Windows 10" in the registry name `os.version()` reads; build 22000+ is 11. */
export function windowsName(version: string, release: string): string {
  const build = Number(release.split(".")[2] ?? 0);
  return build >= 22000 ? version.replace(/^Windows 10\b/, "Windows 11") : version;
}

/** Physical cores: a number from PowerShell / sysctl, or `lscpu -p=core,socket` rows (unique pairs). */
export function parseCores(platform: NodeJS.Platform, out: string | null): number | null {
  if (out == null) return null;
  if (platform === "linux") {
    const pairs = new Set(out.split(/\r?\n/).filter((l) => /^\d+,\d+$/.test(l.trim())).map((l) => l.trim()));
    return pairs.size || null;
  }
  const n = Number(out.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` */
export function parseGpuSpec(out: string): { name: string; vramMb: number }[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.split(",").map((s) => s.trim()))
    .filter((f) => f.length >= 2 && f[0] && /^\d+$/.test(f[1]))
    .map((f) => ({ name: f[0].slice(0, 60), vramMb: Number(f[1]) }));
}

function prettyLinux(): string | null {
  try {
    return /^PRETTY_NAME="?([^"\n]+)"?/m.exec(fs.readFileSync("/etc/os-release", "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

async function readSpec(platform: NodeJS.Platform, run: Exec): Promise<Spec> {
  const cpus = os.cpus();
  const [cores, smi, mac] = await Promise.all([
    platform === "win32"
      ? run("powershell", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum"], 15_000)
      : platform === "darwin"
        ? run("sysctl", ["-n", "hw.physicalcpu"])
        : run("lscpu", ["-p=core,socket"]),
    run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]),
    platform === "darwin" ? run("sw_vers", ["-productVersion"]) : Promise.resolve(null),
  ]);
  const name =
    platform === "win32" ? windowsName(os.version(), os.release()) : platform === "darwin" ? `macOS ${mac?.trim() ?? ""}`.trim() : (prettyLinux() ?? os.version());
  return {
    cpu: { model: (cpus[0]?.model ?? "").replace(/\s+/g, " ").trim(), cores: parseCores(platform, cores), threads: cpus.length },
    memTotalMb: Math.round(os.totalmem() / 2 ** 20),
    gpus: smi == null ? null : parseGpuSpec(smi),
    os: { name, version: os.release(), arch: os.arch() },
  };
}

let specOnce: Promise<Spec> | null = null;

/** What this machine is; read once (the hardware doesn't change under a running HQ). */
export function spec(platform: NodeJS.Platform = process.platform, run: Exec = exec): Promise<Spec> {
  specOnce ??= readSpec(platform, run);
  return specOnce;
}
