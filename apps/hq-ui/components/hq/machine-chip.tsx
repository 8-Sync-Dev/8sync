"use client";

import type { ReactNode } from "react";
import type { Awake, AwakeHold } from "@/lib/server/awake";
import type { GuardRamSplit } from "@/lib/server/guard";
import type { GuardView } from "@/lib/server/guard-trigger";
import type { Sample } from "@/lib/server/history";
import type { Machine, Spec } from "@/lib/server/machine";
import type { Power } from "@/lib/server/power";
import type { SweepProject } from "@/lib/server/sweep";
import { cn } from "@/lib/utils";

/** GET /api/machine: the load snapshot plus power (null before the sampler runs), awake and guard (null on an older 8sync), what the machine is, each running team's "Dọn máy tự động" (absent on an older HQ), and the last 30 min of RAM / CPU / watts (absent before v0.110.33). */
export type MachineView = Machine & { power: Power | null; awake: Awake | null; spec: Spec | null; guard: GuardView | null; sweep?: SweepProject[]; history?: Sample[] };

export const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
/** The guard's RAM attribution (8sync ≥ the trim): "phòng 12.3 GB · omp/8sync 2.8 GB · app khác 20.1 GB (Edge 2.8 GB · ChatGPT 2.2 GB)" + the no-way-out hint. */
export function ramSplitText(s: GuardRamSplit): string {
  const top = s.top.length ? ` (${s.top.map((t) => `${t.name} ${gb(t.mb)}`).join(" · ")})` : "";
  const hint = s.stuck ? " — ngưỡng không đạt được bằng dọn phòng: hạ app khác hoặc nâng ngưỡng" : "";
  return `phòng ${gb(s.rooms_mb)} · omp/8sync ${gb(s.omp_mb)} · app khác ${gb(s.other_mb)}${top}${hint}`;
}
export const pctOf = (used: number, total: number) => (total > 0 ? Math.round((100 * used) / total) : 0);
export const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ₫`;
export const energy = (wh: number) => (wh < 1000 ? `${Math.round(wh)} Wh` : `${(wh / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} kWh`);
export const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
/** "19/10 05:30". */
export const dayTime = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hhmm(ms)}`;
};

/** "6 giờ 9 phút", "12 phút", "dưới 1 phút". */
export function span(s: number): string {
  const m = Math.floor(s / 60);
  if (m < 1) return "dưới 1 phút";
  const h = Math.floor(m / 60);
  return h ? `${h} giờ${m % 60 ? ` ${m % 60} phút` : ""}` : `${m} phút`;
}

/** Calm until it matters: amber from 75 %, red from 90 %. */
export function level(pct: number | null): "ok" | "warn" | "hot" {
  return pct == null || pct < 75 ? "ok" : pct < 90 ? "warn" : "hot";
}

const tone = { ok: "bg-st-running", warn: "bg-st-needs", hot: "bg-destructive" } as const;
export const text = { ok: "text-foreground", warn: "text-st-needs", hot: "text-destructive" } as const;

export function Bar({ pct, l }: { pct: number | null; l: "ok" | "warn" | "hot" }) {
  return (
    <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className={cn("block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", tone[l])} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
    </span>
  );
}

export function Meter({ label, pct, detail }: { label: string; pct: number | null; detail: string }) {
  const l = level(pct);
  return (
    <div className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Bar pct={pct} l={l} />
      <span className={cn("tabular", text[l])}>
        {pct == null ? "…" : `${pct}%`} <span className="text-muted-foreground">· {detail}</span>
      </span>
    </div>
  );
}

/** `points` for one series: x over the chart width by time inside the window, y = pct of height. */
function polyline(samples: readonly Sample[], pick: (s: Sample) => number | null, from: number, to: number, w: number, h: number): string {
  const span = Math.max(1, to - from);
  return samples
    .map((s) => {
      const v = pick(s);
      return v == null ? null : `${(((s.at - from) / span) * w).toFixed(1)},${(h - (Math.min(100, Math.max(0, v)) / 100) * h).toFixed(1)}`;
    })
    .filter((p): p is string => p != null)
    .join(" ");
}

const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : null);

/**
 * "Tải máy" over the last 30 minutes (owner 2026-10-21: "chưa có đồ thị"): RAM and CPU as two lines
 * on one 0–100 % scale, the guard's RAM threshold as a rule when there is one, watts as a range. One
 * point per 30 s from the server loop (lib/server/history.ts), so it is full even if no tab was open.
 */
