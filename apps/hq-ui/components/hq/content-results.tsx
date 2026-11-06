"use client";

// What the rooms reported back for the content book (owner 2026-11-05): per item in the day sheet
// ("Kết quả": the Meta link, the proof images, the newest numbers), and the "Tổng quan" sub-tab that
// sums the newest numbers per platform over a date range. Data: GET /api/content/results (owner only).
import { BarChart3Icon, ExternalLinkIcon, EyeIcon, FileIcon, ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { artifactFileUrl, KIND_LABEL, linkLabel, type Artifact } from "@/lib/artifacts";
import { dayKey, FORMAT_LABEL, timeOf, whenOf, type ContentRow } from "@/lib/content";
import { METRIC_FIELDS, METRIC_LABEL, platformLabel, shortNumber, totalsByPlatform, type ContentResults, type DigestRow, type MetricRow } from "@/lib/content-metrics";
import { agoShort } from "@/lib/now";
import { cn } from "@/lib/utils";
import { Lightbox, UploadThumb, type Shown } from "./attachments";
import { EmptyState } from "./bits";
import { FORMAT_TONE, STATUS_EDGE, StatusIcon } from "./content-bits";
import { FolderButton } from "./folder-button";
import { TOUCH } from "./room-send";
import type { Api } from "./use-hq";

export type ResultIndex = { arts: Map<number, Artifact[]>; metrics: Map<number, MetricRow[]> };
export const NO_RESULTS: ResultIndex = { arts: new Map(), metrics: new Map() };

/** Artifacts and newest readings per content id (an artifact of several items is under each). */
export function indexResults(r: ContentResults | null): ResultIndex {
  if (!r) return NO_RESULTS;
  const arts = new Map<number, Artifact[]>();
  for (const a of r.artifacts) for (const id of a.content) arts.set(id, [...(arts.get(id) ?? []), a]);
  const metrics = new Map<number, MetricRow[]>();
  for (const m of r.metrics) metrics.set(m.content_id, [...(metrics.get(m.content_id) ?? []), m]);
  return { arts, metrics };
}

/** The links of an item's results, newest first, each once. */
const linksOf = (arts: readonly Artifact[]) => [...new Map(arts.filter((a) => a.link).map((a) => [a.link as string, a])).values()];

/** A small mark in the collapsed row: this item has results. */
export function ResultMark({ arts, metrics }: { arts?: Artifact[]; metrics?: MetricRow[] }) {
  const n = arts?.length ?? 0;
  if (!n && !metrics?.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-st-running" title={`${n} kết quả${metrics?.length ? " · có số liệu" : ""}`}>
      {metrics?.length ? <BarChart3Icon className="size-3" aria-hidden /> : <ImageIcon className="size-3" aria-hidden />}
      {n > 0 && n}
    </span>
  );
}

function MetricLine({ m, now }: { m: MetricRow; now: number }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
      <span className="font-medium text-foreground">{platformLabel(m.platform)}</span>
      {METRIC_FIELDS.filter((f) => m[f] !== null).map((f) => (
        <span key={f} className="text-muted-foreground">
          {METRIC_LABEL[f]} <span className="font-medium text-foreground tabular-nums">{shortNumber(m[f])}</span>
        </span>
      ))}
      <span className="text-muted-foreground" title={new Date(m.captured_at).toLocaleString("vi-VN")}>
        đọc {agoShort(m.captured_at, now)}
        {m.readings > 1 && ` · ${m.readings} lần`}
      </span>
    </p>
  );
}

const STRIP_THUMBS = 4;

/**
 * The report of one item right in the day sheet's collapsed row (owner 2026-11-05: "báo cáo đó ở bên
 * [lịch]"): its links ("Mở trên Meta") and the first proof images, so a day's posts show what the rooms
 * reported without opening each one. Nothing when the item has no report.
 */
export function ResultStrip({ token, arts = [] }: { token: string; arts?: Artifact[] }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const links = linksOf(arts);
  const images = arts.filter((a) => a.kind === "image" && !a.missing);
  if (!links.length && !images.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Báo cáo của bài">
      {links.map((a) => (
        <Button key={a.link} asChild size="sm" variant="outline" className={cn("h-7 max-w-full text-xs", TOUCH)}>
          <a href={a.link as string} target="_blank" rel="noopener noreferrer" title={a.link as string}>
            <ExternalLinkIcon aria-hidden />
            <span className="truncate">{linkLabel(a.link as string)}</span>
          </a>
        </Button>
      ))}
      {images.slice(0, STRIP_THUMBS).map((a) => (
        <UploadThumb key={a.id} token={token} file={{ id: a.id, name: a.title, url: artifactFileUrl(a.id) }} onOpen={setShown} className="size-10" />
      ))}
      {images.length > STRIP_THUMBS && <span className="text-xs text-muted-foreground tabular-nums">+{images.length - STRIP_THUMBS} ảnh</span>}
      <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
    </div>
  );
}

