// Tự cập nhật (owner 2026-11-07: "auto release để web HQ luôn xài bản mới nhất"). Every CHECK_MS the
// installed HQ asks GitHub for the latest release tag (the `releases/latest` redirect: no API rate
// limit) and, when it is newer than the installed binary, runs `8sync up`. From there the existing
// chain takes over: `8sync hq ui` sees its binary replaced and restarts on it (a `--public` /
// `--tailnet` run swaps only node onto the new UI, the link stays), and an open page reloads on
// the new UI version. Living in the node server rather than in `8sync hq ui` is deliberate: node is
// what every HQ ≥ 0.102 already swaps on an update, while a long-running `--tailnet` supervisor
// keeps its old binary code for days. A dev checkout (no `<ver>/VERSION`) never updates.
import fs from "node:fs";
import path from "node:path";
import { run8, type Run8 } from "./machine";
import { configDir } from "./paths";
import { parseBinaryVersion, uiVersion } from "./version";

export const CHECK_MS = 10 * 60_000;
const FIRST_MS = 3 * 60_000;
const TAG_TIMEOUT_MS = 8_000;
const UP_TIMEOUT_MS = 10 * 60_000;
const LATEST_URL = "https://github.com/8-Sync-Dev/8sync/releases/latest";

export type UpdateConfig = { on: boolean };
export const UPDATE_DEFAULT: UpdateConfig = { on: true };
export type UpdateStatus = {
  /** Why it never updates here (dev checkout, env opt-out), or null. */
  blocked: string | null;
  checkedAt: number | null;
  nextAt: number | null;
  latest: string | null;
  binary: string | null;
  ui: string | null;
  running: boolean;
  /** The last `8sync up` this server ran. */
  lastUp: { at: number; from: string | null; to: string; ok: boolean; tail: string } | null;
  error: string | null;
};

export const updateFile = () => path.join(configDir(), "auto-update.json");
/** The last `8sync up` HQ ran: it outlives the restart that update causes, so the panel can say what happened. */
export const lastUpFile = () => path.join(configDir(), "auto-update-last.json");

type LastUp = NonNullable<UpdateStatus["lastUp"]>;

export function readLastUp(file = lastUpFile()): LastUp | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LastUp>;
    return typeof v.at === "number" && typeof v.to === "string" && typeof v.ok === "boolean" ? { at: v.at, from: typeof v.from === "string" ? v.from : null, to: v.to, ok: v.ok, tail: typeof v.tail === "string" ? v.tail : "" } : null;
  } catch {
    return null;
  }
}

export function readUpdate(file = updateFile()): UpdateConfig {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return { on: v && typeof v === "object" && typeof (v as { on?: unknown }).on === "boolean" ? (v as { on: boolean }).on : UPDATE_DEFAULT.on };
  } catch {
    return { ...UPDATE_DEFAULT };
  }
}

