"use client";

import { RepeatIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { entryFor, useFollowRepo } from "@/lib/follow-repo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { agoShort } from "@/lib/now";
import type { ProjectLoops } from "@/lib/server/loops";
import { cn } from "@/lib/utils";
import { ErrorNote } from "./bits";

export type LoopsState = { data: { projects: ProjectLoops[] } | null; error: string | null; at: number };

/** "Vòng lặp" tab: each `/ship-loop` of the project in view, read from `su-code/ship/*`. */
export function LoopsView({ loops, repo = null }: { loops: LoopsState; repo?: string | null }) {
  const [pick, setPick] = useState<string | null>(repo);
  useFollowRepo(repo, setPick);
  const list = useMemo(() => loops.data?.projects ?? [], [loops.data]);
  const cur = (pick ? entryFor(list, pick) : undefined) ?? list[0];
  const rows = cur?.loops ?? [];
  const now = loops.at;

  return (
    <div className="h-full overflow-y-auto">
      <section aria-labelledby="loops" className="max-w-5xl space-y-3 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 id="loops" className="flex items-center gap-1.5 text-sm font-semibold">
            <RepeatIcon aria-hidden className="size-3.5 text-muted-foreground" />
            Vòng lặp
            <span className="text-xs font-normal text-muted-foreground">/ship-loop, đọc từ su-code/ship/*/LOOP.md</span>
          </h2>
          {list.length > 1 && (
            <Select value={cur?.root ?? ""} onValueChange={setPick}>
              <SelectTrigger size="sm" className="ml-auto max-w-64 text-xs" aria-label="Dự án">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.map((p) => (
                  <SelectItem key={p.root} value={p.root} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {loops.error && !loops.data ? (
          <ErrorNote what="vòng lặp" error={loops.error} />
        ) : !loops.data ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Chưa có vòng lặp nào{cur ? ` trong ${cur.name}` : ""}. Khi anh chạy <code className="font-mono">/ship-loop</code>, mỗi lượt kiểm ghi một dòng bằng chứng ở đây.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {rows.map((l) => (
              <li key={l.slug} className="grid grid-cols-[minmax(8rem,14rem)_auto_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-2">
                <span className="truncate font-medium" title={l.slug}>
                  {l.slug}
                </span>
                <span className="text-xs whitespace-nowrap tabular">
                  {l.iter != null ? `lượt ${l.iter}${l.maxIter != null ? `/${l.maxIter}` : ""}` : "chưa chạy lượt"}
                  <span className={cn("ml-2", l.running ? "font-medium text-st-running" : "text-muted-foreground")}>{l.running ? "đang chạy" : l.stopped ? `dừng: ${l.stopped}` : "không rõ"}</span>
                </span>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={l.last ?? undefined}>
                  {l.last ?? "chưa có bằng chứng"} <span className="font-sans">· {agoShort(l.at, now)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