/** "Kết quả" of one item in the day sheet; a reported file opens in Kết quả ("Xem") or its folder. */
export function ItemResults({
  id,
  token,
  api,
  arts = [],
  metrics = [],
  now,
  onOpenFile,
}: {
  id: number;
  token: string;
  api: Api;
  arts?: Artifact[];
  metrics?: MetricRow[];
  now: number;
  onOpenFile?: (id: string) => void;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const links = linksOf(arts);
  const images = arts.filter((a) => a.kind === "image" && !a.missing);
  const files = arts.filter((a) => a.kind !== "image" || a.missing);
  if (!arts.length && !metrics.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Chưa có. Phòng báo bằng <code className="font-mono">hq.mjs artifact add &lt;ảnh&gt; --content {id} --link &lt;url&gt;</code>.
      </p>
    );
  }
  return (
    // Laid out by its own width (the day pane can be narrow): 2 thumbnails a row, 3 from 28rem, 4 from 42rem.
    <div className="@container/results space-y-2">
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((a) => (
            <Button key={a.link} asChild size="sm" variant="outline" className={cn("h-7 max-w-full text-xs", TOUCH)}>
              <a href={a.link as string} target="_blank" rel="noopener noreferrer" title={a.link as string}>
                <ExternalLinkIcon aria-hidden />
                <span className="truncate">{linkLabel(a.link as string)}</span>
              </a>
            </Button>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 @md/results:grid-cols-3 @2xl/results:grid-cols-4">
          {images.map((a) => (
            <figure key={a.id} className="min-w-0 space-y-1">
              <UploadThumb token={token} file={{ id: a.id, name: a.title, url: artifactFileUrl(a.id) }} onOpen={setShown} className="aspect-[4/3] w-full" />
              <figcaption className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={a.note ?? a.title}>
                {a.title}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {files.map((a) => (
            <li key={a.id} className="flex min-w-0 items-start gap-1.5">
              <FileIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
              {/* The name wraps to two lines before it truncates: a narrow pane keeps the actions on the row. */}
              <span className="line-clamp-2 min-w-0 flex-1 pt-px wrap-anywhere text-foreground" title={a.path}>
                {a.title}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {a.missing ? (
                  <span>file đã mất</span>
                ) : (
                  <>
                    <span className="@max-xs/results:sr-only">{KIND_LABEL[a.kind]}</span>
                    {onOpenFile && (
                      <Button type="button" size="xs" variant="outline" className={cn("shrink-0", TOUCH)} onClick={() => onOpenFile(a.id)} title="Mở file ở tab Kết quả">
                        <EyeIcon aria-hidden /> Xem
                      </Button>
                    )}
                  </>
                )}
                <FolderButton path={a.path} id={a.missing ? undefined : a.id} api={api} className="shrink-0" />
              </span>
            </li>
          ))}
        </ul>
      )}
      {metrics.map((m) => (
        <MetricLine key={m.platform} m={m} now={now} />
      ))}
      <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
    </div>
  );
}

const RANGES = [
  ["7", "7 ngày"],
  ["30", "30 ngày"],
  ["all", "Tất cả"],
] as const;
type Range = (typeof RANGES)[number][0];

const digestWord: Record<DigestRow["status"], string> = { sent: "đã gửi", sending: "đang gửi", skipped: "bỏ qua (máy tắt cả ngày)" };

/** Nội dung › Tổng quan: per platform totals of each post's newest numbers, then one line per post. */
export function ContentOverview({ items, results, error, now, onOpen }: { items: ContentRow[]; results: ContentResults | null; error: string | null; now: number; onOpen: (it: ContentRow) => void }) {
  const [range, setRange] = useState<Range>("7");
  const idx = useMemo(() => indexResults(results), [results]);
  const from = range === "all" ? -Infinity : now - Number(range) * 24 * 3600_000;
  const posts = useMemo(
    () =>
      items
        .filter((it) => it.status !== "rejected")
        .filter((it) => {
          const at = whenOf(it);
          return at != null && at >= from && at <= now + 24 * 3600_000;
        })
        .sort((a, b) => (whenOf(b) ?? 0) - (whenOf(a) ?? 0)),
    [items, from, now],
  );
  const inView = useMemo(() => new Set(posts.map((p) => p.id)), [posts]);
  const totals = useMemo(() => totalsByPlatform(results?.metrics ?? [], (m) => inView.has(m.content_id)), [results, inView]);
  const read = posts.filter((p) => idx.metrics.has(p.id)).length;
  const lastDigest = results?.digest[0];

  if (error && !results) return <p className="text-xs text-destructive">Không đọc được số liệu: {error}</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ButtonGroup aria-label="Khoảng thời gian">
          {RANGES.map(([r, label]) => (
            <Button key={r} type="button" size="sm" variant={range === r ? "secondary" : "outline"} aria-pressed={range === r} className={cn("text-xs", TOUCH)} onClick={() => setRange(r)}>
              {label}
            </Button>
          ))}
        </ButtonGroup>
        <span className="text-xs text-muted-foreground tabular-nums">
          {posts.length} bài trong khoảng (trừ bài bỏ) · {read} bài có số liệu
        </span>
        {lastDigest && (
          <span className="ml-auto text-xs text-muted-foreground" title={lastDigest.session ?? undefined}>
            Kiểm số cuối ngày {lastDigest.day.slice(8, 10)}/{lastDigest.day.slice(5, 7)}: {digestWord[lastDigest.status]} {agoShort(lastDigest.at, now)}
          </span>
        )}
      </div>

      {totals.length === 0 ? (
        <EmptyState icon={<BarChart3Icon />} title="Chưa có số liệu trong khoảng này" className="max-w-md py-8">
          <p>
            Sau giờ đăng cuối của mỗi ngày, HQ nhờ phòng sổ nội dung (cpa-live, không live thì core) đọc số từng bài bằng profile &quot;8sync FB&quot; một lần rồi ghi vào đây.
          </p>
        </EmptyState>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {totals.map((t) => (
            <section key={t.platform} aria-label={platformLabel(t.platform)} className="rounded-lg border p-3">
              <h3 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                {platformLabel(t.platform)}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{t.posts} bài</span>
              </h3>
              <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
                {METRIC_FIELDS.map((f) => (
                  <div key={f} className="min-w-0">
                    <dt className="truncate text-[11px] text-muted-foreground">{METRIC_LABEL[f]}</dt>
                    <dd className="text-base font-semibold tabular-nums">{shortNumber(t[f])}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground">mới nhất {agoShort(t.last, now)} · tổng số mới nhất của từng bài</p>
            </section>
          ))}
        </div>
      )}

      {posts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Giờ</th>
                <th className="px-3 py-2 font-medium">Bài</th>
                <th className="px-3 py-2 font-medium">Số liệu</th>
                <th className="px-3 py-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {posts.map((it) => {
                const at = whenOf(it) as number;
                const ms = idx.metrics.get(it.id) ?? [];
                // fb_post_url is free text an editor guest can PATCH: only http(s) becomes a link (no `javascript:` in HQ's origin).
                const fb = it.fb_post_url && /^https?:\/\//i.test(it.fb_post_url) ? it.fb_post_url : null;
                const link = fb ?? ms.find((m) => m.url)?.url ?? linksOf(idx.arts.get(it.id) ?? [])[0]?.link ?? null;
                return (
                  <tr key={it.id} className="align-top">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {dayKey(at).slice(8, 10)}/{dayKey(at).slice(5, 7)} {timeOf(at)}
                    </td>
                    <td className="w-[21.5rem] px-3 py-2">
                      <button type="button" onClick={() => onOpen(it)} title={`#${it.id} ${it.title}`} className="flex max-w-[20rem] min-w-0 items-center gap-1.5 rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
                        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", FORMAT_TONE[it.format], STATUS_EDGE[it.status])}>
                          <StatusIcon status={it.status} />
                          {FORMAT_LABEL[it.format]}
                        </span>
                        <span className="truncate">
                          #{it.id} {it.title}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2">{ms.length ? ms.map((m) => <MetricLine key={m.platform} m={m} now={now} />) : <span className="text-xs text-muted-foreground">chưa đọc</span>}</td>
                    <td className="px-3 py-2">
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-foreground underline-offset-2 hover:underline" title={link}>
                          <ExternalLinkIcon aria-hidden className="size-3" /> {linkLabel(link)}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
