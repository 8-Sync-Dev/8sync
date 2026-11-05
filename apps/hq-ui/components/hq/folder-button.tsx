"use client";

import { FolderIcon, FolderOpenIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { baseName, dirOf } from "@/lib/artifacts";
import { isLocalHost } from "@/lib/hosts";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import type { Api } from "./use-hq";

const noSubscribe = () => () => {};

/** `rel` under `base` in `base`'s own slash style; `rel` as is when it is absolute or there is no base. */
export function joinPath(base: string | null, rel: string): string {
  if (!base || /^(?:[A-Za-z]:[\\/]|[\\/])/.test(rel)) return rel;
  const sep = base.includes("\\") ? "\\" : "/";
  const tail = rel.replace(/^\.[\\/]/, "").replace(/[\\/]/g, sep);
  return `${base.replace(/[\\/]+$/, "")}${sep}${tail}`;
}

/**
 * The folder icon: where a file lives. Opens a popover with its folder (monospace, copyable) and full
 * path; on this machine's side also "Mở thư mục", which asks HQ to show it in Explorer/Finder
 * (POST /api/reveal: an artifact by `id`, else the `path` relative to `base`). Through the `--public`
 * link only the path is offered: nothing opens on a desk nobody sits at. `label`: a chip with the file's
 * name beside the icon (the files a result names).
 */
export function FolderButton({ path, id, base = null, api, label = false, className }: { path: string; id?: string; base?: string | null; api: Api; label?: boolean; className?: string }) {
  const full = joinPath(base, path);
  const dir = dirOf(full);
  const local = useSyncExternalStore(noSubscribe, () => isLocalHost(window.location.host), () => false);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      await api("/api/reveal", { method: "POST", body: id ? { id } : { path, ...(base ? { base } : {}) } });
      toast.success("Đã mở thư mục trên máy");
    } catch (e) {
      toast.error(`Không mở được thư mục: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={label ? "xs" : "icon-sm"}
          aria-label={label ? `${baseName(full)}: xem thư mục` : `Thư mục của ${baseName(full)}`}
          title={full}
          className={cn("text-muted-foreground", label && "max-w-56 border font-mono font-normal", className)}
        >
          <FolderIcon />
          {label && <span className="truncate">{baseName(full)}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))] space-y-2.5 p-3 text-xs">
        <div className="space-y-1">
          <p className="font-medium text-foreground">Thư mục</p>
          <div className="flex items-start gap-1 rounded-md bg-muted px-2 py-1.5">
            <code className="min-w-0 flex-1 font-mono text-[11px] break-all select-all">{dir}</code>
            <CopyButton value={dir} label="Chép đường dẫn thư mục" className="-my-0.5 shrink-0" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">File</p>
          <div className="flex items-start gap-1 rounded-md bg-muted/60 px-2 py-1.5">
            <code className="min-w-0 flex-1 font-mono text-[11px] break-all text-muted-foreground select-all">{full}</code>
            <CopyButton value={full} label="Chép đường dẫn file" className="-my-0.5 shrink-0" />
          </div>
        </div>
        {local ? (
          <Button type="button" size="sm" variant="outline" className="w-full text-xs" onClick={open} disabled={busy}>
            <FolderOpenIcon /> Mở thư mục
          </Button>
        ) : (
          <p className="text-pretty text-muted-foreground">Đang xem qua link từ xa: chép đường dẫn để mở trên máy chủ.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