function writeJson(file: string, v: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(v, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function writeUpdate(cfg: UpdateConfig, file = updateFile()): void {
  writeJson(file, cfg);
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** `a` strictly newer than `b` (semver; a pre-release sorts before its release). Junk is never newer. */
export function newer(a: string | null, b: string | null): boolean {
  const x = a ? SEMVER.exec(a.replace(/^v/, "")) : null;
  const y = b ? SEMVER.exec(b.replace(/^v/, "")) : null;
  if (!x) return false;
  if (!y) return true;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d > 0;
  }
  if (x[4] === y[4]) return false;
  if (!x[4]) return true;
  if (!y[4]) return false;
  return x[4] > y[4];
}

/** `…/releases/tag/v0.135.0` → "0.135.0"; null for anything else. */
export function tagOf(location: string | null): string | null {
  const m = location ? /\/releases\/tag\/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\/?$/.exec(location) : null;
  return m ? m[1] : null;
}

export type UpdateDeps = {
  latest: () => Promise<string | null>;
  binary: () => Promise<string | null>;
  run: Run8;
  /** Keep the last `8sync up` across the restart it causes. */
  saveLastUp: (u: LastUp) => void;
  /** Why this HQ never updates (null: it may). */
  blocked: () => string | null;
  on: () => boolean;
};

async function latestTag(): Promise<string | null> {
  try {
    const r = await fetch(LATEST_URL, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(TAG_TIMEOUT_MS) });
    return tagOf(r.headers.get("location"));
  } catch {
    return null;
  }
}

const liveDeps = (): UpdateDeps => ({
  latest: latestTag,
  // Uncached on purpose: version.ts caches a minute, and right after `8sync up` that would say "old".
  binary: async () => {
    const r = await run8(["--version"], 5_000);
    return r.ok ? parseBinaryVersion(r.stdout) : null;
  },
  run: run8,
  saveLastUp: (u) => writeJson(lastUpFile(), u),
  blocked: () => blockedWhy(),
  on: () => readUpdate().on,
});

type State = { timer: ReturnType<typeof setInterval> | null; running: Promise<UpdateStatus> | null; s: Omit<UpdateStatus, "blocked" | "nextAt" | "ui" | "running"> };
/** On `globalThis`: instrumentation.ts and the route handlers are separate bundles. */
const g = globalThis as unknown as { __hqUpdate?: State };
const S: State = (g.__hqUpdate ??= { timer: null, running: null, s: { checkedAt: null, latest: null, binary: null, lastUp: readLastUp(), error: null } });

/** Why this server never updates the binary, or null. */
export function blockedWhy(env: Record<string, string | undefined> = process.env, ui = uiVersion()): string | null {
  if (!ui) return "HQ chạy từ mã nguồn (dev), không phải bản cài";
  if (env.SUSYNC_NO_AUTO_UPDATE) return "SUSYNC_NO_AUTO_UPDATE đang bật";
  if (/^(1|true)$/i.test(env.EIGHTSYNC_OFFLINE ?? "")) return "EIGHTSYNC_OFFLINE đang bật";
  return null;
}

const tail = (s: string) => s.trim().split(/\r?\n/).slice(-3).join("\n").slice(-400);

/** One check: fetch the latest tag, run `8sync up` when it is newer than the installed binary. */
async function check(d: UpdateDeps, now: () => number): Promise<void> {
  const [latest, binary] = await Promise.all([d.latest(), d.binary()]);
  S.s.checkedAt = now();
  S.s.binary = binary;
  if (!latest) {
    S.s.error = "Không đọc được bản mới nhất trên GitHub (mất mạng?) — thử lại lượt sau";
    return;
  }
  S.s.latest = latest;
  S.s.error = null;
  if (!newer(latest, binary)) return;
  const r = await d.run(["up"], UP_TIMEOUT_MS);
  const after = await d.binary();
  S.s.binary = after;
  const ok = r.ok && after === latest;
  S.s.lastUp = { at: now(), from: binary, to: latest, ok, tail: tail(`${r.stdout}\n${r.stderr}`) };
  d.saveLastUp(S.s.lastUp);
  if (!ok) S.s.error = `8sync up chưa lên được v${latest} (đang ${after ?? "?"}) — thử lại lượt sau`;
}

/** Run a check unless one is running (a second caller waits for the same one). `force`: even when off. */
export function updateNow(force = false, deps: Partial<UpdateDeps> = {}, now: () => number = Date.now): Promise<UpdateStatus> {
  if (S.running) return S.running;
  const d = { ...liveDeps(), ...deps };
  if (d.blocked() || (!force && !d.on())) return Promise.resolve(updateStatus());
  S.running = check(d, now)
    .catch((e: unknown) => {
      S.s.error = `Lỗi khi kiểm cập nhật: ${e instanceof Error ? e.message : String(e)}`;
    })
    .then(() => updateStatus())
    .finally(() => {
      S.running = null;
    });
  return S.running;
}

export function updateStatus(): UpdateStatus {
  const blocked = blockedWhy();
  const on = readUpdate().on;
  return {
    ...S.s,
    blocked,
    ui: uiVersion(),
    running: S.running !== null,
    nextAt: blocked || !on || !S.timer ? null : (S.s.checkedAt ?? Date.now()) + CHECK_MS,
  };
}

/** Test hook: forget what earlier checks saw. */
export function updateReset(): void {
  S.running = null;
  S.s = { checkedAt: null, latest: null, binary: null, lastUp: null, error: null };
}

export function startAutoUpdate(): void {
  if (S.timer || blockedWhy()) return;
  // The installed binary at once, so the panel does not say "8sync ?" until the first check.
  void liveDeps()
    .binary()
    .then((v) => {
      S.s.binary ??= v;
    });
  const first = setTimeout(() => void updateNow(), FIRST_MS);
  first.unref?.();
  S.timer = setInterval(() => void updateNow(), CHECK_MS);
  S.timer.unref?.();
}
