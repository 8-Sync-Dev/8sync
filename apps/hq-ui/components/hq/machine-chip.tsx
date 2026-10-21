"use client";

import type { ReactNode } from "react";
import type { Awake } from "@/lib/server/awake";
import type { GuardView } from "@/lib/server/guard-trigger";
import type { Machine, Spec } from "@/lib/server/machine";
import type { Power } from "@/lib/server/power";
import { cn } from "@/lib/utils";

/** GET /api/machine: the load snapshot plus power (null before the sampler runs), awake and guard (null on an older 8sync) and what the machine is. */
export type MachineView = Machine & { power: Power | null; awake: Awake | null; spec: Spec | null; guard: GuardView | null };

export const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
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
