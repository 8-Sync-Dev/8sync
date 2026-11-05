"use client";

// The room's "Thư mục" panel (owner 2026-11-05: "không có nút mở folder sidebar như IDE"): the repo as a
// lazily loaded tree, one file at a time in a viewer (markdown rendered, code with line numbers, media,
// HTML in a sandboxed frame) and a plain editor for text files. Server side: app/api/files/**.
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  ImageOffIcon,
  MusicIcon,
  RotateCwIcon,
  SaveIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type RefObject } from "react";
import { toast } from "sonner";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { baseName, safeImageSrc } from "@/lib/artifacts";
import { bytes } from "@/lib/disk";
import { FILES_CONFLICT, filesFileUrl, filesListUrl, filesRawUrl, relJoin, relLink, splitLinks, type DirListing, type FileEntry, type FileSaved, type FileView } from "@/lib/files";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { FolderButton, joinPath } from "./folder-button";
import type { Room } from "./use-office";
import { ApiError, makeApi, type Api } from "./use-hq";

const DISCARD = "Bỏ phần sửa chưa lưu?";

/** "Thư mục" in the room bar: opens the room's repo (its git root, else its cwd) in a right sheet. */
export function FilesButton({ room, token }: { room: Room; token: string }) {
  const root = room.project?.root ?? room.cwd;
  const [open, setOpen] = useState(false);
  const dirtyRef = useRef(false);
  if (!root) return null;
  const change = (o: boolean) => {
    if (!o && dirtyRef.current && !window.confirm(DISCARD)) return;
    if (!o) dirtyRef.current = false;
    setOpen(o);
  };
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(true)} title={`Cây thư mục: ${root}`}>
        <FolderTreeIcon aria-hidden /> Thư mục
      </Button>
      <Sheet open={open} onOpenChange={change}>
        <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[44rem] motion-reduce:animate-none">
          <SheetHeader className="border-b px-4 py-3 pr-12">
            <SheetTitle className="text-base">Thư mục</SheetTitle>
            <SheetDescription className="truncate font-mono text-[11px]" title={root}>
              {root}
            </SheetDescription>
          </SheetHeader>
          {open && <FilesPanel key={root} root={root} token={token} dirtyRef={dirtyRef} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

type DirState = { entries: FileEntry[]; more: boolean } | { error: string };
const FILTER_MAX = 200;

function FilesPanel({ root, token, dirtyRef }: { root: string; token: string; dirtyRef: RefObject<boolean> }) {
  const api = useMemo(() => makeApi(token), [token]);
  /** Loaded folders by relative path ("" = root); absent = still loading. */
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([""]));
  const [filter, setFilter] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(
    async (rel: string) => {
      try {
        const l = await api<DirListing>(filesListUrl(root, rel));
        setDirs((d) => ({ ...d, [rel]: { entries: l.entries, more: l.more } }));
      } catch (e) {
        setDirs((d) => ({ ...d, [rel]: { error: (e as Error).message } }));
      }
    },
    [api, root],
  );
  useEffect(() => {
    void load("");
  }, [load]);

  const toggle = (rel: string) => {
    const next = new Set(expanded);
    if (next.has(rel)) next.delete(rel);
    else {
      next.add(rel);
      if (!dirs[rel]) void load(rel);
    }
    setExpanded(next);
  };
  const refresh = () => {
    setDirs({});
    for (const rel of expanded) void load(rel);
    setNonce((n) => n + 1);
  };
  /** `null` = back to the tree (phone). Unsaved edits are asked about first. */
  const openFile = useCallback(
    (rel: string | null) => {
      if (rel === file) return;
      if (dirtyRef.current && !window.confirm(DISCARD)) return;
      dirtyRef.current = false;
      setFile(rel);
    },
    [file, dirtyRef],
  );

  const q = filter.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!q) return [];
    const out: { rel: string; e: FileEntry }[] = [];
    for (const [dir, st] of Object.entries(dirs)) {
      if (!("entries" in st)) continue;
      for (const e of st.entries) if (e.name.toLowerCase().includes(q)) out.push({ rel: relJoin(dir, e.name), e });
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel)).slice(0, FILTER_MAX);
  }, [dirs, q]);

  return (
    <div className="grid min-h-0 flex-1 sm:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Cây thư mục" className={cn("flex min-h-0 flex-col border-r", file && "max-sm:hidden")}>
        <div className="flex shrink-0 items-center gap-1 border-b p-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Tìm file" aria-label="Tìm file trong các thư mục đã mở" className="h-8 pl-7 text-xs" />
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={refresh} aria-label="Tải lại cây thư mục" title="Tải lại">
            <RotateCwIcon />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1 text-xs">
          {q ? (
            hits.length ? (
              <ul>
                {hits.map(({ rel, e }) => (
                  <li key={rel}>
                    <EntryButton
                      e={e}
                      depth={0}
                      label={rel}
                      current={rel === file}
                      open={expanded.has(rel)}
                      onClick={() => {
                        if (!e.dir) return openFile(rel);
                        if (!expanded.has(rel)) toggle(rel);
                        setFilter("");
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-2 text-muted-foreground">Không thấy tên nào khớp trong các thư mục đã mở.</p>
            )
          ) : (
            <DirList rel="" depth={0} dirs={dirs} expanded={expanded} file={file} onToggle={toggle} onOpen={openFile} onRetry={load} />
          )}
        </div>
      </nav>
      <section aria-label="Xem file" className={cn("flex min-h-0 flex-col", !file && "max-sm:hidden")}>
        {file ? (
          <FileViewer root={root} rel={file} api={api} token={token} nonce={nonce} dirtyRef={dirtyRef} onOpen={openFile} onBack={() => openFile(null)} />
        ) : (
          <p className="m-auto max-w-xs px-4 text-center text-sm text-pretty text-muted-foreground">Chọn một file bên trái để xem, sửa hoặc mở link trong đó.</p>
        )}
      </section>
    </div>
  );
}

function DirList({
  rel,
  depth,
  dirs,
  expanded,
  file,
  onToggle,
  onOpen,
  onRetry,
}: {
  rel: string;
  depth: number;
  dirs: Record<string, DirState>;
  expanded: ReadonlySet<string>;
  file: string | null;
  onToggle: (rel: string) => void;
  onOpen: (rel: string) => void;
  onRetry: (rel: string) => void;
}) {
  const st = dirs[rel];
  const pad = { paddingLeft: `${0.5 + depth * 0.75}rem` };
  if (!st)
    return (
      <p style={pad} className="py-1 text-muted-foreground">
        Đang tải…
      </p>
    );
  if ("error" in st)
    return (
      <p style={pad} className="flex items-center gap-1 py-1 text-destructive">
        <span className="min-w-0 flex-1 truncate" title={st.error}>
          Không đọc được: {st.error}
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={() => onRetry(rel)}>
          Thử lại
        </Button>
      </p>
    );
  if (!st.entries.length)
    return (
      <p style={pad} className="py-1 text-muted-foreground">
        Trống.
      </p>
    );
  return (
    <ul>
      {st.entries.map((e) => {
        const r = relJoin(rel, e.name);
        const open = e.dir && expanded.has(r);
        return (
          <li key={e.name}>
            <EntryButton e={e} depth={depth} label={e.name} current={r === file} open={open} onClick={() => (e.dir ? onToggle(r) : onOpen(r))} />
            {open && <DirList rel={r} depth={depth + 1} dirs={dirs} expanded={expanded} file={file} onToggle={onToggle} onOpen={onOpen} onRetry={onRetry} />}
          </li>
        );
      })}
      {st.more && (
        <li style={pad} className="py-1 text-muted-foreground">
          Còn nữa: thư mục quá nhiều mục, chỉ hiện phần đầu.
        </li>
      )}
    </ul>
  );
}

function EntryButton({ e, depth, label, current, open, onClick }: { e: FileEntry; depth: number; label: string; current: boolean; open: boolean; onClick: () => void }) {
  const Icon = e.dir ? (open ? FolderOpenIcon : FolderIcon) : FileIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={e.dir ? open : undefined}
      aria-current={current ? "true" : undefined}
      title={label}
      style={{ paddingLeft: `${0.25 + depth * 0.75}rem` }}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 py-1 pr-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none max-sm:py-2",
        current && "bg-accent text-accent-foreground",
        e.name.startsWith(".") && "text-muted-foreground",
      )}
    >
      <ChevronRightIcon aria-hidden className={cn("size-3 shrink-0 transition-transform motion-reduce:transition-none", !e.dir && "invisible", open && "rotate-90")} />
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

type Loaded = { key: string; view?: FileView; error?: string };

function FileViewer({
  root,
  rel,
  api,
  token,
  nonce,
  dirtyRef,
  onOpen,
  onBack,
}: {
  root: string;
  rel: string;
  api: Api;
  token: string;
  nonce: number;
  dirtyRef: RefObject<boolean>;
  onOpen: (rel: string) => void;
  onBack: () => void;
}) {
  const [reload, setReload] = useState(0);
  const key = `${rel}:${nonce}:${reload}`;
  const [st, setSt] = useState<Loaded | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api<FileView>(filesFileUrl(root, rel), { signal: ac.signal })
      .then((view) => setSt({ key, view }))
      .catch((e: Error) => {
        if (!ac.signal.aborted) setSt({ key, error: e.message });
      });
    return () => ac.abort();
  }, [api, root, rel, key]);
  const cur = st?.key === key ? st : null;
  const crumbs = rel.split("/");
  const full = joinPath(root, rel);

  return (
    <article aria-label={baseName(rel)} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
        <Button type="button" variant="ghost" size="icon-sm" className="-ml-1 shrink-0 sm:hidden max-sm:size-10" onClick={onBack} aria-label="Về cây thư mục">
          <ArrowLeftIcon />
        </Button>
        <nav aria-label="Đường dẫn file" className="min-w-0 flex-1">
          <ol className="flex min-w-0 flex-wrap items-center gap-x-1 font-mono text-[11px] text-muted-foreground">
            <li className="truncate">{baseName(root)}</li>
            {crumbs.map((c, i) => (
              <li key={i} className={cn("flex min-w-0 items-center gap-1", i === crumbs.length - 1 && "font-semibold text-foreground")}>
                <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
                <span className="truncate" aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                  {c}
                </span>
              </li>
            ))}
          </ol>
          {cur?.view && (
            <p className="text-[11px] text-muted-foreground tabular">
              {bytes(cur.view.size)} · sửa lúc {new Date(cur.view.mtime).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
            </p>
          )}
        </nav>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyButton value={full} label="Chép đường dẫn" className="max-sm:size-10" />
          <FolderButton path={rel} base={root} api={api} className="max-sm:size-10" />
          {cur?.view && (
            <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground max-sm:size-10">
              <a href={`${cur.view.src}&download=1`} download={cur.view.name} aria-label="Tải về" title="Tải về">
                <DownloadIcon />
              </a>
            </Button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!cur ? (
          <Skeleton className="h-[min(60dvh,30rem)] w-full rounded-lg" />
        ) : cur.error ? (
          <Note title="Không mở được file" tone="error">
            {cur.error}
          </Note>
        ) : (
          cur.view && (
            <FileBody
              key={key}
              root={root}
              view={cur.view}
              api={api}
              token={token}
              dirtyRef={dirtyRef}
              onOpen={onOpen}
              onSaved={(s, text) => cur.view && setSt({ key, view: { ...cur.view, ...s, text } })}
              onReload={() => {
                dirtyRef.current = false;
                setReload((n) => n + 1);
              }}
            />
          )
        )}
      </div>
    </article>
  );
}

function FileBody({
  root,
  view,
  api,
  token,
  dirtyRef,
  onOpen,
  onSaved,
  onReload,
}: {
  root: string;
  view: FileView;
  api: Api;
  token: string;
  dirtyRef: RefObject<boolean>;
  onOpen: (rel: string) => void;
  onSaved: (s: FileSaved, text: string) => void;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState(view.text ?? "");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const changed = view.text !== undefined && draft !== view.text;
  useEffect(() => {
    dirtyRef.current = changed;
  }, [dirtyRef, changed]);
  const md = useMemo(() => mdComponents(view.path, onOpen), [view.path, onOpen]);

  const save = async () => {
    if (!changed || saving || !view.hash) return;
    setSaving(true);
    try {
      const s = await api<FileSaved>("/api/files/file", { method: "PUT", body: { root, path: view.path, text: draft, hash: view.hash } });
      setConflict(false);
      onSaved(s, draft);
      toast.success(`Đã lưu ${view.name}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else toast.error(`Không lưu được: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };

  if (view.big) return <Note title="File chữ quá dài để xem ở đây">Bấm “Tải về” để mở bằng ứng dụng trên máy.</Note>;
  switch (view.kind) {
    case "image":
      // The signed src, not next/image (no optimizer for private files). SVG as <img> runs no script.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={view.src} alt={view.name} className="mx-auto max-h-[75dvh] max-w-full rounded-lg border bg-muted object-contain" />;
    case "video":
      return <video src={view.src} controls playsInline preload="metadata" className="mx-auto max-h-[75dvh] max-w-full rounded-lg border bg-black" aria-label={view.name} />;
    case "audio":
      return (
        <figure className="mx-auto flex max-w-xl flex-col gap-3 rounded-lg border bg-muted/30 p-4">
          <figcaption className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <MusicIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{view.name}</span>
          </figcaption>
          <audio src={view.src} controls preload="metadata" className="w-full" aria-label={view.name} />
        </figure>
      );
    case "pdf":
      return <PdfFrame root={root} view={view} token={token} />;
    case "office":
    case "binary":
      return <Note title="Không xem trước được loại file này">Bấm “Tải về” để mở bằng ứng dụng trên máy.</Note>;
  }
  const text = view.text ?? "";
  return (
    <Tabs defaultValue="view" className="min-h-full gap-2">
      <TabsList>
        <TabsTrigger value="view">Xem</TabsTrigger>
        {view.kind === "html" && <TabsTrigger value="source">Mã nguồn</TabsTrigger>}
        {view.editable && (
          <TabsTrigger value="edit">
            Sửa
            {changed && (
              <span aria-label="chưa lưu" className="ml-1 text-amber-600 dark:text-amber-400">
                ●
              </span>
            )}
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="view">
        {view.kind === "markdown" ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <MessageResponse components={md}>{text}</MessageResponse>
          </div>
        ) : view.kind === "html" ? (
          // srcdoc without allow-same-origin: the page runs in an opaque origin, never as HQ (no token, no cookies).
          <iframe srcDoc={text} sandbox="allow-scripts allow-popups" referrerPolicy="no-referrer" title={view.name} className="h-[min(70dvh,48rem)] w-full rounded-lg border bg-white" />
        ) : (
          <CodeView text={text} />
        )}
      </TabsContent>
      {view.kind === "html" && (
        <TabsContent value="source">
          <CodeView text={text} />
        </TabsContent>
      )}
      {view.editable && (
        <TabsContent value="edit" className="space-y-2" onKeyDown={onKey}>
          {conflict && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              <AlertTriangleIcon aria-hidden className="size-4 shrink-0 text-destructive" />
              <span className="min-w-0 flex-1">{FILES_CONFLICT.charAt(0).toUpperCase() + FILES_CONFLICT.slice(1)}: phần anh sửa chưa ghi. Chép nó ra trước khi tải lại.</span>
              <CopyButton value={draft} label="Chép phần đang sửa" text />
              <Button type="button" size="xs" variant="outline" onClick={onReload}>
                <RotateCwIcon /> Tải lại
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={!changed || saving} aria-busy={saving}>
              <SaveIcon aria-hidden /> {saving ? "Đang lưu…" : "Lưu"}
            </Button>
            <span className="text-xs text-muted-foreground">{changed ? "Chưa lưu · Ctrl/Cmd+S để lưu" : "Không có thay đổi"}</span>
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label={`Sửa ${view.name}`}
            className="h-[min(65dvh,44rem)] resize-y font-mono text-xs leading-5 [field-sizing:fixed] md:text-xs"
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

/** Text with a line-number gutter; http(s) URLs in it open in a new tab. No wrapping, so the numbers line up. */
function CodeView({ text }: { text: string }) {
  const gutter = useMemo(() => {
    const n = text.split("\n").length;
    return Array.from({ length: n }, (_, i) => i + 1).join("\n");
  }, [text]);
  const parts = useMemo(() => splitLinks(text), [text]);
  return (
    <div className="flex overflow-auto rounded-lg border bg-muted/40 font-mono text-xs leading-5">
      <pre aria-hidden className="sticky left-0 shrink-0 border-r bg-muted px-2 py-2 text-right text-muted-foreground/70 select-none">
        {gutter}
      </pre>
      <pre className="min-w-0 flex-1 px-3 py-2 whitespace-pre">
        {parts.map((p, i) =>
          typeof p === "string" ? (
            p
          ) : (
            <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              {p.url}
            </a>
          ),
        )}
      </pre>
    </div>
  );
}

/**
 * Markdown links: http(s) open in a new tab (no opener, no referrer); a relative link to another file of
 * the repo opens it here. Images load only from `data:` or HQ's own origin (lib/artifacts.ts safeImageSrc).
 */
function mdComponents(fromFile: string, onOpen: (rel: string) => void) {
  return {
    a: ({ href, children }: ComponentProps<"a">) => {
      const local = typeof href === "string" ? relLink(fromFile, href) : null;
      if (local)
        return (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onOpen(local);
            }}
            className="text-primary underline underline-offset-2"
            title={local}
          >
            {children}
          </a>
        );
      if (typeof href === "string" && /^https?:\/\//i.test(href))
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        );
      return <span>{children}</span>;
    },
    img: ({ src, alt }: ComponentProps<"img">) => {
      const ok = safeImageSrc(src, window.location.origin);
      if (!ok)
        return (
          <span className="inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground" title={typeof src === "string" ? src : undefined}>
            <ImageOffIcon aria-hidden className="size-3.5" />
            Ảnh ngoài bị chặn{alt ? `: ${alt}` : ""}
          </span>
        );
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={ok} alt={alt ?? ""} referrerPolicy="no-referrer" className="max-w-full rounded" />;
    },
    source: () => null,
  };
}

/** A PDF through an object URL: a frame cannot load an HQ route (frame-ancestors 'none'). */
function PdfFrame({ root, view, token }: { root: string; view: FileView; token: string }) {
  const [st, setSt] = useState<{ key: string; url: string | null } | null>(null);
  const key = `${view.path}:${view.mtime}`;
  useEffect(() => {
    const ac = new AbortController();
    let obj: string | null = null;
    fetch(filesRawUrl(root, view.path), { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        obj = URL.createObjectURL(await r.blob());
        setSt({ key, url: obj });
      })
      .catch(() => {
        if (!ac.signal.aborted) setSt({ key, url: null });
      });
    return () => {
      ac.abort();
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [root, view.path, token, key]);
  const cur = st?.key === key ? st : null;
  if (!cur) return <Skeleton className="h-[min(70dvh,48rem)] w-full rounded-lg" />;
  if (!cur.url) return <Note title="Không mở được PDF">Bấm “Tải về” để mở bằng ứng dụng trên máy.</Note>;
  return <iframe src={cur.url} title={view.name} className="h-[min(75dvh,56rem)] w-full rounded-lg border" />;
}

function Note({ title, children, tone }: { title: string; children: string; tone?: "error" }) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className={cn("mx-auto max-w-md space-y-1 rounded-lg border px-4 py-3 text-sm", tone === "error" ? "border-destructive/30 bg-destructive/5" : "bg-muted/30")}>
      <p className="font-medium">{title}</p>
      <p className="text-pretty text-muted-foreground">{children}</p>
    </div>
  );
}
