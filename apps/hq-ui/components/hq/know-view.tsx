"use client";
import { BookOpenIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { type Book, type Know, parseKnow } from "@/lib/know";
import { rootKey } from "@/lib/preview";
import { EmptyState, ErrorNote, shortName } from "./bits";

/** The Tri thức tab: the machine's knowledge tree (`8sync ccc know`), the chosen project's book first, the others under their root. */
export function KnowView({ token, roots, repo, active }: { token: string; roots: { root: string; name: string }[]; repo: string | null; active: boolean }) {
  const [pick, setPick] = useState<string | null>(repo);
  const chosen = useMemo(() => (pick && roots.some((r) => rootKey(r.root) === rootKey(pick)) ? pick : (roots[0]?.root ?? null)), [pick, roots]);
  const [data, setData] = useState<(Know & { error?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // GET /api/know for the chosen project each time the tab shows or the owner reloads; state is set after the await.
  useEffect(() => {
    if (!active || !chosen) return;
    const ac = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/know?root=${encodeURIComponent(chosen)}`, { headers: { "x-hq-token": token }, cache: "no-store", signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const v = parseKnow(await r.json()) as Know & { error?: string };
        setData(v);
        setError(null);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "failed");
      }
    })();
    return () => ac.abort();
  }, [active, chosen, token, tick]);
  const loading = data == null && error == null;

  if (!roots.length) {
    return (
      <div className="p-4 sm:px-6">
        <EmptyState icon={<BookOpenIcon />} title="Chưa có phòng nào đang chạy">
          Cây tri thức hiện theo dự án đang có phòng. Mở team rồi quay lại.
        </EmptyState>
      </div>
    );
  }
  const n = (data?.own?.lessons.length ?? 0) + (data?.others.reduce((s, b) => s + b.lessons.length, 0) ?? 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 sm:px-6">
        <Select value={chosen ?? ""} onValueChange={setPick}>
          <SelectTrigger size="sm" className="w-56" aria-label="Dự án">
            <SelectValue placeholder="Dự án" />
          </SelectTrigger>
          <SelectContent>
            {roots.map((r) => (
              <SelectItem key={r.root} value={r.root}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground tabular">{data ? `${n} bài học` : ""}</span>
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={reload} disabled={loading} aria-label="Tải lại">
          <RefreshCwIcon aria-hidden className={loading ? "animate-spin" : undefined} /> Tải lại
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6">
        {error ? (
          <ErrorNote what="tri thức" error={error} onRetry={reload} />
        ) : !data ? (
          <Skeleton className="h-24 w-full" />
        ) : data.error ? (
          <EmptyState icon={<BookOpenIcon />} title="8sync chưa có `ccc know`">
            {data.error}
          </EmptyState>
        ) : n === 0 ? (
          <EmptyState icon={<BookOpenIcon />} title="Cây tri thức còn trống">
            Phòng ghi bài học dùng được ở mọi dự án bằng <code className="font-mono">8sync ccc know add &quot;&lt;bài học&gt;&quot;</code> (hoặc qua <code className="font-mono">/remember</code>). Chuyện riêng của repo vẫn ở su-code/KNOWLEDGE.md.
          </EmptyState>
        ) : (
          <div className="space-y-6">
            <BookBlock book={data.own} title="Dự án này" empty="Dự án này chưa có bài học chung." />
            {data.others.length > 0 && (
              <section>
                <h3 className="mb-2 text-[13px] font-semibold">Dự án khác trên máy này <span className="font-normal text-muted-foreground">(đọc để học, không áp dụng mù)</span></h3>
                <div className="space-y-4">
                  {data.others.map((b) => (
                    <BookBlock key={b.root} book={b} title={shortName(b.root.split("/").pop() ?? b.root)} sub={b.root} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BookBlock({ book, title, sub, empty }: { book: Book | null; title: string; sub?: string; empty?: string }) {
  const lessons = book?.lessons ?? [];
  return (
    <section>
      <h3 className="text-[13px] font-semibold">
        {title}
        {sub && <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">{sub}</span>}
      </h3>
      {lessons.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{empty ?? "Chưa có bài học."}</p>
      ) : (
        <ol className="mt-1.5 max-w-[80ch] space-y-1">
          {[...lessons].reverse().map((l, i) => (
            <li key={i} className="text-[13px] leading-snug">
              <span className="mr-2 text-[11px] text-muted-foreground tabular">{l.day ?? ""}</span>
              {l.room && <span className="mr-2 rounded-sm bg-muted px-1 text-[11px] font-medium text-muted-foreground">{l.room}</span>}
              {l.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
