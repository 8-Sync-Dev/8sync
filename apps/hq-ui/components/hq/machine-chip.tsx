"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Machine } from "@/lib/server/machine";
import { cn } from "@/lib/utils";
import type { Hq } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 5_000;

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const pctOf = (used: number, total: number) => (total > 0 ? Math.round((100 * used) / total) : 0);

/** Calm until it matters: amber from 75 %, red from 90 %. */
export function level(pct: number | null): "ok" | "warn" | "hot" {
  return pct == null || pct < 75 ? "ok" : pct < 90 ? "warn" : "hot";
}

const tone = { ok: "bg-st-running", warn: "bg-st-needs", hot: "bg-destructive" } as const;
const text = { ok: "text-foreground", warn: "text-st-needs", hot: "text-destructive" } as const;

function Meter({ label, pct, detail }: { label: string; pct: number | null; detail: string }) {
  const l = level(pct);
  return (
    <div className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", tone[l])} style={{ width: `${pct ?? 0}%` }} />
      </span>
      <span className={cn("tabular", text[l])}>
        {pct == null ? "…" : `${pct}%`} <span className="text-muted-foreground">· {detail}</span>
      </span>
    </div>
  );
}

/** Header chip "Máy": the busiest of RAM / CPU / GPU at a glance; the panel has the rest. */
export function MachineChip({ api }: { api: Hq["api"] }) {
  const [open, setOpen] = useState(false);
  const m = usePoll<Machine>(api, "/api/machine", POLL_MS, true).data;
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!m) return null;

  const ram = pctOf(m.mem.usedMb, m.mem.totalMb);
  const gpu = m.gpus?.[0];
  const gpuPct = gpu ? Math.max(gpu.util, pctOf(gpu.memUsed, gpu.memTotal)) : null;
  const worst = Math.max(ram, m.cpu.pct ?? 0, gpuPct ?? 0);
  const l = level(worst);

  async function runClean(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api<{ report: string }>("/api/machine/clean", { method: "POST", body: { dryRun } });
      setReport(r.report);
      if (!dryRun) toast.success("Đã dọn an toàn (không đụng model, browser, cache gói)");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-baseline gap-1.5 rounded-md px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Máy: RAM ${ram}%, CPU ${m.cpu.pct ?? "…"}%${gpuPct != null ? `, GPU ${gpuPct}%` : ""}`}
        >
          <span>Máy</span>
          <span className={cn("text-sm font-medium tabular", text[l])}>{worst}%</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] space-y-3 p-3">
        <div className="space-y-2">
          <Meter label="RAM" pct={ram} detail={`${gb(m.mem.usedMb)} / ${gb(m.mem.totalMb)}`} />
          <Meter label="CPU" pct={m.cpu.pct} detail={`${m.cpu.cores} luồng`} />
          {m.gpus?.map((g, i) => (
            <Meter key={i} label={m.gpus!.length > 1 ? `GPU ${i}` : "GPU"} pct={g.util} detail={`VRAM ${(g.memUsed / 1024).toFixed(1)}/${(g.memTotal / 1024).toFixed(1)} GB${g.temp != null ? ` · ${g.temp}°C` : ""}`} />
          ))}
          {m.gpus == null && <p className="text-xs text-muted-foreground">Không thấy GPU NVIDIA (nvidia-smi).</p>}
        </div>
        {m.procs && (
          <dl className="grid grid-cols-2 gap-2 border-t pt-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Claude Code</dt>
              <dd className="tabular">{m.procs.claude.n} tiến trình · {gb(m.procs.claude.mb)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Node (MCP, LSP, dev)</dt>
              <dd className="tabular">{m.procs.node.n} tiến trình · {gb(m.procs.node.mb)}</dd>
            </div>
          </dl>
        )}
        <div className="space-y-2 border-t pt-2">
          {m.canClean ? (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void runClean(true)}>
                Xem trước
              </Button>
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void runClean(false)}>
                Dọn an toàn
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Dọn máy (<code className="font-mono">8sync clean</code>) chỉ chạy trên Linux. Helper chạy quá tay có <code className="font-mono">8sync watchdog</code> canh.
            </p>
          )}
          {report && <pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap">{report}</pre>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
