"use client";

import { ArrowDownIcon, GaugeIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { hhmm } from "@/lib/auto";
import type { Tokens, UsageReport, UsageRow } from "@/lib/server/usage";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { level, span } from "./machine-chip";

const POLL_MS = 60_000;
/** While transcripts are still being read (first visit, bounded per request), ask again soon. */
const CATCH_UP_MS = 1500;
/** A plan reading older than this is flagged: the status line only writes while a room works. */
const STALE_MS = 15 * 60_000;

type Period = "today" | "window";
type SortKey = "total" | "input" | "cache_read" | "cache_write" | "output" | "median_ctx" | "calls";

const SORTS: { key: SortKey; label: string; short: string }[] = [
  { key: "total", label: "Tổng token", short: "Tổng" },
  { key: "input", label: "Input", short: "Input" },
  { key: "cache_read", label: "Cache đọc", short: "Cache đọc" },
  { key: "cache_write", label: "Cache ghi", short: "Cache ghi" },
  { key: "output", label: "Output", short: "Output" },
  { key: "median_ctx", label: "Context trung vị mỗi lượt", short: "Context/lượt" },
  { key: "calls", label: "Số lượt gọi", short: "Lượt" },
];

const sum = (t: Tokens) => t.input + t.cache_read + t.cache_write + t.output;

/** 1.6B / 23.4M / 812k / 950: dense, same scale as the Báo cáo tab, plus billions (cache reads reach them in a day). */
function fmt(v: number | null): string {
  if (v == null) return "chưa có";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

function sortValue(t: Tokens, k: SortKey): number {
  return k === "total" ? sum(t) : (t[k] ?? -1);
}

/** GET /api/usage every minute while visible; quicker while the server is still catching up on transcripts. */
function useUsage(token: string) {
  const [data, setData] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(timer);
      let next = POLL_MS;
      if (!document.hidden) {
        try {
          const r = await fetch("/api/usage", { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const v = (await r.json()) as UsageReport;
          setData(v);
          setError(null);
          if (v.scan.pending_bytes > 0) next = CATCH_UP_MS;
        } catch (e) {
          if (ac.signal.aborted) return;
          setError(e instanceof Error ? e.message : "failed");
        }
      }
      if (!ac.signal.aborted) timer = setTimeout(load, next);
    };
    const onShow = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onShow);
    void load();
    return () => {
      ac.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [token, tick]);

  return { data, error, retry: useCallback(() => setTick((t) => t + 1), []) };
}

/** Re-render every 30 s so countdowns and "đọc lúc" stay true between polls. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Plan windows, then tokens per room from the transcripts. */
export function UsageView({ token }: { token: string }) {
  const { data, error, retry } = useUsage(token);
  const now = useNow();
  const [period, setPeriod] = useState<Period>("today");
  const [sort, setSort] = useState<SortKey>("total");

  const rows = useMemo(
    () => [...(data?.rows ?? [])].filter((r) => r[period].calls > 0).sort((a, b) => sortValue(b[period], sort) - sortValue(a[period], sort)),
    [data, period, sort],
  );

  if (error && !data)
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <ErrorNote what="hạn mức" error={error} onRetry={retry} />
      </div>
    );
  if (!data) return <UsageSkeleton />;

  const totals = data.totals[period];
  const windowFrom = hhmm(data.window_start);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-5 pb-10 sm:px-6">
        {error && <ErrorNote what="số mới" error={error} onRetry={retry} />}

        <PlanWindows data={data} now={now} />

        <section aria-labelledby="usage-tokens-h" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 id="usage-tokens-h" className="text-sm font-semibold">
              Token theo phòng
            </h2>
            <div role="group" aria-label="Khoảng thời gian" className="inline-flex rounded-lg border bg-muted/40 p-0.5">
              {(
                [
                  ["today", "Hôm nay"],
                  ["window", `Cửa sổ 5 giờ (từ ${windowFrom})`],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={period === k}
                  onClick={() => setPeriod(k)}
                  className={cn(
                    "min-h-11 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none sm:min-h-8",
                    period === k && "bg-background text-foreground shadow-xs",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {data.scan.pending_bytes > 0 && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-st-needs motion-reduce:animate-none" />
              Đang đọc transcript, còn {Math.ceil(data.scan.pending_bytes / 1_048_576).toLocaleString("vi-VN")} MB. Số bên dưới sẽ tăng dần.
            </p>
          )}

          {totals.calls > 0 && <Totals t={totals} cap={data.context_cap} />}

          {rows.length === 0 ? (
            <EmptyState icon={<GaugeIcon />} title={period === "today" ? "Hôm nay chưa có lượt gọi nào" : "Cửa sổ 5 giờ này chưa có lượt gọi nào"}>
              Số đọc từ transcript Claude Code của các dự án HQ và worktree của chúng. Phòng nào chạy xong một lượt sẽ hiện ở đây.
            </EmptyState>
          ) : (
            <>
              <RoomTable rows={rows} period={period} sort={sort} setSort={setSort} cap={data.context_cap} />
              <RoomList rows={rows} period={period} sort={sort} setSort={setSort} cap={data.context_cap} />
            </>
          )}
        </section>

        <p className="max-w-[70ch] text-xs text-pretty text-muted-foreground">
          Hạn mức gói là phần trăm của cửa sổ 5 giờ và 7 ngày, lấy từ status line của 8sync (
          <code className="font-mono">~/.local/state/8sync/hq/usage</code>). Token là số Claude Code ghi trong transcript (
          <code className="font-mono">~/.claude/projects</code>), mỗi lượt gọi đếm một lần. Hai con số không quy đổi được cho nhau. Trang này không gọi API usage
          của Anthropic và không đọc thông tin đăng nhập. Context trung vị mỗi lượt là phần model đọc lại ở mỗi lượt; phòng team tự nén quanh{" "}
          {fmt(data.context_cap)}.
        </p>
      </div>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6" aria-busy="true" aria-label="Đang tải hạn mức">
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
      <Skeleton className="h-14 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

function PlanWindows({ data, now }: { data: UsageReport; now: number }) {
  const l = data.limits;
  const readAt = l?.ts != null ? l.ts * 1000 : null;
  const stale = readAt != null && now - readAt > STALE_MS;
  return (
    <section aria-labelledby="usage-plan-h" className="space-y-3">
      <h2 id="usage-plan-h" className="text-sm font-semibold">
        Hạn mức gói Claude
      </h2>
      {!l ? (
        <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
          Chưa có số hạn mức. Status line của 8sync ghi số này khi một phòng chạy bằng gói thuê bao (không có khi dùng API key).
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <WindowMeter label="Cửa sổ 5 giờ" pct={l.five_hour_pct} resetsAt={l.five_hour_resets_at} restPct={data.rest_pct} now={now} />
            <WindowMeter label="Cửa sổ 7 ngày" pct={l.seven_day_pct} resetsAt={l.seven_day_resets_at} restPct={data.rest_pct} now={now} />
          </div>
          <p className={cn("text-xs", stale ? "text-st-needs" : "text-muted-foreground")}>
            {readAt != null ? `Đọc lúc ${hhmm(readAt)} (${span((now - readAt) / 1000)} trước)` : "Không rõ giờ đọc"}
            {" từ phiên "}
            <span className="font-medium text-foreground">{l.session_id?.slice(0, 8) ?? "?"}</span>
            {l.project && ` · ${l.project}`}
            {l.model && ` · ${l.model.replace(/^claude-/, "")}`}
            {stale && ". Số có thể đã cũ: status line chỉ ghi khi có phòng đang chạy."}
          </p>
        </>
      )}
    </section>
  );
}

function WindowMeter({ label, pct, resetsAt, restPct, now }: { label: string; pct: number | null; resetsAt: number | null; restPct: number; now: number }) {
  const past = resetsAt != null && resetsAt * 1000 <= now;
  const shown = pct == null ? null : past ? 0 : Math.min(100, Math.max(0, Math.round(pct)));
  const l = level(shown);
  const resting = shown != null && shown >= restPct;
  return (
    <div className="space-y-2 rounded-lg border px-3 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("text-2xl font-semibold tabular", shown == null && "text-base font-normal text-muted-foreground", l === "warn" && "text-st-needs", l === "hot" && "text-destructive")}>
          {shown == null ? "chưa có" : `${shown}%`}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label} đã dùng`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown ?? 0}
        className="relative h-2 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none",
            l === "ok" ? "bg-foreground/70" : l === "warn" ? "bg-st-needs" : "bg-destructive",
          )}
          style={{ width: `${shown ?? 0}%` }}
        />
        <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${restPct}%` }} title={`Phòng nghỉ ở ${restPct}%`} />
      </div>
      <p className="text-xs text-muted-foreground">
        {past
          ? "Đã reset, chờ số mới từ status line"
          : resetsAt != null
            ? `Reset lúc ${resetClock(resetsAt * 1000, now)}, còn ${span(resetsAt - now / 1000)}`
            : "Không rõ giờ reset"}
      </p>
      {resting && !past && (
        <p className="text-xs font-medium text-destructive">Từ {restPct}% các phòng nghỉ, chạy lại khi cửa sổ reset.</p>
      )}
      {!resting && l === "warn" && !past && <p className="text-xs text-st-needs">Gần ngưỡng nghỉ {restPct}%.</p>}
    </div>
  );
}

/** "22:30" today, "T5 22:30" on another day. */
function resetClock(ms: number, now: number): string {
  const d = new Date(ms);
  if (d.toDateString() === new Date(now).toDateString()) return hhmm(ms);
  return `${d.toLocaleDateString("vi-VN", { weekday: "short" })} ${hhmm(ms)}`;
}

function Totals({ t, cap }: { t: Tokens; cap: number }) {
  const over = t.median_ctx != null && t.median_ctx > cap;
  const items: [string, string, boolean?][] = [
    ["Tổng token", fmt(sum(t))],
    ["Input", fmt(t.input)],
    ["Cache đọc", fmt(t.cache_read)],
    ["Cache ghi", fmt(t.cache_write)],
    ["Output", fmt(t.output)],
    ["Context trung vị/lượt", fmt(t.median_ctx), over],
    ["Lượt gọi", t.calls.toLocaleString("vi-VN")],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border px-3 py-3 sm:grid-cols-4 lg:grid-cols-7">
      {items.map(([k, v, warn]) => (
        <div key={k} className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">{k}</dt>
          <dd className={cn("text-lg font-semibold tabular", warn && "text-st-needs")} title={warn ? `Trên mức nén ${fmt(cap)} của phòng team` : undefined}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type ListProps = { rows: UsageRow[]; period: Period; sort: SortKey; setSort: (k: SortKey) => void; cap: number };

function place(r: UsageRow): string {
  return r.project ? `${r.project.name}${r.project.branch ? ` · ${r.project.branch}` : ""}` : "ngoài git";
}

/** Desktop and tablet: one row per room, every column sortable (descending). */
function RoomTable({ rows, period, sort, setSort, cap }: ListProps) {
  const cols = SORTS.filter((c) => c.key !== "total");
  return (
    <div className="hidden overflow-x-auto rounded-lg border md:block">
      <table className="w-full min-w-[52rem] text-sm">
        <caption className="sr-only">Token theo phòng, sắp theo {SORTS.find((c) => c.key === sort)?.label}</caption>
        <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Phòng
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Dự án · nhánh
            </th>
            {[SORTS[0], ...cols].map((c) => (
              <th key={c.key} scope="col" aria-sort={sort === c.key ? "descending" : "none"} className="px-1 py-1 text-right font-medium">
                <button
                  type="button"
                  onClick={() => setSort(c.key)}
                  title={`Sắp theo ${c.label}`}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1 rounded-md px-2 transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
                    sort === c.key && "text-foreground",
                  )}
                >
                  {c.short}
                  <ArrowDownIcon aria-hidden className={cn("size-3", sort !== c.key && "invisible")} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const t = r[period];
            const over = t.median_ctx != null && t.median_ctx > cap;
            return (
              <tr key={r.session_id} className="hover:bg-muted/40">
                <th scope="row" className="max-w-48 px-3 py-2 text-left font-medium">
                  <span className="block truncate" title={`${r.key} · ${r.session_id}`}>
                    {r.label}
                  </span>
                  {r.model && <span className="block font-mono text-[11px] font-normal text-muted-foreground">{r.model.replace(/^claude-/, "")}</span>}
                </th>
                <td className="max-w-48 truncate px-3 py-2 text-muted-foreground" title={r.project?.root}>
                  {place(r)}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular">{fmt(sum(t))}</td>
                <td className="px-3 py-2 text-right tabular">{fmt(t.input)}</td>
                <td className="px-3 py-2 text-right tabular">{fmt(t.cache_read)}</td>
                <td className="px-3 py-2 text-right tabular">{fmt(t.cache_write)}</td>
                <td className="px-3 py-2 text-right tabular">{fmt(t.output)}</td>
                <td className={cn("px-3 py-2 text-right tabular", over && "font-medium text-st-needs")} title={over ? `Trên mức nén ${fmt(cap)}` : undefined}>
                  {fmt(t.median_ctx)}
                </td>
                <td className="px-3 py-2 text-right tabular">{t.calls.toLocaleString("vi-VN")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Phones: stacked rows, a sort picker instead of column headers. */
function RoomList({ rows, period, sort, setSort, cap }: ListProps) {
  return (
    <div className="space-y-2 md:hidden">
      <div className="flex items-center justify-end gap-2">
        <span id="usage-sort-l" className="text-xs text-muted-foreground">
          Sắp theo
        </span>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger aria-labelledby="usage-sort-l" className="min-h-11 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((c) => (
              <SelectItem key={c.key} value={c.key} className="min-h-11">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ul className="divide-y rounded-lg border">
        {rows.map((r) => {
          const t = r[period];
          const over = t.median_ctx != null && t.median_ctx > cap;
          return (
            <li key={r.session_id} className="space-y-2 px-3 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={`${r.key} · ${r.session_id}`}>
                    {r.label}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {place(r)}
                    {r.model && ` · ${r.model.replace(/^claude-/, "")}`}
                  </p>
                </div>
                <p className="shrink-0 text-base font-semibold tabular">{fmt(sum(t))}</p>
              </div>
              <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                {(
                  [
                    ["Input", fmt(t.input)],
                    ["Cache đọc", fmt(t.cache_read)],
                    ["Cache ghi", fmt(t.cache_write)],
                    ["Output", fmt(t.output)],
                    ["Context/lượt", fmt(t.median_ctx)],
                    ["Lượt", t.calls.toLocaleString("vi-VN")],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="truncate text-muted-foreground">{k}</dt>
                    <dd className={cn("tabular", k === "Context/lượt" && over && "font-medium text-st-needs")}>{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
