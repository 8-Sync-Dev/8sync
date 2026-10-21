"use client";

import { ChevronDownIcon, HardDriveIcon, Loader2Icon, RotateCwIcon, SendIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { bytes, cleanupRoom, cleanupText, diskKey, projectRooms, type Finding, type Severity } from "@/lib/disk";
import { inboxText } from "@/lib/labels";
import type { Awake } from "@/lib/server/awake";
import type { GuardView } from "@/lib/server/guard-trigger";
import type { LoopState } from "@/lib/server/cleanup-loop";
import type { DiskProject, DiskState } from "@/lib/server/disk";
import type { Power, PowerSettings } from "@/lib/server/power";
import type { Spec } from "@/lib/server/machine";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { Bar, dayTime, energy, gb, hhmm, level, Meter, Row, span, text, vnd, worstLoad, type MachineView as MachineData } from "./machine-chip";
import type { Hq } from "./use-hq";
import type { Room } from "./use-office";
import { usePoll } from "./use-poll";

const DISK_POLL_MS = 60_000;
/** While a scan runs, ask often so the result shows as soon as it lands. */
const DISK_SCANNING_MS = 3_000;
const LOOP_POLL_MS = 60_000;
/** Phones: every control is at least 44 px tall. */
const TOUCH = "max-sm:h-11 max-sm:min-w-11";
/** Amber that passes AA as text on light surfaces (same mix as nav / idle chip). */
const NEEDS_INK = "text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs";

/** One block of the Máy tab: a heading, an optional aside (status, action), the content. */
function Panel({ id, title, aside, children, className }: { id: string; title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("space-y-2.5 rounded-lg border bg-card p-3 sm:p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** An on/off switch with a 44 px hit area on phones; `busy` while the change is on its way. */
export function Switch({ on, busy, label, onChange }: { on: boolean; busy?: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => onChange(!on)}
      className="group inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait sm:min-h-8 sm:min-w-9"
    >
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none",
          on ? "bg-primary group-hover:bg-primary/85" : "bg-muted-foreground/30 group-hover:bg-muted-foreground/45",
          busy && "opacity-60",
        )}
      >
        <span className={cn("absolute top-0.5 left-0.5 grid size-4 place-items-center rounded-full bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none", on && "translate-x-4")}>
          {busy && <Loader2Icon className="size-3 animate-spin text-muted-foreground motion-reduce:animate-none" />}
        </span>
      </span>
    </button>
  );
}

const watts = (w: number | null, what: string, pending = false) => (w != null ? `${what} ${Math.round(w)} W đo` : pending ? `${what} đang đo` : `${what} không đo được (chưa tính)`);

function PowerPanel({ p, api, onSaved }: { p: Power; api: Hq["api"]; onSaved: () => void }) {
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
    <Panel
      id="may-power"
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
        <p className="text-xs leading-snug text-muted-foreground">
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
        {p.since != null && p.since > monthStart && <Row k="Bắt đầu đếm">{dayTime(p.since)}</Row>}
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
            <Input inputMode="numeric" type="number" min={500} max={20000} required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={cn("h-8 text-right", TOUCH)} />
          </label>
          <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
            Phần còn lại (W)
            <Input inputMode="numeric" type="number" min={0} max={1000} required value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} className={cn("h-8 text-right", TOUCH)} />
          </label>
          <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
            Ngân sách/ngày (₫)
            <Input inputMode="numeric" type="number" min={1000} max={10000000} placeholder="không giới hạn" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={cn("h-8 text-right", TOUCH)} />
          </label>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Vượt ngân sách: HQ dừng team (Chạy liên tục) tới hết ngày. Phần còn lại là mainboard, RAM, ổ, quạt, hao hụt nguồn; đo bằng ổ cắm có đồng hồ rồi chỉnh cho đúng.
          </p>
          {newBudget != null && newBudget <= p.today.vnd && <p className={cn("text-[11px]", NEEDS_INK)}>Thấp hơn mức đã dùng hôm nay ({vnd(p.today.vnd)}): team sẽ dừng ngay.</p>}
          <div className="flex justify-end gap-1.5">
            <Button type="button" size="sm" variant="ghost" className={TOUCH} onClick={() => setEdit(false)} disabled={busy}>
              Huỷ
            </Button>
            <Button type="submit" size="sm" className={TOUCH} disabled={busy}>
              {busy && <Loader2Icon className="animate-spin motion-reduce:animate-none" />} Lưu giá điện
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="outline" className={TOUCH} onClick={open}>
          Sửa giá điện & ngân sách
        </Button>
      )}
    </Panel>
  );
}