export function LoadChart({ samples, now, guardPct, windowMs = 30 * 60_000 }: { samples: readonly Sample[]; now: number; guardPct: number | null; windowMs?: number }) {
  const W = 300;
  const H = 56;
  const from = now - windowMs;
  const recent = samples.filter((s) => s.at >= from && s.at <= now);
  const rams = recent.map((s) => s.ram);
  const cpus = recent.flatMap((s) => (s.cpu == null ? [] : [s.cpu]));
  const watts = recent.flatMap((s) => (s.w == null ? [] : [Math.round(s.w)]));
  if (recent.length < 2) {
    return <p className="text-xs text-muted-foreground">30 phút qua: đang thu mẫu, mỗi 30 giây một điểm.</p>;
  }
  const label = `30 phút qua: RAM ${range(rams)}%, CPU ${range(cpus) ?? "…"}%${watts.length ? `, ${range(watts)} W` : ""}`;
  return (
    <figure className="space-y-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-14 w-full" role="img" aria-label={label}>
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} className="stroke-border" strokeWidth="1" />
        {guardPct != null && <line x1="0" y1={H - (guardPct / 100) * H} x2={W} y2={H - (guardPct / 100) * H} className="stroke-st-needs/60" strokeWidth="1" strokeDasharray="3 3" />}
        <polyline points={polyline(recent, (s) => s.cpu, from, now, W, H)} fill="none" className="stroke-muted-foreground" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={polyline(recent, (s) => s.ram, from, now, W, H)} fill="none" className="stroke-st-running" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-st-running" aria-hidden />
          RAM <span className="tabular text-foreground">{range(rams)}%</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-muted-foreground" aria-hidden />
          CPU <span className="tabular text-foreground">{range(cpus) ?? "…"}%</span>
        </span>
        {watts.length > 0 && (
          <span>
            Điện <span className="tabular text-foreground">{range(watts)} W</span>
          </span>
        )}
        {guardPct != null && <span className="ml-auto">nét đứt: ngưỡng RAM {guardPct}%</span>}
        <span className={cn(guardPct == null && "ml-auto")}>30 phút qua</span>
      </figcaption>
    </figure>
  );
}

export function Row({ k, children, warn }: { k: string; children: ReactNode; warn?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-xs">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("min-w-0 tabular", warn && "text-st-needs")}>{children}</dd>
    </div>
  );
}

/** The busiest of RAM / CPU / GPU, 0-100. */
export function worstLoad(m: Machine): { ram: number; gpu: number | null; worst: number } {
  const ram = pctOf(m.mem.usedMb, m.mem.totalMb);
  const g = m.gpus?.[0];
  const gpu = g ? Math.max(g.util, pctOf(g.memUsed, g.memTotal)) : null;
  return { ram, gpu, worst: Math.max(ram, m.cpu.pct ?? 0, gpu ?? 0) };
}

/**
 * Header chip "Máy": the busiest of RAM / CPU / GPU and the watts at a glance; a tap opens the Máy tab.
 * `compact` (phones, end of the tab row): the load over the watts, without the word, ~44 px wide.
 */
export function MachineChip({ m, onOpen, compact }: { m: MachineView | null; onOpen: () => void; compact?: boolean }) {
  if (!m) return null;
  const { ram, gpu, worst } = worstLoad(m);
  const l = level(worst);
  const w = m.power?.live ? Math.round(m.power.live.w) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={compact ? "Máy" : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-md px-1.5 text-xs whitespace-nowrap text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/70 sm:min-h-8 motion-reduce:transition-none",
        compact ? "min-w-11 flex-col justify-center gap-0 leading-tight" : "gap-1.5",
      )}
      aria-label={`Máy: RAM ${ram}%, CPU ${m.cpu.pct ?? "…"}%${gpu != null ? `, GPU ${gpu}%` : ""}${w != null ? `, ${w} W` : ""}${m.power?.over ? ", vượt ngân sách điện" : ""}. Mở tab Máy`}
    >
      {!compact && <span>Máy</span>}
      <span className={cn("text-sm font-medium tabular", text[l])}>{worst}%</span>
      {w != null && <span className={cn("tabular", compact && "text-[11px]", m.power?.over ? "text-destructive" : "text-foreground")}>{w} W</span>}
    </button>
  );
}

/** When our hold lets go: `until` 0 = never (until the switch), `while_rooms` = when the last room ends. */
export function holdLine(o: AwakeHold): string {
  const by = o.until > 0 ? dayTime(o.until * 1000) : null;
  if (o.while_rooms) return by ? `Đang giữ: tự nhả khi hết phòng, chậm nhất ${by}` : "Đang giữ: tự nhả khi hết phòng";
  return by ? `Đang giữ tới khi anh tắt, chậm nhất ${by}` : "Đang giữ tới khi anh tắt";
}
