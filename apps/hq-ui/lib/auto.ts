// Pure helpers for the Pause / Run control (`8sync ccc auto status --json`, served by /api/auto).
// Tested in tests/auto-ui.test.ts.
import { groupKey } from "./sidebar";

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
  /** Why 8sync keeps the omp team off (omp on the anthropic provider); null when not blocked. */
  omp_blocked?: string | null;
  /** The last "Đội omp" switch failed (8sync's reason). */
  omp_error?: string;
  /** Public tunnel host while `8sync hq ui --public` runs, else null (server-side; the key never leaves the server). */
  remote?: { host: string | null };
  /** GitHub CI of the project (`8sync ccc auto ci`): "ok" | "failing" | "billing" | "local" | "unknown". */
  ci?: string;
  /** "Lease liên tục" on (`8sync ccc auto lease auto on`); absent on an older 8sync. */
  lease_auto?: boolean;
  /** Why auto rests and until when (unix s); null while it runs. */
  lease_rest?: LeaseRest | null;
  subscription?: unknown;
  /** The lease's $/hour budget (API key). */
  usd_per_hour?: number | null;
  /** Usage tight and projects pinned: only those work. */
  focus?: boolean;
  pins?: string[];
  /** The last "Lease liên tục" switch failed (8sync's reason). */
  lease_error?: string;
};

/** `lease_rest` of `8sync ccc auto status --json`. */
export type LeaseRest = { kind: "usage" | "budget" | "lease"; text: string; window?: "5h" | "7d"; pct?: number; until?: number | null };

/**
 * Rooms wait on the owner while the critic is off: auto paused or off, or delegate switched off.
 * Seen live 2026-10-18: auto was paused, so 7 rooms sat on questions the owner expected the critic
 * to take. A question already on screen stays with the owner even after the critic is back.
 */
export function criticNote(s: (AutoState & { delegate?: boolean }) | null): string | null {
  if (!s || s.error) return null;
  if (s.on && s.delegate !== false) return null;
  const why = s.paused ? "auto đang tạm dừng" : !s.on ? "auto đang tắt" : "critic đang tắt";
  return `Critic không trả lời thay (${why}). Bấm “Chạy liên tục” ở Văn phòng: câu hỏi mới được trả lời sau 60 s; câu đang hiện ở đây vẫn cần anh chọn.`;
}

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

export function autoText(s: AutoState, now = Date.now()): string {
  if (s.error) return noVerb(s.error) ? "8sync chưa có lệnh auto — chạy 8sync up" : `Không đọc được trạng thái auto: ${s.error}`;
  if (s.paused) return "Tạm dừng (owner)";
  if (s.on) {
    const t = leaseMs(s.lease_until);
    if (s.gate) {
      if (s.lease_rest?.kind === "usage") return restText(s.lease_rest);
      return t && t < now ? "Lease hết hạn — bấm Chạy liên tục để gia hạn" : `Đang nghỉ: ${s.gate}`;
    }
    // GitHub stopped running jobs for the account: the owner has to fix billing; rooms already gate locally.
    // `local`: the owner moved CI/CD to the release machine (`8sync ccc auto ci local`).
    const ci =
      s.ci === "billing"
        ? " · CI dừng: GitHub billing (Settings → Billing)"
        : s.ci === "local"
          ? " · CI: máy release (GitHub chỉ lưu code)"
          : "";
    return `${t ? `Luôn chạy · lease tới ${hhmm(t)}` : "Luôn chạy"}${ci}`;
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

/** "nghỉ: usage 5h 91% · chạy lại khi reset 16:30" (local time), "· chờ usage" when the reset time is unknown. */
export function restText(r: LeaseRest): string {
  if (r.kind !== "usage") return `nghỉ: ${r.text}`;
  const at = leaseMs(r.until ?? null);
  return `nghỉ: usage ${r.window ?? "5h"} ${Math.round(r.pct ?? 0)}% · ${at ? `chạy lại khi reset ${hhmm(at)}` : "chờ usage"}`;
}

/** The line beside the "Lease liên tục" switch; null while it is off (or 8sync has no such switch). */
export function leaseText(s: AutoState): string | null {
  if (s.error || !s.lease_auto) return null;
  if (s.lease_rest?.kind === "usage") return restText(s.lease_rest);
  const focus = s.focus ? " · usage chặt: chỉ dự án ghim chạy" : "";
  if (s.subscription === true) return `tự gia hạn mỗi lần anh dùng HQ (gói subscription: cần anh có mặt)${focus}`;
  const rate = typeof s.usd_per_hour === "number" ? s.usd_per_hour : 5;
  return `tự gia hạn · ngân sách $${Number.isInteger(rate) ? rate : rate.toFixed(2)}/h${focus}`;
}

/** A room in `root` rests to leave the usage to the pinned projects (same rule as 8sync's `focus_rest`). */
export function focusRests(s: Pick<AutoState, "focus" | "pins">, root: string | null | undefined): boolean {
  if (!s.focus || !s.pins?.length || !root) return false;
  const k = groupKey(root);
  return !s.pins.some((p) => groupKey(p) === k);
}