/** How long the switch shows the requested state before trusting the poll again. */
const SWITCH_SETTLE_MS = 10_000;

function AwakePanel({ a, api, onChanged }: { a: Awake; api: Hq["api"]; onChanged: () => void }) {
  // The state asked for, until the poll shows it (or it times out): no flicker back to the old state.
  const [want, setWant] = useState<{ on: boolean; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const ours = a.ours;
  const settled = want != null && (ours != null) === want.on;
  useEffect(() => {
    if (!want) return;
    const t = setTimeout(() => setWant(null), Math.max(0, want.at + SWITCH_SETTLE_MS - Date.now()));
    return () => clearTimeout(t);
  }, [want]);
  const on = want && !settled ? want.on : ours != null;

  async function flip(next: boolean) {
    setBusy(true);
    setWant({ on: next, at: Date.now() });
    try {
      const r = await api<{ message: string }>("/api/machine/awake", { method: "POST", body: { on: next } });
      toast.success(next ? "Đã bật giữ máy thức" : "Đã tắt giữ máy thức", { description: r.message });
      onChanged();
    } catch (e) {
      setWant(null);
      toast.error(next ? "Chưa bật được giữ máy thức" : "Chưa tắt được giữ máy thức", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const display = a.display === "off" ? "Tắt" : a.display === "on" ? "Bật" : a.display === "dim" ? "Mờ" : null;
  return (
    <Panel id="may-awake" title="Thức & màn hình">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Giữ máy thức khi phòng chạy</p>
          <p className="text-xs leading-snug text-muted-foreground">Máy không ngủ khi còn phòng chạy; màn hình tắt sau 10 phút không ai đụng chuột/phím.</p>
        </div>
        <Switch on={on} busy={busy} label="Giữ máy thức khi phòng chạy" onChange={(v) => void flip(v)} />
      </div>
      <p role="status" className={cn("text-xs", on ? "text-foreground" : "text-muted-foreground")}>
        {busy
          ? on
            ? "Đang bật…"
            : "Đang tắt…"
          : ours
            ? `Đang giữ: tự nhả khi hết phòng, chậm nhất ${dayTime(ours.until * 1000)}`
            : "Đang tắt: máy ngủ theo cài đặt nguồn khi rảnh."}
      </p>
      <dl className="space-y-1 border-t pt-2.5">
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
          <Row k="Cả hệ thống" warn={!a.held}>
            {a.held ? "Có tiến trình giữ máy thức" : "Không ai giữ: máy có thể tự ngủ"}
          </Row>
        )}
        {a.slept_s != null && (
          <Row k="Ngủ từ lúc bật" warn={a.slept_s >= 60}>
            {a.slept_s < 60 ? "0 lần" : span(a.slept_s)}
            {a.boot_s != null && <span className="text-muted-foreground"> · bật lúc {dayTime(a.at - a.boot_s * 1000)}</span>}
          </Row>
        )}
        {a.away && (
          <Row k="Trong lúc vắng">{a.away.rooms ? `${a.away.rooms} phiên Claude xong lượt mới, gần nhất ${hhmm(a.away.last ?? a.at)}` : "chưa phiên nào xong lượt"}</Row>
        )}
      </dl>
      {a.modern_standby != null && (
        <p className={cn("text-[11px] leading-snug", a.modern_standby ? NEEDS_INK : "text-muted-foreground")}>
          {a.modern_standby
            ? "Máy dùng Modern Standby: tắt màn hình có thể làm Windows hãm ứng dụng nền."
            : "Không có Modern Standby: tắt màn hình không làm máy ngủ, phòng vẫn chạy như lúc màn hình bật."}
        </p>
      )}
    </Panel>
  );
}

const GUARD_CHOICES = [50, 60, 70, 80] as const;
const GUARD_LEVELS = ["bình thường", "dọn mạnh", "khởi động lại phòng nặng", "tạm dừng bớt phòng"] as const;
/** Defender eating at least this share of the machine's CPU is worth the owner's attention. */
const DEFENDER_HOT_PCT = 3;
/** The "vừa xử lý" line shows the latest action this long. */
const RECENT_S = 600;
/** %TEMP% QA copies worth a line from this size. */
const TEMP_QA_MB = 500;

/** "Bảo vệ máy": the ccc auto resource guard. `at`: the poll's sample time (ms), the "now" for relative times. */
function GuardPanel({ g, at, api, onChanged }: { g: GuardView; at: number; api: Hq["api"]; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | "off" | "eco" | null>(null);
  const now = at / 1000;
  const ago = (t: number) => (now - t < 60 ? `${Math.max(0, Math.round(now - t))} giây trước` : `${span(now - t)} trước`);
  const last = g.projects.reduce<{ at: number; text: string } | null>((a, p) => (p.last && (!a || p.last.at > a.at) ? p.last : a), null);
  const recent = last && now - last.at <= RECENT_S ? last : null;
  // Runs that changed nothing back the trigger off (40 s … 5 min between runs).
  const wait = g.lastRun && g.nextGapS > 20 ? ` · chờ ${g.nextGapS}s` : "";

  async function send(key: number | "off" | "eco", body: { pct: number | null } | { eco: boolean }, done: string) {
    setBusy(key);
    try {
      const r = await api<{ message: string }>("/api/machine/guard", { method: "POST", body });
      toast.success(done, { description: r.message });
      onChanged();
    } catch (e) {
      toast.error("Chưa đổi được bảo vệ máy", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const choice = (key: number | "off", label: string, pct: number | null) => (
    <Button
      key={key}
      type="button"
      size="sm"
      variant={g.pct === pct ? "default" : "outline"}
      className={cn("h-7 px-2.5", TOUCH)}
      aria-pressed={g.pct === pct}
      disabled={busy != null}
      onClick={() => void send(key, { pct }, pct == null ? "Đã tắt tự dọn" : `Tự dọn khi RAM ≥ ${pct}%`)}
    >
      {busy === key && <Loader2Icon className="animate-spin motion-reduce:animate-none" />} {label}
    </Button>
  );
  return (
    <Panel id="may-guard" title="Bảo vệ máy" aside={<span className="text-xs text-muted-foreground">{g.pct == null ? "Tự dọn: tắt" : `Tự dọn khi RAM ≥ ${g.pct}%`}</span>}>
      <div role="group" aria-label="Ngưỡng RAM tự dọn" className="flex flex-wrap gap-1.5">
        {GUARD_CHOICES.map((p) => choice(p, `${p}%`, p))}
        {choice("off", "Tắt", null)}
      </div>
      {g.eco != null && (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Tiết kiệm điện</p>
            <p className="text-xs leading-snug text-muted-foreground">Phòng chạy ở chế độ Efficiency (EcoQoS), ưu tiên dưới bình thường.</p>
          </div>
          <Switch on={g.eco} busy={busy === "eco"} label="Tiết kiệm điện" onChange={(v) => void send("eco", { eco: v }, v ? "Đã bật tiết kiệm điện" : "Đã tắt tiết kiệm điện")} />
        </div>
      )}
      {(g.running || recent || wait) && (
        <p role="status" className={cn("text-xs", g.running ? NEEDS_INK : "text-muted-foreground")}>
          {g.running ? (
            <>
              <Loader2Icon className="mr-1 inline size-3 animate-spin align-[-2px] motion-reduce:animate-none" />
              đang xử lý: {g.runningWhy}…
            </>
          ) : recent ? (
            <>
              vừa xử lý: <span className="text-foreground">{recent.text}</span> · {ago(recent.at)}
              {wait}
            </>
          ) : (
            <>
              {g.lastRun!.why === "revive đang chạy"
                ? "bỏ qua lượt xử lý: revive đang chạy"
                : g.lastRun!.ok
                  ? `vừa kiểm tra (${g.lastRun!.why}): không cần đổi gì`
                  : `chưa chạy được guard now (${g.lastRun!.why})`}{" "}
              · {ago(g.lastRun!.at)}
              {wait}
            </>
          )}
        </p>
      )}
      {g.temp_qa && g.temp_qa.mb >= TEMP_QA_MB && (
        <p className={cn("text-[11px] leading-snug", NEEDS_INK)}>
          Thư mục tạm QA (%TEMP%\qa-card-*, qa-fetch*): {g.temp_qa.partial ? "≥ " : ""}
          {gb(Math.round(g.temp_qa.mb))} / {g.temp_qa.dirs} mục — Defender quét liên tục; xoá tay khi xong
        </p>
      )}
      {g.projects.map((p) => (
        <div key={p.root} className="space-y-1 border-t pt-2.5">
          <p className="truncate font-mono text-xs" title={p.root}>
            {p.root.split(/[\\/]/).filter(Boolean).pop() ?? p.root}
          </p>
          <dl className="space-y-1">
            <Row k="Mức" warn={p.level > 0}>
              {p.level} · {GUARD_LEVELS[p.level]}
              {p.ram != null && <span className="text-muted-foreground"> · RAM {p.ram}%</span>}
              {p.cpu != null && <span className="text-muted-foreground"> · CPU {Math.round(p.cpu)}%</span>}
              {p.at != null && <span className="text-muted-foreground"> · {ago(p.at)}</span>}
            </Row>
            {p.rooms.length > 0 && (
              <Row k="Phòng ăn nhiều nhất">
                {[...p.rooms]
                  .sort((a, b) => b.mb - a.mb)
                  .slice(0, 3)
                  .map((r) => `${r.name} ${gb(Math.round(r.mb))}${r.cpu != null ? ` · ${Math.round(r.cpu)}%` : ""}`)
                  .join(", ")}
              </Row>
            )}
            {p.top.length > 0 && <Row k="Ăn CPU nhất">{p.top.join(", ")}</Row>}
            {p.paused.length > 0 && <Row k="Phòng tạm dừng">{p.paused.join(", ")}</Row>}
            {p.defender_cpu != null && (
              <Row k="Defender" warn={p.defender_cpu >= DEFENDER_HOT_PCT}>
                Defender (MsMpEng) ăn CPU {Math.round(p.defender_cpu)}% máy
              </Row>
            )}
          </dl>
          {p.actions.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {p.actions
                .slice(-5)
                .reverse()
                .map((a, i) => (
                  <li key={i}>
                    <span className="tabular-nums">{ago(a.at)}</span> · <span className="text-foreground">{a.text}</span>
                  </li>
                ))}
            </ul>
          )}
          {p.defender && (
            <div className="space-y-1">
              <p className={cn("text-[11px] leading-snug", (p.defender_cpu ?? 0) >= DEFENDER_HOT_PCT ? NEEDS_INK : "text-muted-foreground")}>
                Loại trừ Defender: chạy PowerShell admin (HQ không tự chạy)
              </p>
              <div className="flex items-start gap-1.5">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-muted p-2 font-mono text-[11px] leading-snug">{p.defender}</pre>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={TOUCH}
                  onClick={() =>
                    void navigator.clipboard.writeText(p.defender!).then(
                      () => toast.success("Đã chép lệnh"),
                      () => toast.error("Không chép được, hãy chọn và chép tay"),
                    )
                  }
                >
                  Chép
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}

function SpecPanel({ s }: { s: Spec }) {
  return (
    <Panel id="may-spec" title="Cấu hình máy">
      <dl className="space-y-1">
        <Row k="CPU">
          <span className="block">{s.cpu.model || "không rõ"}</span>
          <span className="text-muted-foreground">
            {s.cpu.cores != null ? `${s.cpu.cores} nhân · ` : ""}
            {s.cpu.threads} luồng
          </span>
        </Row>
        <Row k="RAM">{gb(s.memTotalMb)}</Row>
        {s.gpus?.length ? (
          s.gpus.map((g, i) => (
            <Row key={i} k={s.gpus!.length > 1 ? `GPU ${i}` : "GPU"}>
              {g.name} <span className="text-muted-foreground">· VRAM {gb(g.vramMb)}</span>
            </Row>
          ))
        ) : (
          <Row k="GPU">
            <span className="text-muted-foreground">không thấy GPU NVIDIA (nvidia-smi)</span>
          </Row>
        )}
        <Row k="Hệ điều hành">
          {s.os.name} <span className="text-muted-foreground">· {s.os.version} · {s.os.arch}</span>
        </Row>
      </dl>
    </Panel>
  );
}

const SEV: Record<Severity, { label: string; cls: string }> = {
  high: { label: "Cao", cls: "bg-destructive/10 text-destructive" },
  warn: { label: "Chú ý", cls: cn("bg-st-needs/15", NEEDS_INK) },
};

function SevTag({ s }: { s: Severity }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-medium", SEV[s].cls)}>{SEV[s].label}</span>;
}

/** `what`: the finding id, or "*" for the whole project (which button shows the spinner). */
type SendFn = (p: DiskProject, fs: Finding[], room: Room, what: string) => Promise<void>;

function ProjectDiskRow({
  p,
  rooms,
  loop,
  api,
  onLoop,
  send,
  sending,
}: {
  p: DiskProject;
  rooms: Room[];
  loop: LoopState | null;
  api: Hq["api"];
  onLoop: () => void;
  send: SendFn;
  sending: string | null;
}) {
  const k = diskKey(p.root);
  const lp = loop?.projects[k];
  const mine = projectRooms(rooms, p.root);
  const room = (lp?.room ? mine.find((r) => r.key === lp.room) : undefined) ?? cleanupRoom(rooms, p.root);
  const sent = loop?.sent[k];
  const failed = loop?.lastError[k];
  const [loopBusy, setLoopBusy] = useState(false);
  const high = p.findings.filter((f) => f.severity === "high").length;
  const warn = p.findings.length - high;
  const ge = p.truncated ? "≥ " : "";

  async function setLoop(patch: { on?: boolean; room?: string | null }) {
    setLoopBusy(true);
    try {
      await api("/api/machine/cleanup", { method: "POST", body: { root: p.root, ...patch } });
      if (patch.on !== undefined) toast.success(patch.on ? `Đã bật dọn định kỳ cho ${p.name}` : `Đã tắt dọn định kỳ cho ${p.name}`);
      onLoop();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoopBusy(false);
    }
  }

  const busyAll = sending === `${k}:*`;
  return (
    <li className="space-y-2.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="min-w-0 truncate text-sm font-medium" title={p.root}>
          {p.name}
        </h3>
        <span className="text-xs text-muted-foreground tabular">
          {ge}
          {bytes(p.total)}
        </span>
        <span className="ml-auto text-xs tabular">
          {p.error ? (
            <span className="text-destructive">{p.error}</span>
          ) : p.findings.length ? (
            <>
              {high > 0 && <span className="text-destructive">{high} cao</span>}
              {high > 0 && warn > 0 && <span className="text-muted-foreground"> · </span>}
              {warn > 0 && <span className={NEEDS_INK}>{warn} chú ý</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Không có gì bất thường</span>
          )}
        </span>
      </div>

      {p.findings.length > 0 && (
        <ul className="divide-y rounded-md border" aria-label={`Mục bất thường của ${p.name}`}>
          {p.findings.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-1.5 pr-1 pl-2.5">
              <SevTag s={f.severity} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs break-all">{f.path}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground tabular">
                    {ge}
                    {bytes(f.bytes)}
                  </span>{" "}
                  · {f.why}
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                className={TOUCH}
                disabled={!room || sending != null}
                onClick={() => room && void send(p, [f], room, f.id)}
                aria-label={room ? `Gửi riêng mục ${f.path} cho ${room.label}` : "Chưa có phòng để gửi"}
                title={room ? `Gửi riêng mục này cho ${room.label}` : "Chưa có phòng để gửi"}
              >
                {sending === `${k}:${f.id}` ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : <SendIcon />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {p.entries.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className={cn("group inline-flex h-7 items-center gap-1 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", TOUCH)}>
            <ChevronDownIcon className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
            Chi tiết dung lượng
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Breakdown p={p} />
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className={TOUCH} disabled={!room || sending != null} onClick={() => room && void send(p, p.findings, room, "*")}>
          {busyAll ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : <SendIcon />}
          {room ? (p.findings.length ? `Gửi dọn cho ${room.label}` : `Gửi kiểm tra cho ${room.label}`) : "Chưa có phòng"}
        </Button>
        {mine.length > 1 && room && (
          <Select value={room.key} onValueChange={(v) => void setLoop({ room: v })} disabled={loopBusy}>
            <SelectTrigger size="sm" className={cn("max-w-[12rem] text-xs", TOUCH)} aria-label={`Phòng nhận tin dọn của ${p.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mine.map((r) => (
                <SelectItem key={r.key} value={r.key} className="text-xs">
                  {r.label}
                  {r.delivery === "inbox" ? " · inbox" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          Dọn định kỳ
          <Switch on={lp?.on ?? false} busy={loopBusy} label={`Dọn định kỳ ${p.name}`} onChange={(v) => void setLoop({ on: v })} />
        </label>
      </div>
      {!room && <p className="text-xs text-muted-foreground">Dự án chưa có phòng nào chạy: mở một phòng để gửi tin dọn.</p>}
      {sent && (
        <p className="text-xs text-muted-foreground">
          Tự gửi lần cuối {dayTime(sent.at)} cho {sent.room} ({sent.n} mục)
        </p>
      )}
      {failed && (
        <p role="status" className="text-xs text-destructive">
          Lần tự gửi {dayTime(failed.at)}
          {failed.room ? ` cho ${failed.room}` : ""} chưa tới phòng: {failed.error}. Lần chạy tới gửi lại.
        </p>
      )}
    </li>
  );
}

function Breakdown({ p }: { p: DiskProject }) {
  const max = Math.max(1, ...p.entries.map((e) => e.bytes));
  const extra: { k: string; v: string }[] = [
    ...(p.git != null ? [{ k: ".git", v: bytes(p.git) }] : []),
    ...(p.worktrees ? [{ k: "Worktree", v: `${p.worktrees.n} · ${bytes(p.worktrees.bytes)}` }] : []),
    ...p.nodeModules.slice(0, 3).map((n) => ({ k: n.path, v: bytes(n.bytes) })),
    ...p.build.slice(0, 3).map((n) => ({ k: n.path, v: bytes(n.bytes) })),
    ...p.evidence.map((n) => ({ k: n.path, v: bytes(n.bytes) })),
    ...(p.uploads ? [{ k: ".claude/hq-uploads", v: `${p.uploads.n} · ${bytes(p.uploads.bytes)}` }] : []),
  ];
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2">
      <ul className="space-y-1" aria-label="Mục lớn nhất ở gốc dự án">
        {p.entries.map((e) => (
          <li key={e.path} className="grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] items-center gap-2 text-xs">
            <span className="truncate font-mono" title={e.path}>
              {e.path}
              {e.dir ? "/" : ""}
            </span>
            <Bar pct={(100 * e.bytes) / max} l="ok" />
            <span className="text-right tabular">{bytes(e.bytes)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-1">
        {extra.map((x) => (
          <div key={x.k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs">
            {/* A deep path is cut from the left: the folder name at its end is what tells them apart. */}
            <dt className="truncate text-left font-mono text-muted-foreground [direction:rtl]" title={x.k}>
              <bdi>{x.k}</bdi>
            </dt>
            <dd className="tabular">{x.v}</dd>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs">
          <dt className="text-muted-foreground">Đo trong</dt>
          <dd className="tabular">
            {(p.ms / 1000).toFixed(1)} giây{p.truncated ? " (chạm giới hạn, số là tối thiểu)" : ""}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function DiskPanel({ api, rooms, active }: { api: Hq["api"]; rooms: Room[]; active: boolean }) {
  // When the owner asked for a scan: busy until a poll after that says whether it still runs.
  const [asked, setAsked] = useState<number | null>(null);
  const [fast, setFast] = useState(false);
  const disk = usePoll<DiskState>(api, "/api/machine/disk", fast ? DISK_SCANNING_MS : DISK_POLL_MS, active);
  const loop = usePoll<LoopState>(api, "/api/machine/cleanup", LOOP_POLL_MS, active);
  const [sending, setSending] = useState<string | null>(null);
  const d = disk.data;
  const busy = (asked != null && disk.at <= asked) || d?.scanning === true;
  // Poll quickly while a scan runs (also one the loop or another tab started), slowly otherwise.
  if (fast !== busy) setFast(busy);

  async function rescan() {
    try {
      await api("/api/machine/disk", { method: "POST" });
      setAsked(Date.now());
    } catch (e) {
      toast.error("Chưa đo lại được", { description: (e as Error).message });
    }
  }

  const send: SendFn = async (p, fs, room, what) => {
    const key = `${diskKey(p.root)}:${what}`;
    setSending(key);
    try {
      const r = await api<{ delivery: string; live?: boolean; error: string | null }>("/api/messages", {
        method: "POST",
        body: { session: room.name, text: cleanupText(p, fs), base: room.cwd },
      });
      if (r.delivery === "failed") toast.error(`Chưa gửi được tới ${room.label}`, { description: r.error ?? undefined });
      else toast.success(`Đã gửi tin dọn cho ${room.label}`, { description: r.delivery === "inbox" ? inboxText(r.live) : "đã gõ vào terminal" });
    } catch (e) {
      const m = (e as Error).message;
      toast.error(m === "session-waiting" ? `${room.label} đang chờ anh trả lời trong terminal: trả lời trước rồi gửi lại` : m);
    } finally {
      setSending(null);
    }
  };

  const l = loop.data;
  const anyOn = l ? Object.values(l.projects).some((x) => x.on) : false;
  return (
    <Panel
      id="may-disk"
      title="Dung lượng dự án"
      aside={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {d?.at != null && <span className="tabular">Đo lúc {dayTime(d.at)}</span>}
          <Button size="sm" variant="outline" className={TOUCH} disabled={busy} onClick={() => void rescan()}>
            {busy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : <RotateCwIcon />}
            {busy ? "Đang đo…" : "Đo lại"}
          </Button>
        </div>
      }
    >
      <p className="text-xs leading-snug text-muted-foreground">
        Mỗi dự án: thư mục lớn, .git, worktree, bằng chứng, node_modules, thư mục build và file lớn đã commit. Dọn định kỳ: mỗi 6 giờ HQ đo lại dự án đang bật và tự gửi phòng khi có mục vượt ngưỡng chưa gửi trong 24 giờ.
        {l && (
          <span className="tabular">
            {" "}
            {l.lastRun != null ? `Chạy gần nhất ${dayTime(l.lastRun)}` : "Chưa chạy lần nào"}
            {anyOn && l.nextRun != null ? ` · lần tới ${dayTime(l.nextRun)}` : ""}
            {l.running ? " · đang chạy" : ""}.
          </span>
        )}
      </p>
      {disk.error && !d && <ErrorNote what="dung lượng dự án" error={disk.error} onRetry={disk.reload} />}
      {!d && !disk.error && <DiskSkeleton />}
      {d && d.projects.length === 0 && (busy ? <DiskSkeleton /> : <EmptyState icon={<HardDriveIcon />} title="Chưa có dự án để đo">Thêm thư mục ở thanh bên hoặc mở một phòng; HQ đo dung lượng các dự án đó.</EmptyState>)}
      {d && d.projects.length > 0 && (
        <ul className="divide-y">
          {d.projects.map((p) => (
            <ProjectDiskRow key={p.root} p={p} rooms={rooms} loop={l} api={api} onLoop={loop.reload} send={send} sending={sending} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DiskSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Đang đo dung lượng dự án">
      <p className="text-xs text-muted-foreground">Đang đo dung lượng, lần đầu có thể mất một phút.</p>
      <Skeleton className="h-16 rounded-md" />
      <Skeleton className="h-16 rounded-md" />
    </div>
  );
}

function ProcsPanel({ m, api }: { m: MachineData; api: Hq["api"] }) {
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <Panel id="may-procs" title="Tiến trình">
      {m.procs && (
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Claude Code</dt>
            <dd className="tabular">
              {m.procs.claude.n} tiến trình · {gb(m.procs.claude.mb)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Node (MCP, LSP, dev)</dt>
            <dd className="tabular">
              {m.procs.node.n} tiến trình · {gb(m.procs.node.mb)}
            </dd>
          </div>
        </dl>
      )}
      {m.canClean ? (
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className={TOUCH} disabled={busy} onClick={() => void runClean(true)}>
            Xem trước bản dọn
          </Button>
          <Button size="sm" className={TOUCH} disabled={busy} onClick={() => void runClean(false)}>
            {busy && <Loader2Icon className="animate-spin motion-reduce:animate-none" />} Dọn máy an toàn
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Dọn máy (<code className="font-mono">8sync clean</code>) chỉ chạy trên Linux. Helper chạy quá tay có <code className="font-mono">8sync watchdog</code> canh.
        </p>
      )}
      {report && <pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap">{report}</pre>}
    </Panel>
  );
}

/**
 * Tab "Máy": load, power, awake (with its switch), what the machine is, how big the projects have
 * grown (one-tap cleanup send, the 6-hourly loop) and the processes. `m` is the header chip's poll.
 */
export function MachineView({ m, reload, api, rooms, active }: { m: MachineData | null; reload: () => void; api: Hq["api"]; rooms: Room[]; active: boolean }) {
  if (!m) {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 pt-5 pb-10 sm:px-6 lg:grid-cols-2" aria-busy="true" aria-label="Đang tải thông tin máy">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-48 rounded-lg lg:col-span-2" />
      </div>
    );
  }
  const { ram } = worstLoad(m);
  // The owner's order (Điện, Thức & màn hình, Cấu hình, Dung lượng, Tiến trình) on a phone; two
  // balanced columns on a wide screen, the project sizes full width under them.
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-5 pb-10 sm:px-6">
        <div className="gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid [&>*:last-child]:mb-0">
          <Panel id="may-load" title="Tải máy">
            <div className="space-y-2">
              <Meter label="RAM" pct={ram} detail={`${gb(m.mem.usedMb)} / ${gb(m.mem.totalMb)}`} />
              <Meter label="CPU" pct={m.cpu.pct} detail={`${m.cpu.cores} luồng`} />
              {m.gpus?.map((g, i) => (
                <Meter key={i} label={m.gpus!.length > 1 ? `GPU ${i}` : "GPU"} pct={g.util} detail={`VRAM ${(g.memUsed / 1024).toFixed(1)}/${(g.memTotal / 1024).toFixed(1)} GB${g.temp != null ? ` · ${g.temp}°C` : ""}`} />
              ))}
              {m.gpus == null && <p className="text-xs text-muted-foreground">Không thấy GPU NVIDIA (nvidia-smi).</p>}
            </div>
          </Panel>
          {m.power && <PowerPanel p={m.power} api={api} onSaved={reload} />}
          {m.awake && <AwakePanel a={m.awake} api={api} onChanged={reload} />}
          {m.guard && <GuardPanel g={m.guard} at={m.at} api={api} onChanged={reload} />}
          {m.spec && <SpecPanel s={m.spec} />}
        </div>
        <DiskPanel api={api} rooms={rooms} active={active} />
        <ProcsPanel m={m} api={api} />
      </div>
    </div>
  );
}
