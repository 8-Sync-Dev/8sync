"use client";

// "Báo cáo" under a room (owner 2026-11-05: "split ngang dưới là report đăng có link lên meta, ảnh chứng
// minh, notes"): what the room reported with `hq.mjs artifact add --session <room>`, one row per post
// (files with the same --link fold together), with the open button, proof thumbnails, note and the
// Nội dung posts it is about. Wide screen: a bottom split, dragged taller or folded to its title row
// (the size, folded or not, kept per browser). Phone: a section in the room's scroll.
import { ChevronDownIcon, ExternalLinkIcon, FileIcon, MegaphoneIcon } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePanelRef, useDefaultLayout } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { artifactFileUrl, baseName, KIND_LABEL, openLabel, reportsOf, roomRefs, type ArtifactView, type Report } from "@/lib/artifacts";
import { STATUS_LABEL, type ContentRow } from "@/lib/content";
import { agoVi } from "@/lib/now";
import { cn } from "@/lib/utils";
import { Lightbox, UploadThumb, type Shown } from "./attachments";
import { ErrorNote } from "./bits";
import { StatusIcon, STATUS_TONE } from "./content-bits";
import { TOUCH } from "./room-send";
import type { Room } from "./use-office";
import { makeApi } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 15_000;
/** Post titles and states move slowly; read only when a report names a post. */
const CONTENT_POLL_MS = 60_000;
/** The folded pane: its title row only (h-10). */
const HEAD_PX = 40;
/** The open pane: smallest height, and the share of the room it opens at. */
const OPEN_MIN_PX = 140;
const OPEN_PCT = "30";
const LIST_MAX = 100;
/** Phone: the section folded or open, per browser. */
const FOLD_KEY = "hq-room-report-folded";

type Pane = { folded: boolean; toggle: () => void };
const PaneCtx = createContext<Pane | null>(null);

/**
 * The room view with "Báo cáo" under it: `children` (chat, Nhật ký, message box) above, `pane` below,
 * the border between them dragged; folding leaves the pane's title row.
 */
export function ReportSplit({ children, pane }: { children: ReactNode; pane: ReactNode }) {
  const layout = useDefaultLayout({ id: "hq-room-report", panelIds: ["room", "report"] });
  const ref = usePanelRef();
  const [folded, setFolded] = useState(false);
  const toggle = useCallback(() => {
    const p = ref.current;
    if (!p) return;
    if (!p.isCollapsed()) return p.collapse();
    p.expand();
    // Folded in an earlier visit, the pane has no open height to go back to and stops at its minimum.
    if (p.getSize().inPixels <= OPEN_MIN_PX + 1) p.resize(OPEN_PCT);
  }, [ref]);
  const ctx = useMemo(() => ({ folded, toggle }), [folded, toggle]);
  return (
    <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <ResizablePanel id="room" minSize="30" className="flex min-h-0 flex-col">
        {children}
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Kéo để đổi chiều cao phần Báo cáo" />
      <ResizablePanel
        id="report"
        panelRef={ref}
        defaultSize={OPEN_PCT}
        minSize={OPEN_MIN_PX}
        maxSize="70"
        collapsible
        collapsedSize={HEAD_PX}
        onResize={(s) => setFolded(s.inPixels <= HEAD_PX + 1)}
        className="min-h-0"
      >
        <PaneCtx.Provider value={ctx}>{pane}</PaneCtx.Provider>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** Phone: folded or open, kept in localStorage (the wide pane keeps its own in its layout). */
function useFold(): Pane {
  // Only shown on a phone, after hydration (useIsMobile is false on the server): storage is there.
  const [folded, setFolded] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(FOLD_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setFolded((f) => {
      try {
        localStorage.setItem(FOLD_KEY, f ? "0" : "1");
      } catch {
        /* storage off: this visit only */
      }
      return !f;
    });
  }, []);
  return useMemo(() => ({ folded, toggle }), [folded, toggle]);
}

type Scope = "room" | "project";

/** The room's reports, newest first; "Cả dự án" switches to every report about the room's project. */
export function RoomReport({ room, token }: { room: Room; token: string }) {
  const api = useMemo(() => makeApi(token), [token]);
  const split = useContext(PaneCtx);
  const phone = useFold();
  const { folded, toggle } = split ?? phone;
  const root = room.project?.root ?? null;
  const [scope, setScope] = useState<Scope>("room");
  const cur: Scope = scope === "project" && root ? "project" : "room";
  const refs = roomRefs(room);
  const q = new URLSearchParams({ limit: String(LIST_MAX) });
  if (cur === "project" && root) q.set("root", root);
  else for (const r of refs) q.append("session", r);
  const url = `/api/artifacts?${q}`;
  // A room HQ cannot name (no hq name or session id) has no reports of its own.
  const on = cur === "project" || refs.length > 0;
  const list = usePoll<{ artifacts: ArtifactView[]; at: number }>(api, url, POLL_MS, on);
  const reports = useMemo(() => reportsOf(list.data?.artifacts ?? []), [list.data]);
  const wantPosts = reports.some((r) => r.content.length > 0);
  const content = usePoll<{ configured: boolean; ready?: boolean; items?: ContentRow[] }>(api, "/api/content", CONTENT_POLL_MS, wantPosts);
  const posts = useMemo(() => new Map((content.data?.items ?? []).map((it) => [it.id, it])), [content.data]);
  const [shown, setShown] = useState<Shown | null>(null);
  // When the list was read: its "x phút trước" labels move with each poll.
  const now = list.at;

  return (
    <section aria-labelledby="room-report-title" className={cn("flex min-h-0 flex-col bg-background", split ? "h-full" : "mt-6 rounded-xl border")}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!folded}
          aria-controls="room-report-list"
          className={cn("-ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60", TOUCH)}
        >
          <ChevronDownIcon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", folded && "-rotate-90")} />
          <MegaphoneIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span id="room-report-title">Báo cáo</span>
          {reports.length > 0 && <span className="text-xs font-normal text-muted-foreground tabular-nums">{reports.length}</span>}
        </button>
        <span className="truncate text-xs text-muted-foreground max-md:hidden">bài đã đăng / lên lịch: link, ảnh chứng minh, ghi chú</span>
        {root && !folded && (
          <ButtonGroup aria-label="Báo cáo của" className="ml-auto shrink-0">
            {(
              [
                ["room", "Phòng này"],
                ["project", "Cả dự án"],
              ] as const
            ).map(([s, label]) => (
              <Button key={s} type="button" size="sm" variant={cur === s ? "secondary" : "outline"} aria-pressed={cur === s} className={cn("h-7 text-xs", TOUCH)} onClick={() => setScope(s)}>
                {label}
              </Button>
            ))}
          </ButtonGroup>
        )}
      </div>
      {!folded && (
        <div id="room-report-list" className={cn("min-h-0 px-3 py-2 sm:px-4", split && "flex-1 overflow-y-auto")}>
          {list.error && !list.data ? (
            <ErrorNote what="báo cáo" error={list.error} onRetry={list.reload} />
          ) : !on || (list.data && reports.length === 0) ? (
            <p className="py-2 text-xs text-pretty text-muted-foreground">
              {cur === "project" ? "Dự án này chưa có báo cáo nào." : "Phòng này chưa báo cáo bài nào."} Đăng xong hay lên lịch xong một bài, phòng chạy{" "}
              <code className="font-mono text-[11px] text-foreground">/hq-artifact add &lt;ảnh chứng minh&gt; --link &lt;link Meta&gt; --note &lt;trạng thái, giờ lên, số liệu&gt; --session &lt;id phòng&gt;</code> và bài hiện ở đây.
            </p>
          ) : (
            <ol aria-label="Báo cáo, mới nhất trước" className="divide-y">
              {reports.map((r) => (
                <ReportRow key={r.key} r={r} now={now} token={token} posts={posts} onShow={setShown} />
              ))}
            </ol>
          )}
        </div>
      )}
      <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
    </section>
  );
}

