"use client";
import { BookOpenIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { feedProjects, filterFeed, lessonFeed, type Know, parseKnow } from "@/lib/know";
import { cn } from "@/lib/utils";
import { rootKey } from "@/lib/preview";
import { EmptyState, ErrorNote } from "./bits";

/**
 * The Tri thức tab: every book of the machine (`8sync ccc know`) as ONE feed, newest first, each lesson
 * tagged with its project (owner 2026-10-22: "gom all … vẫn hiểu đúng dự án"); chips narrow it to a project.
 */
export function KnowView({ token, roots, repo, active }: { token: string; roots: { root: string; name: string }[]; repo: string | null; active: boolean }) {
  // The API answers every book whatever root it is asked for; the root only marks which one is "own".
  const chosen = useMemo(() => (repo && roots.some((r) => rootKey(r.root) === rootKey(repo)) ? repo : (roots[0]?.root ?? null)), [repo, roots]);
  const [only, setOnly] = useState<string | null>(null);
  const [q, setQ] = useState("");
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
          Cây tri thức hiện theo dự án đang có phòng. Mở một session rồi quay lại.
        </EmptyState>
      </div>
    );
  }
  const feed = data ? lessonFeed(data) : [];
  const n = feed.length;
  const projects = feedProjects(feed);
  const shown = filterFeed(feed, only, q);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 sm:px-6">
        <div className="relative w-full max-w-72">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm bài học, phòng, dự án" aria-label="Tìm trong tri thức" className="h-8 pl-7 text-sm" />
        </div>
        <span className="text-xs text-muted-foreground tabular">{data ? `${shown.length}/${n} bài học` : ""}</span>
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={reload} disabled={loading} aria-label="Tải lại">
          <RefreshCwIcon aria-hidden className={loading ? "animate-spin" : undefined} /> Tải lại
        </Button>
        {projects.length > 1 && (
          <div className="flex w-full flex-wrap gap-1.5" role="group" aria-label="Lọc theo dự án">
            <Chip on={only == null} onClick={() => setOnly(null)}>
              Tất cả · {n}
            </Chip>
            {projects.map((p) => (
              <Chip key={p.project} on={only === p.project} onClick={() => setOnly(only === p.project ? null : p.project)}>
                {p.project} · {p.n}
              </Chip>
            ))}
          </div>
        )}
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
            Phòng ghi bài học của dự án bằng <code className="font-mono">8sync ccc know add &quot;&lt;bài học&gt;&quot;</code>, bài học đúng cho mọi dự án thêm <code className="font-mono">--shared</code> (hoặc qua <code className="font-mono">/remember</code>). Chuyện riêng của repo vẫn ở su-code/KNOWLEDGE.md.
          </EmptyState>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không có bài học khớp.</p>
        ) : (
          <ol className="max-w-[90ch] divide-y" aria-label="Bài học của mọi dự án, mới nhất trước">
            {shown.map((l, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 text-[13px] leading-snug">
                <span
                  className={cn(
                    "shrink-0 rounded-sm px-1.5 text-[11px] font-medium",
                    l.kind === "shared" ? "bg-primary/15 text-primary" : l.kind === "own" ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground",
                  )}
                  title={l.kind === "shared" ? "Bài học cho mọi dự án" : l.root}
                >
                  {l.project}
                </span>
                {l.room && <span className="shrink-0 text-[11px] text-muted-foreground">{l.room}</span>}
                <span className="min-w-0 flex-1 basis-64">{l.text}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular">{l.day ?? ""}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
