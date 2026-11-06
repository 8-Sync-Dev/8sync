"use client";

// "Báo cáo" under a room (owner 2026-11-05: "split ngang dưới là report đăng có link lên meta, ảnh chứng
// minh, notes"): what the room reported with `hq.mjs artifact add --session <room>`, one row per post
// (files with the same --link fold together), with the open button, proof thumbnails, note and the
// Nội dung posts it is about. Wide screen: a bottom split, dragged taller or folded to its title row
// (the size, folded or not, kept per browser). Phone: a section in the room's scroll.
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, EyeIcon, FileIcon, Maximize2Icon, MegaphoneIcon } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePanelRef, useDefaultLayout } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { artifactFileUrl, baseName, KIND_LABEL, openLabel, reportsOf, roomRefs, type ArtifactView, type Report } from "@/lib/artifacts";
import { dayKey, STATUS_LABEL, whenOf, type ContentRow } from "@/lib/content";
import { agoVi } from "@/lib/now";
import { cn } from "@/lib/utils";
import { Lightbox, UploadThumb, type Shown } from "./attachments";
import { ErrorNote } from "./bits";
import { StatusIcon, STATUS_TONE } from "./content-bits";
import { FolderButton } from "./folder-button";
import { TOUCH } from "./room-send";
import type { Room } from "./use-office";
import { makeApi, type Api } from "./use-hq";
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

/**
 * The room's reports, newest first; "Cả dự án" switches to every report about the room's project.
 * "Mở lớn" shows the same list in a wide dialog (bigger proofs), the pane staying as it was.
 */
export function RoomReport({ room, token, onOpenPost, onOpenFile }: { room: Room; token: string; onOpenPost: (id: number, day: string | null) => void; onOpenFile: (id: string) => void }) {
  const api = useMemo(() => makeApi(token), [token]);
  const split = useContext(PaneCtx);
  const phone = useFold();
  const { folded, toggle } = split ?? phone;
  const root = room.project?.root ?? null;
  const [scope, setScope] = useState<Scope>("room");
  const [big, setBig] = useState(false);
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

  const scopes = root && (
    <ButtonGroup aria-label="Báo cáo của" className="shrink-0">
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
  );
  // Opening a post or a file leaves the room view: the dialog closes first.
  const listOf = (large: boolean) =>
    list.error && !list.data ? (
      <ErrorNote what="báo cáo" error={list.error} onRetry={list.reload} />
    ) : !on || (list.data && reports.length === 0) ? (
      <p className="py-2 text-xs text-pretty text-muted-foreground">
        {cur === "project" ? "Dự án này chưa có báo cáo nào." : "Phòng này chưa báo cáo bài nào."} Đăng xong hay lên lịch xong một bài, phòng chạy{" "}
        <code className="font-mono text-[11px] text-foreground">/hq-artifact add &lt;ảnh chứng minh&gt; --link &lt;link Meta&gt; --note &lt;trạng thái, giờ lên, số liệu&gt; --session &lt;id phòng&gt;</code> và bài hiện ở đây.
      </p>
    ) : (
      <ol aria-label="Báo cáo, mới nhất trước" className="divide-y">
        {reports.map((r) => (
          <ReportRow
            key={r.key}
            r={r}
            now={now}
            token={token}
            api={api}
            posts={posts}
            large={large}
            onShow={setShown}
            onOpenPost={(id, day) => {
              setBig(false);
              onOpenPost(id, day);
            }}
            onOpenFile={(id) => {
              setBig(false);
              onOpenFile(id);
            }}
          />
        ))}
      </ol>
    );

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
        <span className="min-w-0 truncate text-xs text-muted-foreground max-md:hidden">bài đã đăng / lên lịch: link, ảnh chứng minh, ghi chú</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {!folded && scopes}
          <Button type="button" size="sm" variant="ghost" className={cn("h-7 gap-1 px-2 text-xs", TOUCH)} onClick={() => setBig(true)} aria-haspopup="dialog" title="Mở Báo cáo cỡ lớn">
            <Maximize2Icon aria-hidden className="size-3.5" />
            <span className="max-sm:sr-only">Mở lớn</span>
          </Button>
        </div>
      </div>
      {!folded && (
        <div id="room-report-list" className={cn("min-h-0 px-3 py-2 sm:px-4", split && "flex-1 overflow-y-auto")}>
          {listOf(false)}
        </div>
      )}
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="flex h-[min(88dvh,60rem)] w-full flex-col gap-0 p-0 sm:max-w-[min(72rem,calc(100%-4rem))]">
          <DialogHeader className="shrink-0 flex-row items-center gap-3 border-b px-5 py-3 pr-14 text-left">
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex items-center gap-2 text-base">
                <MegaphoneIcon aria-hidden className="size-4 text-muted-foreground" />
                Báo cáo
                {reports.length > 0 && <span className="text-sm font-normal text-muted-foreground tabular-nums">{reports.length}</span>}
              </DialogTitle>
              <DialogDescription className="truncate text-xs">
                {cur === "project" ? `Cả dự án ${room.project?.name ?? ""}`.trim() : `Phòng ${room.label || room.name}`}: bài đã đăng / lên lịch, link, ảnh chứng minh, ghi chú
              </DialogDescription>
            </div>
            {scopes}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
            <div className="mx-auto w-full max-w-5xl">{listOf(true)}</div>
          </div>
        </DialogContent>
      </Dialog>
      <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
    </section>
  );
}