function ReportRow({ r, now, token, posts, onShow }: { r: Report<ArtifactView>; now: number; token: string; posts: Map<number, ContentRow>; onShow: (s: Shown) => void }) {
  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-pretty">{r.title}</p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={new Date(r.at).toISOString()} title={new Date(r.at).toLocaleString("vi-VN")}>
              {agoVi(r.at, now)}
            </time>
          </p>
        </div>
        {r.link && (
          <Button asChild size="sm" variant="outline" className={cn("h-7 shrink-0 text-xs", TOUCH)}>
            <a href={r.link} target="_blank" rel="noopener noreferrer" title={r.link}>
              <ExternalLinkIcon aria-hidden />
              {openLabel(r.link)}
            </a>
          </Button>
        )}
      </div>
      {r.note && <p className="text-xs whitespace-pre-line text-pretty text-foreground/90">{r.note}</p>}
      {r.content.length > 0 && (
        <ul aria-label="Bài trong Nội dung" className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {r.content.map((id) => {
            const it = posts.get(id);
            return (
              <li key={id} className="flex min-w-0 items-center gap-1">
                <span className="text-muted-foreground tabular-nums">#{id}</span>
                {it ? (
                  <>
                    <span className="max-w-64 truncate" title={it.title}>
                      {it.title}
                    </span>
                    <span className={cn("inline-flex items-center gap-0.5", STATUS_TONE[it.status])}>
                      <StatusIcon status={it.status} />
                      {STATUS_LABEL[it.status]}
                    </span>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {r.proofs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {r.proofs.map((a) => (
            <UploadThumb key={a.id} token={token} file={{ id: a.id, name: a.title, url: artifactFileUrl(a.id) }} onOpen={onShow} className="aspect-[4/3] w-28 sm:w-32" />
          ))}
        </div>
      )}
      {r.files.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {r.files.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center gap-1.5">
              <FileIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate text-foreground">{baseName(a.path)}</span>
              <span className="shrink-0">{a.missing ? "file đã mất" : `${KIND_LABEL[a.kind]}, xem ở tab Kết quả`}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
