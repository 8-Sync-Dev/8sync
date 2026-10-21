"use client";

import { ImageOffIcon, PaperclipIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { isImageName, parseAttachments, uploadFileUrl, type Attachment } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { useAuthedImage, useNearView } from "./use-poll";

export type Shown = { id: string; name: string };

/**
 * One image attachment at full size: Esc or the × closes (Dialog). The image starts fitted to the
 * screen; a tap switches to its natural size inside a scroller, and `touch-action: pinch-zoom` leaves
 * the phone's own pinch alone.
 */
export function Lightbox({ token, shown, onClose }: { token: string; shown: Shown | null; onClose: () => void }) {
  const [full, setFull] = useState(false);
  const { src, failed } = useAuthedImage(token, shown ? uploadFileUrl(shown.id) : null, !!shown);
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
        className="h-dvh w-screen max-w-none gap-0 rounded-none border-0 bg-black/95 p-0 text-white ring-0 sm:h-[94dvh] sm:w-[min(96vw,1400px)] sm:max-w-none sm:rounded-xl [&_[data-slot=dialog-close]]:bg-black/40 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-black/60 [&_[data-slot=dialog-close]]:hover:text-white"
      >
        <DialogTitle className="absolute top-3 left-4 z-10 max-w-[calc(100%-5rem)] truncate text-xs font-medium text-white/80">{shown?.name}</DialogTitle>
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
            <p className="text-sm text-white/70">{failed ? "Không mở được ảnh (đã bị dọn hoặc dự án không còn trong HQ)." : "Đang tải…"}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A thumbnail of one upload, loaded when near the viewport; a button that opens the lightbox. */
export function UploadThumb({ token, file, onOpen, className, children }: { token: string; file: Shown; onOpen: (s: Shown) => void; className?: string; children?: ReactNode }) {
  const [ref, near] = useNearView<HTMLDivElement>();
  const { src, failed } = useAuthedImage(token, uploadFileUrl(file.id), near);
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

/**
 * A chat message's text with its attachments: image uploads as thumbnails (a tap opens the
 * lightbox), every path kept small under them, since the room reads the path. Text without
 * attachments renders as before.
 */
export function MessageText({ text, token, className }: { text: string | null | undefined; token: string; className?: string }) {
  const { body, files } = parseAttachments(text);
  const [shown, setShown] = useState<Shown | null>(null);
  if (files.length === 0) return <span className={className}>{text}</span>;
  const images = files.filter((f) => isImageName(f.name));
  return (
    <>
      {body && <span className={className}>{body}</span>}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Ảnh đính kèm">
          {images.map((f) => (
            <UploadThumb key={f.id} token={token} file={f} onOpen={setShown} className="size-24 sm:size-40" />
          ))}
        </div>
      )}
      <AttachmentPaths files={files} />
      <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

/** The path lines the room needs, visually secondary. */
function AttachmentPaths({ files }: { files: Attachment[] }) {
  return (
    <ul className="space-y-0.5 text-[11px] leading-snug text-muted-foreground" aria-label="File đính kèm">
      {files.map((f) => (
        <li key={f.id} className="flex min-w-0 items-start gap-1">
          <PaperclipIcon className="mt-[2px] size-3 shrink-0" aria-hidden />
          <span className="min-w-0 break-all">{f.path}</span>
        </li>
      ))}
    </ul>
  );
}
