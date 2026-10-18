// Pure helpers for the Pause / Run control (`8sync ccc auto status --json`, served by /api/auto).
// Tested in tests/auto-ui.test.ts.

export type AutoState = {
  on: boolean;
  paused: boolean;
  /** idle/delegate were switched on by hand (no auto marker): HQ must not clobber that lease. */
  manual?: boolean;
  /** Why idle is resting right now (lease expired, cost ceiling, owner away); null while running. */
  gate?: string | null;
  /** Unix seconds (8sync) or ms; both accepted. */
  lease_until?: number | null;
  error?: string;
  /** Running UI version vs. installed 8sync binary (server-side; null when unknown). */
  versions?: { ui: string | null; binary: string | null };
  /** Teams auto drives (`auto.json` `teams`, contract C4); absent = ["ccc"]. */
  teams?: string[];
  /** The last "Đội omp" switch failed (8sync's reason). */
  omp_error?: string;
  /** Public tunnel host while `8sync hq ui --public` runs, else null (server-side; the key never leaves the server). */
  remote?: { host: string | null };
};

/**
 * The page the owner looks at is older than the binary they just installed: say so, with the one
 * action that fixes it. A running `8sync hq ui` never swaps its UI by itself.
 */
export function staleText(s: AutoState): string | null {
  const v = s.versions;
  if (!v?.ui || !v.binary || v.ui === v.binary) return null;
  return `HQ đang chạy giao diện ${v.ui}, 8sync đã là ${v.binary} — Ctrl-C ở terminal \`8sync hq ui\` rồi chạy lại để lấy giao diện mới`;
}

/** The lease end in ms, from unix seconds or ms (anything below 1e12 is seconds). */
export function leaseMs(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return v < 1e12 ? v * 1000 : v;
}

/** Local "HH:MM" of a unix-ms time. */
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * HQ turns auto on by itself only when the owner never paused it, nothing was switched on by
 * hand, 8sync answered, and this page load has not tried yet (`started`): one attempt per load,
 * so an env override or a hand-off switch is never fought every minute.
 */
export function shouldAutoStart(s: AutoState, started = false): boolean {
  return !started && !s.on && !s.paused && !s.manual && !s.error;
}

/** 8sync has no `auto` verb (older binary) vs. any other failure (401, timeout, …). */
const noVerb = (e: string) => /không rõ|unknown|usage:|ENOENT|not found/i.test(e);

export function autoText(s: AutoState): string {
  if (s.error) return noVerb(s.error) ? "8sync chưa có lệnh auto — chạy 8sync up" : `Không đọc được trạng thái auto: ${s.error}`;
  if (s.paused) return "Tạm dừng (owner)";
  if (s.on) {
    const t = leaseMs(s.lease_until);
    if (s.gate) return t && t < Date.now() ? "Lease hết hạn — bấm Chạy liên tục để gia hạn" : `Đang nghỉ: ${s.gate}`;
    return t ? `Luôn chạy · lease tới ${hhmm(t)}` : "Luôn chạy";
  }
  if (s.manual) return "Idle/delegate bật tay — Chạy liên tục sẽ ghi đè";
  return "Đang tắt";
}

/** The button offers the opposite of the current state; null while 8sync has no auto command. */
export function autoButton(s: AutoState): { label: string; action: "on" | "pause" } | null {
  if (s.error) return null;
  // An expired lease is "on" on disk but resting: offer to run again (a fresh `auto on`).
  if (s.on && s.gate) return { label: "Chạy liên tục", action: "on" };
  return s.on ? { label: "Tạm dừng", action: "pause" } : { label: "Chạy liên tục", action: "on" };
}
