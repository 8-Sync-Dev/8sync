"use client";

// "Báo cáo" of a room (owner 2026-11-05: "report đăng có link lên meta, ảnh chứng minh, notes"): what
// the room reported with `hq.mjs artifact add --session <room>`, one row per post (files with the same
// --link fold together), with the open button, proof thumbnails, note and the Nội dung posts it is
// about. A small button in the message box's row opens it as a wide dialog (owner 2026-11-06: the
// message box keeps its own full-width space under the room; Báo cáo is a compact button beside it,
// not a pane that squeezes the room).
import { ChevronRightIcon, ExternalLinkIcon, EyeIcon, FileIcon, MegaphoneIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
const LIST_MAX = 100;

type Scope = "room" | "project";

/**
 * The "Báo cáo" button (with the count) and its wide dialog: the room's reports, newest first; "Cả dự
 * án" switches to every report about the room's project. The list is polled while the button shows, so
 * the count stays current.
 */
export function RoomReport({ room, token, onOpenPost, onOpenFile }: { room: Room; token: string; onOpenPost: (id: number, day: string | null) => void; onOpenFile: (id: string) => void }) {
  const api = useMemo(() => makeApi(token), [token]);
  const root = room.project?.root ?? null;
  const [scope, setScope] = useState<Scope>("room");
  const [open, setOpen] = useState(false);
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
  const wantPosts = open && reports.some((r) => r.content.length > 0);
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
  const listOf = () =>
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
            onShow={setShown}
            onOpenPost={(id, day) => {
              setOpen(false);
              onOpenPost(id, day);
            }}
            onOpenFile={(id) => {
              setOpen(false);
              onOpenFile(id);
            }}
          />
        ))}
      </ol>
    );

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            id="room-report-button"
            className={cn("h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground", TOUCH)}
            title="Báo cáo: bài đã đăng / lên lịch, link, ảnh chứng minh, ghi chú"
            aria-label={reports.length > 0 ? `Báo cáo, ${reports.length} bài` : "Báo cáo"}
          >
            <MegaphoneIcon aria-hidden className="size-3.5" />
            <span className="max-sm:sr-only">Báo cáo</span>
            {reports.length > 0 && <span className="tabular-nums">{reports.length}</span>}
          </Button>
        </DialogTrigger>
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
            <div className="mx-auto w-full max-w-5xl">{listOf()}</div>
          </div>
        </DialogContent>
      </Dialog>
      <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

function ReportRow({
  r,
  now,
  token,
  api,
  posts,
  onShow,
  onOpenPost,
  onOpenFile,
}: {
  r: Report<ArtifactView>;
  now: number;
  token: string;
  api: Api;
  posts: Map<number, ContentRow>;
  onShow: (s: Shown) => void;
  onOpenPost: (id: number, day: string | null) => void;
  onOpenFile: (id: string) => void;
}) {
  return (
    <li className="space-y-1.5 py-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-pretty">{r.title}</p>
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
        <div className="flex flex-wrap gap-3">
          {r.proofs.map((a) => (
            <UploadThumb key={a.id} token={token} file={{ id: a.id, name: a.title, url: artifactFileUrl(a.id) }} onOpen={onShow} className="aspect-[4/3] w-48 sm:w-64" />
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
