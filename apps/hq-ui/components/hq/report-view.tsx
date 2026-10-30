"use client";

import { rootKey } from "@/lib/preview";
import { repoOf } from "@/lib/sidebar";
import { BarChart3Icon } from "lucide-react";
import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDuration, fmtTokens, fmtUsd, officeTotals } from "@/lib/office";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote, StatusDot } from "./bits";
import type { OfficeState, Room } from "./use-office";

function Num({ v, className }: { v: string; className?: string }) {
  return <td className={cn("px-3 py-2 text-right tabular", v === "chưa đo" && "text-muted-foreground", className)}>{v}</td>;
}

/** Cost, context, time and lines per room (session), with totals. Same numbers as `8sync ccc . report`. */
export function ReportView({ data: { office, error, retry }, onOpen, repo = null }: { data: OfficeState; onOpen: (room: Room) => void; repo?: string | null }) {
  // The sidebar's repo: only its rooms (worktree rooms count under their repo, like the sidebar).
  const rooms = useMemo(() => {
    const all = office?.rooms ?? [];
    if (!repo) return all;
    const k = rootKey(repo);
    return all.filter((r) => rootKey(repoOf(r.project?.root ?? r.cwd ?? "").root) === k);
  }, [office, repo]);
  const t = useMemo(() => officeTotals(rooms), [rooms]);

  if (error && !office)
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <ErrorNote what="báo cáo" error={error} onRetry={retry} />
      </div>
    );
  if (!office)
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-5 sm:px-6" aria-busy="true">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-5 sm:px-6">
        {rooms.length === 0 ? (
          <EmptyState icon={<BarChart3Icon />} title="Chưa có số liệu">
            Báo cáo đọc từ các session đang chạy. Mở một session Claude Code, số liệu hiện sau lượt đầu tiên.
          </EmptyState>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
              {[
                ["Phòng", String(t.rooms)],
                ["Chi phí", fmtUsd(t.cost_usd)],
                ["Context đang dùng", fmtTokens(t.tokens)],
                ["Thời gian", fmtDuration(t.duration_ms)],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className={cn("text-lg font-semibold tabular", v === "chưa đo" && "text-base font-normal text-muted-foreground")}>{v}</dd>
                </div>
              ))}
            </dl>

            <div className="relative overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[46rem] text-sm">
                <caption className="sr-only">Số liệu theo phòng</caption>
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {/* Sticky: on a phone the numbers scroll sideways under the room names (opaque mixes of the same tints). */}
                    <th scope="col" className="sticky left-0 bg-[color-mix(in_oklch,var(--muted)_50%,var(--background))] px-3 py-2 text-left font-medium">Phòng</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Dự án · nhánh</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Model</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Context</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Chi phí</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Thời gian</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Dòng +/−</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...rooms]
                    .sort((a, b) => (b.usage?.cost_usd ?? -1) - (a.usage?.cost_usd ?? -1))
                    .map((r) => (
                      <tr key={r.key} className="group/row hover:bg-muted/40">
                        <th scope="row" className="sticky left-0 max-w-56 bg-background px-3 py-2 text-left font-medium group-hover/row:bg-[color-mix(in_oklch,var(--muted)_40%,var(--background))]">
                          <button
                            type="button"
                            onClick={() => onOpen(r)}
                            className="flex min-w-0 items-center gap-2 text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <StatusDot status={r.status} />
                            <span className="truncate">{r.label}</span>
                          </button>
                        </th>
                        <td className="max-w-48 truncate px-3 py-2 text-muted-foreground" title={r.project?.root ?? r.cwd ?? undefined}>
                          {r.project ? `${r.project.name}${r.project.branch ? ` · ${r.project.branch}` : ""}` : (r.cwd ?? "?")}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.model?.replace(/^claude-/, "") ?? "chưa đo"}</td>
                        <Num v={fmtTokens(r.tokens)} />
                        <Num v={fmtUsd(r.usage?.cost_usd)} />
                        <Num v={fmtDuration(r.usage?.duration_ms)} />
                        <Num v={r.usage?.lines_added != null ? `+${r.usage.lines_added} −${r.usage.lines_removed ?? 0}` : "chưa đo"} />
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {office.loops.length > 0 && (
              <section aria-labelledby="loops-h" className="space-y-2">
                <h2 id="loops-h" className="text-sm font-semibold">Vòng lặp /ship-loop</h2>
                <ul className="divide-y rounded-lg border text-sm">
                  {office.loops.map((l) => (
                    <li key={`${l.project}/${l.slug}`} className="flex min-w-0 items-center gap-3 px-3 py-2">
                      <span className="truncate font-medium">{l.slug}</span>
                      <span className="text-xs text-muted-foreground">{l.project}</span>
                      <span className="ml-auto shrink-0 text-xs tabular">
                        lượt {l.iter}
                        {l.max_iter != null && `/${l.max_iter}`}
                      </span>
                      <span className={cn("shrink-0 text-xs", l.stopped ? "text-muted-foreground" : "font-medium text-st-running")}>
                        {l.stopped ? `dừng: ${l.stopped}` : "đang chạy"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="max-w-[70ch] text-xs text-muted-foreground">
              Nguồn: chi phí và số dòng là con số Claude Code đưa cho status line của 8sync (lưu ở{" "}
              <code className="font-mono">~/.local/state/8sync/hq/usage</code>); model và thời gian đọc từ transcript của phòng khi chưa có
              status line; context từ <code className="font-mono">8sync ls</code>. Chưa có số thật thì ghi &quot;chưa đo&quot;, không ước lượng.
              Trong terminal: <code className="font-mono">8sync ccc . report</code>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