function ReportRow({
  r,
  now,
  token,
  api,
  posts,
  large = false,
  onShow,
  onOpenPost,
  onOpenFile,
}: {
  r: Report<ArtifactView>;
  now: number;
  token: string;
  api: Api;
  posts: Map<number, ContentRow>;
  /** In the "Mở lớn" dialog: roomier rows and proofs big enough to read. */
  large?: boolean;
  onShow: (s: Shown) => void;
  onOpenPost: (id: number, day: string | null) => void;
  onOpenFile: (id: string) => void;
}) {
  return (
    <li className={cn("space-y-1.5", large ? "py-4" : "py-2.5")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium text-pretty", large ? "text-base" : "text-sm")}>{r.title}</p>
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
        // Each post opens its sheet in Nội dung (owner 2026-11-05: "nút bấm sheet tự chạy vô").
        <ul aria-label="Bài trong Nội dung" className="flex flex-wrap gap-x-1 gap-y-0.5 text-xs">
          {r.content.map((id) => {
            const it = posts.get(id);
            if (!it)
              // Not in the content book HQ reads (no DB, or the post left it): nothing to open.
              return (
                <li key={id} className="px-1 py-0.5 text-muted-foreground tabular-nums">
                  #{id}
                </li>
              );
            const at = whenOf(it);
            return (
              <li key={id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenPost(id, at != null ? dayKey(at) : null)}
                  title={`Mở #${id} «${it.title}» trong Nội dung`}
                  className={cn("flex max-w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60", TOUCH)}
                >
                  <span className="text-muted-foreground tabular-nums">#{id}</span>
                  <span className="max-w-64 truncate underline decoration-border underline-offset-2">{it.title}</span>
                  <span className={cn("inline-flex shrink-0 items-center gap-0.5", STATUS_TONE[it.status])}>
                    <StatusIcon status={it.status} />
                    {STATUS_LABEL[it.status]}
                  </span>
                  <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {r.proofs.length > 0 && (
        <div className={cn("flex flex-wrap", large ? "gap-3" : "gap-2")}>
          {r.proofs.map((a) => (
            <UploadThumb key={a.id} token={token} file={{ id: a.id, name: a.title, url: artifactFileUrl(a.id) }} onOpen={onShow} className={large ? "aspect-[4/3] w-48 sm:w-64" : "aspect-[4/3] w-28 sm:w-32"} />
          ))}
        </div>
      )}
      {r.files.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {r.files.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center gap-1.5">
              <FileIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate text-foreground" title={a.path}>
                {baseName(a.path)}
              </span>
              {a.missing ? (
                <span className="shrink-0">file đã mất</span>
              ) : (
                <>
                  <span className="shrink-0">{KIND_LABEL[a.kind]}</span>
                  <Button type="button" size="xs" variant="outline" className={cn("shrink-0", TOUCH)} onClick={() => onOpenFile(a.id)} title="Mở file ở tab Kết quả">
                    <EyeIcon aria-hidden /> Xem
                  </Button>
                </>
              )}
              <FolderButton path={a.path} id={a.missing ? undefined : a.id} api={api} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
