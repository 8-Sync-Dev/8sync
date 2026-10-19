"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Awake } from "@/lib/server/awake";
import type { Machine } from "@/lib/server/machine";
import type { Power, PowerSettings } from "@/lib/server/power";
import { cn } from "@/lib/utils";
import type { Hq } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 5_000;

/** GET /api/machine: the load snapshot plus power (null before the sampler runs) and awake (null on an older 8sync). */
export type MachineView = Machine & { power: Power | null; awake: Awake | null };

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const pctOf = (used: number, total: number) => (total > 0 ? Math.round((100 * used) / total) : 0);
export const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ₫`;
export const energy = (wh: number) => (wh < 1000 ? `${Math.round(wh)} Wh` : `${(wh / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} kWh`);
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
/** "19/10 05:30". */
const dayTime = (ms: number) => {
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
const text = { ok: "text-foreground", warn: "text-st-needs", hot: "text-destructive" } as const;

function Bar({ pct, l }: { pct: number | null; l: "ok" | "warn" | "hot" }) {
  return (
    <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className={cn("block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", tone[l])} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
    </span>
  );
}

function Meter({ label, pct, detail }: { label: string; pct: number | null; detail: string }) {
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

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1.5 border-t pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ k, children, warn }: { k: string; children: ReactNode; warn?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-xs">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("tabular", warn && "text-st-needs")}>{children}</dd>
    </div>
  );
}

const watts = (w: number | null, what: string, pending = false) => (w != null ? `${what} ${Math.round(w)} W đo` : pending ? `${what} đang đo` : `${what} không đo được (chưa tính)`);

function PowerSection({ p, api, onSaved }: { p: Power; api: Hq["api"]; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ price: "", other: "", budget: "" });
  const [busy, setBusy] = useState(false);
  const live = p.live;
  const budget = p.settings.budgetVnd;
  const used = budget ? Math.round((100 * p.today.vnd) / budget) : null;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const newBudget = form.budget.trim() === "" ? null : Number(form.budget);

  function open() {
    setForm({ price: String(p.settings.vndPerKwh), other: String(p.settings.otherW), budget: budget == null ? "" : String(budget) });
    setEdit(true);
  }

  async function save() {
    setBusy(true);
    try {
      const body: Partial<PowerSettings> = { vndPerKwh: Number(form.price), otherW: Number(form.other), budgetVnd: newBudget };
      await api("/api/machine/power", { method: "POST", body });
      setEdit(false);
      onSaved();
      toast.success(newBudget == null ? "Đã lưu, không giới hạn ngân sách" : `Đã lưu: ngân sách ${vnd(newBudget)} mỗi ngày`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Điện"
      aside={
        live ? (
          <span className="text-xs tabular">
            <span className="text-sm font-medium">{Math.round(live.w)} W</span> <span className="text-muted-foreground">· {vnd(p.vndPerHour ?? 0)}/giờ</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">đang đo…</span>
        )
      }
    >
      {live && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {watts(live.cpuW, "CPU", live.cpuCounter)} · {watts(live.gpuW, "GPU")} · còn lại {live.otherW} W ước tính
        </p>
      )}
      <dl className="space-y-1">
        <Row k="Hôm nay">
          {energy(p.today.wh)} · {vnd(p.today.vnd)}
        </Row>
        <Row k={`Tháng ${new Date().getMonth() + 1}`}>
          {energy(p.month.wh)} · {vnd(p.month.vnd)}
        </Row>
        {p.since != null && p.since > monthStart && (
          <Row k="Bắt đầu đếm">{dayTime(p.since)}</Row>
        )}
      </dl>
      {budget != null ? (
        <div className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2 text-xs">
          <span className="text-muted-foreground">Ngân sách/ngày</span>
          <Bar pct={used} l={level(used)} />
          <span className={cn("tabular", text[level(used)])}>
            {used}% <span className="text-muted-foreground">· {vnd(budget)}</span>
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Chưa đặt ngân sách: không giới hạn.</p>
      )}
      {p.over && (
        <p role="status" className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          Vượt ngân sách hôm nay{p.paused ? `: đã dừng team lúc ${hhmm(p.paused.at)}` : ""}. Team giữ trạng thái dừng tới 0:00; tăng ngân sách để chạy tiếp.
        </p>
      )}
      {edit ? (
        <form
          className="space-y-2 rounded-md bg-muted/50 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
            Giá điện (₫/kWh)
            <Input inputMode="numeric" type="number" min={500} max={20000} required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="h-7 text-right" />
          </label>
          <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
            Phần còn lại (W)
            <Input inputMode="numeric" type="number" min={0} max={1000} required value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} className="h-7 text-right" />
          </label>
          <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
            Ngân sách/ngày (₫)
            <Input inputMode="numeric" type="number" min={1000} max={10000000} placeholder="không giới hạn" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="h-7 text-right" />
          </label>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Vượt ngân sách: HQ dừng team (Chạy liên tục) tới hết ngày. Phần còn lại là mainboard, RAM, ổ, quạt, hao hụt nguồn; đo bằng ổ cắm có đồng hồ rồi chỉnh cho đúng.
          </p>
          {newBudget != null && newBudget <= p.today.vnd && <p className="text-[11px] text-st-needs">Thấp hơn mức đã dùng hôm nay ({vnd(p.today.vnd)}): team sẽ dừng ngay.</p>}
          <div className="flex justify-end gap-1.5">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEdit(false)} disabled={busy}>
              Huỷ
            </Button>
            <Button type="submit" size="sm" className="h-7 text-xs" disabled={busy}>
              Lưu
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={open}>
          Giá điện & ngân sách
        </Button>
      )}
    </Section>
  );
}

function AwakeSection({ a }: { a: Awake }) {
  const display = a.display === "off" ? "Tắt" : a.display === "on" ? "Bật" : a.display === "dim" ? "Mờ" : null;
  return (
    <Section title="Thức & màn hình">
      <dl className="space-y-1">
        {display && (
          <Row k="Màn hình" warn={a.display_required === true}>
            {display}
            {a.display_required ? (
              <span className="text-muted-foreground"> · {a.displayBy ? `${a.displayBy.join(", ")} giữ màn hình sáng` : "có ứng dụng giữ màn hình sáng"}</span>
            ) : a.display === "on" && (a.idle_s ?? 0) >= 600 ? (
              <span className="text-muted-foreground"> · không ai đụng máy: một ứng dụng vừa giữ màn hình sáng (game, video), hoặc Windows chưa tới giờ tắt màn hình</span>
            ) : null}
          </Row>
        )}
        {a.idle_s != null && a.idle_s >= 60 && (
          <Row k="Không ai đụng máy">
            {span(a.idle_s)} <span className="text-muted-foreground">(từ {hhmm(a.at - a.idle_s * 1000)})</span>
          </Row>
        )}
        {a.held != null && (
          <Row k="Giữ thức" warn={!a.held}>
            {a.held ? (
              "Có: máy không tự ngủ"
            ) : (
              <>
                Không: máy có thể tự ngủ. Chạy <code className="font-mono">8sync awake --while-rooms</code>
              </>
            )}
          </Row>
        )}
        {a.slept_s != null && (
          <Row k="Ngủ từ lúc bật" warn={a.slept_s >= 60}>
            {a.slept_s < 60 ? "0 lần" : span(a.slept_s)}
            {a.boot_s != null && <span className="text-muted-foreground"> · bật lúc {dayTime(a.at - a.boot_s * 1000)}</span>}
          </Row>
        )}
        {a.away && (
          <Row k="Trong lúc vắng">
            {a.away.rooms ? `${a.away.rooms} phiên Claude xong lượt mới, gần nhất ${hhmm(a.away.last ?? a.at)}` : "chưa phiên nào xong lượt"}
          </Row>
        )}
      </dl>
      {a.modern_standby != null && (
        <p className={cn("text-[11px] leading-snug", a.modern_standby ? "text-st-needs" : "text-muted-foreground")}>
          {a.modern_standby
            ? "Máy dùng Modern Standby: tắt màn hình có thể làm Windows hãm ứng dụng nền."
            : "Không có Modern Standby: tắt màn hình không làm máy ngủ, phòng vẫn chạy như lúc màn hình bật."}
        </p>
      )}
    </Section>
  );
}

/** Header chip "Máy": the busiest of RAM / CPU / GPU and the watts at a glance; the panel has the rest. */
export function MachineChip({ api }: { api: Hq["api"] }) {
  const [open, setOpen] = useState(false);
  const poll = usePoll<MachineView>(api, "/api/machine", POLL_MS, true);
  const m = poll.data;
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!m) return null;

  const ram = pctOf(m.mem.usedMb, m.mem.totalMb);
  const gpu = m.gpus?.[0];
  const gpuPct = gpu ? Math.max(gpu.util, pctOf(gpu.memUsed, gpu.memTotal)) : null;
  const worst = Math.max(ram, m.cpu.pct ?? 0, gpuPct ?? 0);
  const l = level(worst);
  const w = m.power?.live ? Math.round(m.power.live.w) : null;

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-baseline gap-1.5 rounded-md px-1 text-xs whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Máy: RAM ${ram}%, CPU ${m.cpu.pct ?? "…"}%${gpuPct != null ? `, GPU ${gpuPct}%` : ""}${w != null ? `, ${w} W` : ""}${m.power?.over ? ", vượt ngân sách điện" : ""}`}
        >
          <span>Máy</span>
          <span className={cn("text-sm font-medium tabular", text[l])}>{worst}%</span>
          {w != null && <span className={cn("tabular", m.power?.over ? "text-destructive" : "text-foreground")}>{w} W</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(23rem,calc(100vw-1rem))] space-y-2.5 p-3">
        <div className="space-y-2">
          <Meter label="RAM" pct={ram} detail={`${gb(m.mem.usedMb)} / ${gb(m.mem.totalMb)}`} />
          <Meter label="CPU" pct={m.cpu.pct} detail={`${m.cpu.cores} luồng`} />
          {m.gpus?.map((g, i) => (
            <Meter key={i} label={m.gpus!.length > 1 ? `GPU ${i}` : "GPU"} pct={g.util} detail={`VRAM ${(g.memUsed / 1024).toFixed(1)}/${(g.memTotal / 1024).toFixed(1)} GB${g.temp != null ? ` · ${g.temp}°C` : ""}`} />
          ))}
          {m.gpus == null && <p className="text-xs text-muted-foreground">Không thấy GPU NVIDIA (nvidia-smi).</p>}
        </div>
        {m.power && <PowerSection p={m.power} api={api} onSaved={poll.reload} />}
        {m.awake && <AwakeSection a={m.awake} />}
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
      </PopoverContent>
    </Popover>
  );
}
