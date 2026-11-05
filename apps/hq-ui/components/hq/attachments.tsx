"use client";

import { DownloadIcon, FileIcon, ImageOffIcon, PaperclipIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fileSize, mediaKind, mediaUrls, parseAttachments, splitUrls, uploadFileUrl, uploadMetaUrl, uploadRefs, type Attachment, type UploadMeta } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { useAuthedImage, useNearView } from "./use-poll";

/** An image to show: an upload by id, or any authed HQ file route (`url`: an artifact's file). */
export type Shown = { id: string; name: string; url?: string };

/** A 40 px icon link that saves a file; the hit area the chat's touch targets use. */
const DOWNLOAD =
  "inline-grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none";

/**
 * `{name, kind, size, url}` of one upload (app/api/uploads/[id]), fetched once `on`: `url` is signed,
 * so `<video src>` streams with Range and a download link works without the `x-hq-token` header.
 */
function useUploadMeta(token: string, id: string, on: boolean) {
  const [st, setSt] = useState<{ id: string; meta: UploadMeta | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!on) return;
    const ac = new AbortController();
    fetch(uploadMetaUrl(id), { headers: { "x-hq-token": token }, signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setSt({ id, meta: (await r.json()) as UploadMeta, failed: false });
      })
      .catch(() => {
        if (!ac.signal.aborted) setSt({ id, meta: null, failed: true });
      });
    return () => ac.abort();
  }, [token, id, on]);
  return st && st.id === id ? st : { meta: null, failed: false };
}

/**
 * One image attachment at full size: Esc or the × closes (Dialog), the arrow saves it. The image starts
 * fitted to the screen; a tap switches to its natural size inside a scroller, and `touch-action:
 * pinch-zoom` leaves the phone's own pinch alone.
 */
