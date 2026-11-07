"use client";

// One attachment behaviour for every HQ composer that sends upload ids with its message (owner
// 2026-11-04: the room chat had no image button while Gửi cho phòng and Không gian did). Pick, paste
// or drop files → POST /api/uploads → the ids go out with the message (POST /api/messages `files`).
import { Loader2Icon, PaperclipIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FILE_MAX_MB, FILES_MAX, fileError, toBase64 } from "@/lib/attach";
import { isImageName } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { Lightbox, OrderBadge, UploadThumb, type Shown } from "./attachments";

export type Upload = { id: string; name: string; size: number };
type Api = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
/** One attachment in the order the owner pasted or picked it; `up` is null while it uploads. */
type Slot = { key: number; name: string; up: Upload | null };

/**
 * Files keep the order the owner added them (owner 2026-11-05: "paste đúng thứ tự media"): each file
 * takes its place when pasted or picked, and its upload fills that place whenever it finishes, so a
 * small second paste that uploads first never jumps ahead of a big first one. The room gets them in
 * that order, numbered like the thumbnails.
 */
export function useAttach(api: Api, slots: number = FILES_MAX) {
  const [list, setList] = useState<Slot[]>([]);
  // Places taken, pending uploads included: synced from the list after each render and bumped right
  // away by `attach`, so two quick pastes before the next render both see the other's files.
  const taken = useRef(0);
  useEffect(() => {
    taken.current = list.length;
  }, [list]);
  const next = useRef(0);

  async function attach(picked: File[]) {
    const ok = picked.filter((f) => {
      const why = fileError(f);
      if (why) toast.error(why);
      return !why;
    });
    const free = Math.max(0, slots - taken.current);
    if (ok.length > free) toast.warning(`Tối đa ${slots} file mỗi lần gửi`);
    const mine = ok.slice(0, free).map((f) => ({ f, key: next.current++ }));
    if (mine.length === 0) return;
    taken.current += mine.length;
    setList((xs) => [...xs, ...mine.map(({ f, key }) => ({ key, name: f.name || "anh-dan.png", up: null }))]);
    await Promise.all(
      mine.map(async ({ f, key }) => {
        try {
          const up = await api<Upload>("/api/uploads", { method: "POST", body: { name: f.name || "anh-dan.png", data: await toBase64(f) } });
          setList((xs) => xs.map((x) => (x.key === key ? { ...x, up } : x)));
        } catch (e) {
          toast.error(`${f.name}: ${(e as Error).message}`);
          drop(key);
        }
      }),
    );
  }

  const drop = (key: number) => setList((xs) => xs.filter((x) => x.key !== key));

  /** A pasted image becomes an attachment; pasted text stays text. */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length === 0) return;
    e.preventDefault();
    void attach(pasted);
  }

  const uploading = list.filter((x) => !x.up).length;
  return {
    /** Uploaded files, in the order they were added. */
    files: list.flatMap((x) => (x.up ? [x.up] : [])),
    /** Every place, pending ones included: what the list shows. */
    list,
    uploading,
    full: list.length >= slots,
    slots,
    attach,
    onPaste,
    remove: drop,
    clear: () => setList([]),
  };
}

export type Attach = ReturnType<typeof useAttach>;

/** The added files above or below the box, numbered in the order the room gets them: image thumbnails (open in a lightbox), other files as chips. */
export function AttachList({ a, token, className }: { a: Attach; token: string; className?: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  if (a.list.length === 0) return null;
  return (
    <>
      <ol className={cn("flex flex-wrap items-center gap-2 px-2 pt-1 pb-2", className)} aria-label="File đính kèm, theo thứ tự phòng nhận">
        {a.list.map((s, i) => {
          const n = i + 1;
          const x = (
            <button
              type="button"
              className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-7"
              aria-label={`Bỏ file ${n}: ${s.name}`}
              onClick={() => a.remove(s.key)}
            >
              <XIcon className="size-3" aria-hidden />
            </button>
          );
          if (!s.up)
            return (
              <li key={s.key} className="relative grid size-16 place-items-center rounded-lg border border-dashed bg-muted text-muted-foreground" role="status" title={s.name}>
                <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden />
                <span className="sr-only">Đang tải file {n}: {s.name}</span>
                {a.list.length > 1 && <OrderBadge n={n} />}
              </li>
            );
          return isImageName(s.up.name) ? (
            <li key={s.key}>
              <UploadThumb token={token} file={s.up} onOpen={setShown} className="size-16">
                {a.list.length > 1 && <OrderBadge n={n} />}
                {x}
              </UploadThumb>
            </li>
          ) : (
            <li key={s.key} className="inline-flex max-w-56 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
              {a.list.length > 1 && <span className="shrink-0 font-medium tabular-nums text-muted-foreground">{n}.</span>}
              <PaperclipIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate" title={s.up.name}>
                {s.up.name}
              </span>
              <button
                type="button"
                className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-8"
                aria-label={`Bỏ file ${n}: ${s.up.name}`}
                onClick={() => a.remove(s.key)}
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
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
        // ≥44 px to tap at ≤768 px (owner UAT 2026-11-08: it was 36×28); the desktop size stays.
        className={cn("h-7 text-xs max-md:h-11 max-md:min-w-11", className)}
        disabled={disabled || a.full}
        title={`Ảnh, PDF hay file bất kỳ, tối đa ${a.slots} file, ${FILE_MAX_MB} MB mỗi file; dán ảnh thẳng vào ô cũng được. Phòng mở bằng Read.`}
        onClick={() => picker.current?.click()}
      >
        <PaperclipIcon /> <span className="max-sm:sr-only">{label}</span>
      </Button>
    </>
  );
}
