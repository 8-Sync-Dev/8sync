"use client";

// Không gian's start screen, as in Claude Code Desktop (owner 2026-11-02, screenshot): an almost empty
// page with one composer pinned at the bottom: "+" (attach), the task, send; under it where the
// session runs (Máy này), the folder, Worktree and the model. Sending starts a new omp session in that
// folder, named from the task, with the task as its first message (POST /api/omp/sessions).
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, CpuIcon, FileIcon, FolderIcon, FolderSearchIcon, Loader2Icon, MonitorIcon, PlusIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FILE_MAX_MB, FILES_MAX, fileError, toBase64 } from "@/lib/attach";
import { folderName, isOmpModel, pathKey, shortPath, type Pane, type WsProject } from "@/lib/omp-workspace";
import { sessionNameFrom } from "@/lib/session-tree";
import { cn } from "@/lib/utils";
import { COMPOSER_ID } from "./workspace-store";
import { ProjectPicker, type Api } from "./workspace-launcher";

type Upload = { id: string; name: string; size: number };

const CHIP =
  "inline-flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-accent data-[state=open]:text-foreground motion-reduce:transition-none max-md:h-10";

export function WorkspaceComposer({
  api,
  folder,
  list,
  home,
  browseFrom,
  taken,
  onFolder,
  onCreated,
}: {
  api: Api;
  /** The folder the next session starts in (null: none picked yet). */
  folder: string | null;
  /** Recent folders first, then every project HQ knows. */
  list: WsProject[];
  home: string | null;
  browseFrom: string | null;
  /** Session names already used in `folder`: the new name never repeats one (that would reopen it). */
  taken: string[];
  onFolder: (p: string) => void;
  onCreated: (p: Pane) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(0);
  const [worktree, setWorktree] = useState(false);
  const [model, setModel] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const modelOk = model.trim() === "" || isOmpModel(model.trim());
  const label = folder ? (list.find((p) => pathKey(p.path) === pathKey(folder))?.name ?? folderName(folder)) : null;
  const recent = useMemo(() => list.filter((p) => p.recent).slice(0, 6), [list]);
  const canSend = !!folder && text.trim() !== "" && modelOk && !busy && uploading === 0;

  async function attach(picked: File[]) {
    const free = FILES_MAX - files.length - uploading;
    if (picked.length > free) toast.warning(`Tối đa ${FILES_MAX} file mỗi lần gửi`);
    for (const f of picked.slice(0, Math.max(0, free))) {
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

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length === 0) return;
    e.preventDefault();
    void attach(pasted);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!folder) {
      setPicking(true);
      return;
    }
    if (!canSend) return;
    const prompt = text.trim();
    const name = sessionNameFrom(prompt, taken);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; name: string; cwd: string }>("/api/omp/sessions", {
        method: "POST",
        body: { cwd: folder, name, prompt, ...(files.length ? { files: files.map((f) => f.id) } : {}), ...(model.trim() ? { model: model.trim() } : {}), ...(worktree ? { worktree: true } : {}) },
      });
      setText("");
      setFiles([]);
      onCreated({ id: r.id, name: r.name, cwd: r.cwd });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6">
        <div className="flex max-w-md flex-col items-center gap-1.5 text-center">
          <p className="text-xl font-semibold tracking-tight text-balance md:text-2xl">{label ? `Việc gì trong ${label}?` : "Bắt đầu một phiên mới"}</p>
          <p className="text-sm text-pretty text-muted-foreground">
            {label ? "Gõ việc cần làm bên dưới: HQ mở một phiên omp mới trong thư mục này và gửi việc vào đó." : "Chọn thư mục ở dưới khung soạn, rồi mô tả việc cần làm."}
          </p>
        </div>
      </div>

      <form onSubmit={(e) => void send(e)} className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-4 md:px-6 md:pb-6">
        <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:border-ring/60 focus-within:shadow-md motion-reduce:transition-none">
          {(files.length > 0 || uploading > 0) && (
            <ul className="flex flex-wrap gap-1.5 px-3 pt-3" aria-label="File đính kèm">
              {files.map((f) => (
                <li key={f.id} className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border bg-muted/60 pr-1 pl-2 text-xs">
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{f.name}</span>
                  <button type="button" className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Bỏ ${f.name}`} onClick={() => setFiles((xs) => xs.filter((x) => x.id !== f.id))}>
                    <XIcon className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
              {uploading > 0 && (
                <li className="inline-flex h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground" role="status">
                  <Loader2Icon className="size-3.5 motion-safe:animate-spin" aria-hidden /> Đang tải {uploading} file…
                </li>
              )}
            </ul>
          )}
          <label htmlFor={COMPOSER_ID} className="sr-only">
            Việc cần làm cho phiên mới
          </label>
          <textarea
            id={COMPOSER_ID}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder="Mô tả việc cần làm hoặc đặt câu hỏi"
            className="block max-h-[40vh] min-h-20 w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
            aria-describedby="ws-composer-hint"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                void attach(picked);
              }}
            />
            <button
              type="button"
              className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 motion-reduce:transition-none max-md:size-10"
              aria-label={`Đính kèm file (tối đa ${FILES_MAX}, ${FILE_MAX_MB} MB mỗi file)`}
              title={`Đính kèm file (tối đa ${FILES_MAX}, ${FILE_MAX_MB} MB mỗi file; dán ảnh cũng được)`}
              disabled={files.length + uploading >= FILES_MAX}
              onClick={() => fileRef.current?.click()}
            >
              <PlusIcon className="size-4" aria-hidden />
            </button>
            <span id="ws-composer-hint" className="ml-1 hidden text-[11px] text-muted-foreground md:inline">
              Enter để gửi · Shift+Enter xuống dòng
            </span>
            <button
              type="submit"
              disabled={!canSend}
              aria-busy={busy}
              aria-label={folder ? "Gửi và mở phiên mới" : "Chọn thư mục trước"}
              title={folder ? "Gửi (Enter)" : "Chọn thư mục trước"}
              className="ml-auto grid size-8 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 disabled:bg-muted disabled:text-muted-foreground motion-reduce:transition-none max-md:size-10"
            >
              {busy ? <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden /> : <ArrowUpIcon className="size-4" aria-hidden />}
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-0.5">
          <span className={cn(CHIP, "pointer-events-none")} title="Phiên chạy trên máy này (HQ chưa hỗ trợ máy từ xa)">
            <MonitorIcon className="size-3.5" aria-hidden /> Máy này
          </span>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger className={cn(CHIP, !folder && "text-foreground")} title={folder ?? "Chọn thư mục"}>
              <FolderIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{label ?? "Chọn thư mục"}</span>
              <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-72">
              {recent.length > 0 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Gần đây</DropdownMenuLabel>}
              {recent.map((p) => {
                const on = folder != null && pathKey(folder) === pathKey(p.path);
                return (
                  <DropdownMenuItem key={p.path} className="max-md:min-h-10" onSelect={() => onFolder(p.path)} title={p.path}>
                    <FolderIcon aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{shortPath(p.path, home)}</span>
                    </span>
                    {on && <CheckIcon className="text-foreground" aria-label="Đang chọn" />}
                  </DropdownMenuItem>
                );
              })}
              {recent.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem className="max-md:min-h-10" onSelect={() => setPicking(true)}>
                <FolderSearchIcon aria-hidden /> Chọn thư mục khác…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <label className={cn(CHIP, "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60")} title="Chạy trong một git worktree riêng (.claude/worktrees/<tên phiên>), không đụng thư mục chính">
            <input type="checkbox" className="size-3.5 accent-primary outline-none" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
            Worktree
          </label>
          <Popover>
            <PopoverTrigger className={cn(CHIP, !modelOk && "text-danger")} title="Model cho phiên mới (để trống: mặc định của omp)">
              <CpuIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate font-mono">{model.trim() || "Model mặc định"}</span>
              <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-72 space-y-2">
              <label htmlFor="ws-model" className="text-xs font-medium">
                Model
              </label>
              <Input
                id="ws-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="vd zai/glm-5.3 (trống: mặc định)"
                aria-invalid={!modelOk}
                aria-describedby="ws-model-hint"
                className="h-8 font-mono text-xs"
                spellCheck={false}
                autoComplete="off"
              />
              <p id="ws-model-hint" className={cn("text-[11px]", modelOk ? "text-muted-foreground" : "text-danger")}>
                {modelOk ? "Dạng provider/model như omp --model. Để trống dùng model mặc định." : "Model không hợp lệ: dạng provider/model, vd zai/glm-5.3."}
              </p>
            </PopoverContent>
          </Popover>
        </div>
        {error && (
          <p role="alert" className="mt-1.5 px-1 text-xs text-pretty text-danger">
            Không mở được phiên: {error}
          </p>
        )}
      </form>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="flex h-[min(36rem,85dvh)] flex-col gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="border-b p-4">
            <DialogTitle>Chọn thư mục</DialogTitle>
            <DialogDescription>Phiên mới chạy trong thư mục này. Dán đường dẫn đầy đủ hoặc duyệt thư mục trên máy.</DialogDescription>
          </DialogHeader>
          <ProjectPicker
            api={api}
            list={list}
            folder={folder}
            home={home}
            browseFrom={browseFrom}
            onPick={(p) => {
              onFolder(p);
              setPicking(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