export function Lightbox({ token, shown, onClose }: { token: string; shown: Shown | null; onClose: () => void }) {
  const [full, setFull] = useState(false);
  const { src, failed } = useAuthedImage(token, shown ? (shown.url ?? uploadFileUrl(shown.id)) : null, !!shown);
  return (
    <Dialog
      open={!!shown}
      onOpenChange={(o) => {
        if (!o) {
          setFull(false);
          onClose();
        }
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="h-dvh w-screen max-w-none gap-0 rounded-none border-0 bg-black/95 p-0 text-white ring-0 sm:h-[94dvh] sm:w-[min(96vw,1400px)] sm:max-w-none sm:rounded-xl [&_[data-slot=dialog-close]]:size-10 [&_[data-slot=dialog-close]]:bg-black/40 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-black/60 [&_[data-slot=dialog-close]]:hover:text-white"
      >
        <DialogTitle className="absolute top-4 left-4 z-10 max-w-[calc(100%-8rem)] truncate text-xs font-medium text-white/85">{shown?.name}</DialogTitle>
        {src && shown && (
          // The bytes are already here (the object URL the image shows): saving needs no second request.
          <a
            href={src}
            download={shown.name}
            aria-label={`Tải ${shown.name}`}
            title="Tải về"
            className="absolute top-2 right-14 z-10 inline-grid size-10 place-items-center rounded-lg bg-black/40 text-white outline-none hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <DownloadIcon className="size-4" aria-hidden />
          </a>
        )}
        <div className={cn("size-full touch-pinch-zoom overflow-auto overscroll-contain", !full && "grid place-items-center p-3 sm:p-6")}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL from an authed fetch; next/image cannot load it.
            <img
              src={src}
              alt={shown?.name ?? ""}
              draggable={false}
              onClick={() => setFull((f) => !f)}
              className={cn(full ? "block max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")}
            />
          ) : (
            <p className="text-sm text-white/75">{failed ? "Không mở được ảnh (đã bị dọn hoặc dự án không còn trong HQ)." : "Đang tải…"}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A thumbnail of one upload, loaded when near the viewport; a button that opens the lightbox. */
export function UploadThumb({ token, file, onOpen, className, children }: { token: string; file: Shown; onOpen: (s: Shown) => void; className?: string; children?: ReactNode }) {
  const [ref, near] = useNearView<HTMLDivElement>();
  const { src, failed } = useAuthedImage(token, file.url ?? uploadFileUrl(file.id), near);
  return (
    <div ref={ref} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onClick={() => onOpen(file)}
        title={file.name}
        aria-label={`Xem ảnh ${file.name}`}
        className="block size-full overflow-hidden rounded-lg border bg-muted outline-none transition-[box-shadow,opacity] duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- object URL from an authed fetch.
          <img src={src} alt={file.name} className="size-full object-cover" draggable={false} />
        ) : (
          <span className="grid size-full place-items-center text-muted-foreground">{failed ? <ImageOffIcon className="size-5" aria-hidden /> : <PaperclipIcon className="size-4 animate-pulse motion-reduce:animate-none" aria-hidden />}</span>
        )}
      </button>
      {children}
    </div>
  );
}

/** A video or audio upload, playable in place: the signed URL streams with Range, so seeking never pulls the whole file. */
function UploadPlayer({ token, file }: { token: string; file: Attachment }) {
  const [ref, near] = useNearView<HTMLDivElement>();
  const { meta, failed } = useUploadMeta(token, file.id, near);
  const video = mediaKind(file.name) === "video";
  return (
    <div ref={ref} className="w-full max-w-md min-w-0">
      {meta ? (
        video ? (
          <video controls preload="metadata" playsInline src={meta.url} aria-label={file.name} className="aspect-video w-full rounded-lg border bg-black" />
        ) : (
          <audio controls preload="metadata" src={meta.url} aria-label={file.name} className="w-full" />
        )
      ) : (
        <div className={cn("grid place-items-center rounded-lg border bg-muted text-xs text-muted-foreground", video ? "aspect-video" : "h-12")}>
          {failed ? "Không mở được file (đã bị dọn hoặc dự án không còn trong HQ)." : "Đang tải…"}
        </div>
      )}
      <FileRow file={file} meta={meta} />
    </div>
  );
}

/** Name, size once known, and a download button: a file the chat cannot show, or the caption under a player. */
function FileRow({ file, meta, chip }: { file: Attachment; meta: UploadMeta | null; chip?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", chip ? "max-w-sm rounded-lg border bg-card py-1 pr-1 pl-3" : "mt-1")}>
      {chip && <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 flex-1 text-xs leading-snug">
        <span className="block truncate font-medium" title={file.name}>
          {file.name}
        </span>
        {meta && <span className="block text-muted-foreground tabular">{fileSize(meta.size)}</span>}
      </span>
      {meta ? (
        <a href={`${meta.url}&dl=1`} download={file.name} aria-label={`Tải ${file.name}`} title="Tải về" className={DOWNLOAD}>
          <DownloadIcon className="size-4" aria-hidden />
        </a>
      ) : (
        <span className={cn(DOWNLOAD, "pointer-events-none opacity-40")} aria-hidden>
          <DownloadIcon className="size-4" />
        </span>
      )}
    </div>
  );
}

function FileChip({ token, file }: { token: string; file: Attachment }) {
  const [ref, near] = useNearView<HTMLDivElement>();
  const { meta } = useUploadMeta(token, file.id, near);
  return (
    <div ref={ref} className="min-w-0">
      <FileRow file={file} meta={meta} chip />
    </div>
  );
}

/** Uploads as the chat shows them: images as thumbnails (a tap opens the lightbox), video/audio as players, anything else as a file chip. */
function Uploads({ token, files }: { token: string; files: Attachment[] }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const images = files.filter((f) => mediaKind(f.name) === "image");
  const players = files.filter((f) => mediaKind(f.name) === "video" || mediaKind(f.name) === "audio");
  const others = files.filter((f) => mediaKind(f.name) === "file");
  return (
    <>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Ảnh đính kèm">
          {images.map((f) => (
            <UploadThumb key={f.id} token={token} file={f} onOpen={setShown} className="size-24 sm:size-40" />
          ))}
        </div>
      )}
      {players.map((f) => (
        <UploadPlayer key={f.id} token={token} file={f} />
      ))}
      {others.length > 0 && (
        <div className="flex flex-col gap-1.5" aria-label="File đính kèm">
          {others.map((f) => (
            <FileChip key={f.id} token={token} file={f} />
          ))}
        </div>
      )}
      <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

/** Plain text with its http(s) URLs as links that open in a new tab. */
export function Linkified({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitUrls(text).map((p, i) =>
        p.url ? (
          <a key={i} href={p.text} target="_blank" rel="noopener noreferrer" className="wrap-anywhere text-primary underline underline-offset-2 hover:no-underline">
            {p.text}
          </a>
        ) : (
          p.text
        ),
      )}
    </span>
  );
}

/**
 * Inline previews of the image/video URLs a message names. Client-side only: the owner's browser loads
 * the URL itself with no referrer (`no-referrer` here and on every HQ page). HQ never fetches a URL from
 * a message on the server (no OG / link-preview card): that would let any text in a room make HQ request
 * any address on the owner's network (SSRF).
 */
export function UrlPreviews({ text }: { text: string | null | undefined }) {
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const urls = mediaUrls(text).filter((u) => !broken.has(u.url));
  if (urls.length === 0) return null;
  const drop = (url: string) => setBroken((b) => new Set(b).add(url));
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Xem trước link">
      {urls.map((u) =>
        u.kind === "image" ? (
          <a key={u.url} href={u.url} target="_blank" rel="noopener noreferrer" title={u.url} className="block overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            {/* eslint-disable-next-line @next/next/no-img-element -- a third-party URL shown as-is; next/image would proxy it through HQ. */}
            <img src={u.url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => drop(u.url)} className="max-h-60 max-w-full object-contain sm:max-w-sm" />
          </a>
        ) : (
          <video key={u.url} controls preload="metadata" playsInline src={u.url} onError={() => drop(u.url)} className="aspect-video w-full max-w-md rounded-lg border bg-black" />
        ),
      )}
    </div>
  );
}

/**
 * A chat message's text with its attachments: images as thumbnails, video/audio as players, other files
 * as chips with a download button. The paths stay under a fold, since the room reads the path. Text
 * without attachments renders as before, its URLs as links.
 */
export function MessageText({ text, token, className }: { text: string | null | undefined; token: string; className?: string }) {
  const { body, files } = parseAttachments(text);
  return (
    <>
      {body && <Linkified text={body} className={className} />}
      <UrlPreviews text={body} />
      {files.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5">
          <Uploads token={token} files={files} />
          <AttachmentPaths files={files} />
        </div>
      )}
    </>
  );
}

/** What a room's reply links to: uploads it names by path, and image/video URLs (the markdown already makes them links). */
export function ReplyMedia({ text, token }: { text: string | null | undefined; token: string }) {
  const files = uploadRefs(text);
  return (
    <>
      {files.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          <Uploads token={token} files={files} />
        </div>
      )}
      <UrlPreviews text={text} />
    </>
  );
}

/** The path lines the room needs, folded: the chips above already name each file. */
function AttachmentPaths({ files }: { files: Attachment[] }) {
  return (
    <details className="group/paths text-[11px] leading-snug text-muted-foreground">
      <summary className="inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-md outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-10">
        <PaperclipIcon className="size-3 shrink-0" aria-hidden />
        Đường dẫn cho phòng ({files.length})
      </summary>
      <ul className="space-y-0.5 pt-0.5" aria-label="Đường dẫn file đính kèm">
        {files.map((f) => (
          <li key={f.id} className="min-w-0 font-mono break-all">
            {f.path}
          </li>
        ))}
      </ul>
    </details>
  );
}
