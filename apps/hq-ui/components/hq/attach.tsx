"use client";

// One attachment behaviour for every HQ composer that sends upload ids with its message (owner
// 2026-11-04: the room chat had no image button while Gửi cho phòng and Không gian did). Pick, paste
// or drop files → POST /api/uploads → the ids go out with the message (POST /api/messages `files`).
import { Loader2Icon, PaperclipIcon, XIcon } from "lucide-react";
import { useRef, useState, type ClipboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FILE_MAX_MB, FILES_MAX, fileError, toBase64 } from "@/lib/attach";
import { isImageName } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { Lightbox, UploadThumb, type Shown } from "./attachments";

export type Upload = { id: string; name: string; size: number };
type Api = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

export function useAttach(api: Api, slots: number = FILES_MAX) {
  const [files, setFiles] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(0);

  async function attach(list: File[]) {
    const free = slots - files.length - uploading;
    if (list.length > free) toast.warning(`Tối đa ${slots} file mỗi lần gửi`);
    for (const f of list.slice(0, Math.max(0, free))) {
      const why = fileError(f);
      if (why) {
        toast.error(why);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const up = await api<Upload>("/api/uploads", { method: "POST", body: { name: f.name || "anh-dan.png", data: await toBase64(f) } });
        setFiles((xs) => [...xs, up]);
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  /** A pasted image becomes an attachment; pasted text stays text. */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length === 0) return;
    e.preventDefault();
    void attach(pasted);
  }

  return {
    files,
    uploading,
    full: files.length + uploading >= slots,
    slots,
    attach,
    onPaste,
    remove: (id: string) => setFiles((xs) => xs.filter((x) => x.id !== id)),
    clear: () => setFiles([]),
  };
}

export type Attach = ReturnType<typeof useAttach>;

/** The picked files above or below the box: image thumbnails (open in a lightbox), other files as chips. */
export function AttachList({ a, token, className }: { a: Attach; token: string; className?: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  if (a.files.length === 0 && a.uploading === 0) return null;
  return (
    <>
      <ul className={cn("flex flex-wrap items-center gap-2 px-2 pt-1 pb-2", className)} aria-label="File đính kèm">
        {a.files.map((f) =>
          isImageName(f.name) ? (
            <li key={f.id}>
              <UploadThumb token={token} file={f} onOpen={setShown} className="size-16">
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-7"
                  aria-label={`Bỏ ${f.name}`}
                  onClick={() => a.remove(f.id)}
                >
                  <XIcon className="size-3" aria-hidden />
                </button>
              </UploadThumb>
            </li>
          ) : (
            <li key={f.id} className="inline-flex max-w-56 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
              <PaperclipIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate" title={f.name}>
                {f.name}
              </span>
              <button
                type="button"
                className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-8"
                aria-label={`Bỏ ${f.name}`}
                onClick={() => a.remove(f.id)}
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            </li>
          ),
        )}
        {a.uploading > 0 && (
          <li className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted-foreground" role="status">
            <Loader2Icon className="size-3.5 motion-safe:animate-spin" aria-hidden /> Đang tải {a.uploading} file…
          </li>
        )}
      </ul>
      <Lightbox token={token} shown={shown} onClose={() => setShown(null)} />
    </>
  );
}

/** "Đính kèm": opens the file picker; images can also be pasted into the box. */
export function AttachButton({ a, disabled, className, label = "Đính kèm" }: { a: Attach; disabled?: boolean; className?: string; label?: string }) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = "";
          void a.attach(picked);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-7 text-xs", className)}
        disabled={disabled || a.full}
        title={`Ảnh, PDF hay file bất kỳ, tối đa ${a.slots} file, ${FILE_MAX_MB} MB mỗi file; dán ảnh thẳng vào ô cũng được. Phòng mở bằng Read.`}
        onClick={() => picker.current?.click()}
      >
        <PaperclipIcon /> <span className="max-sm:sr-only">{label}</span>
      </Button>
    </>
  );
}
