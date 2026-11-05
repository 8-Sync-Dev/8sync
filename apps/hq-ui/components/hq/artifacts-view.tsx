"use client";

import {
  ArrowLeftIcon,
  DownloadIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileXIcon,
  FilmIcon,
  GlobeIcon,
  ImageIcon,
  ImageOffIcon,
  InboxIcon,
  MusicIcon,
  PresentationIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ARTIFACT_PARAM, KIND_LABEL, TEXT_INLINE_MAX, artifactFileUrl, baseName, extOf, groupArtifacts, officeFamily, officeReadable, safeImageSrc, type ArtifactKind, type ArtifactView } from "@/lib/artifacts";
import { askRoomFor } from "@/lib/ask-quote";
import { parseDelimited } from "@/lib/csv";
import { bytes } from "@/lib/disk";
import { useFollowRepo } from "@/lib/follow-repo";
import { agoShort, agoVi } from "@/lib/now";
import type { OfficeDoc } from "@/lib/office-preview";
import { rootKey } from "@/lib/preview";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorNote } from "./bits";
import { CopyButton } from "./copy-button";
import { FolderButton } from "./folder-button";
import { SelectionAsk } from "./selection-ask";
import type { Room } from "./use-office";
import { makeApi, type Api } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 15_000;
const ALL = "__all";

const KIND_ICON: Record<ArtifactKind, typeof FileIcon> = {
  image: ImageIcon,
  video: FilmIcon,
  audio: MusicIcon,
  pdf: FileTextIcon,
  office: FileTextIcon,
  html: GlobeIcon,
  markdown: FileTextIcon,
  text: FileIcon,
};
const FAMILY_ICON = { doc: FileTextIcon, sheet: FileSpreadsheetIcon, slides: PresentationIcon } as const;
/** The kind's icon; an Office file by what it is (document, sheet, slides). */
function KindIcon({ a, className }: { a: ArtifactView; className?: string }) {
  const f = a.kind === "office" ? officeFamily(a.path) : null;
  const Icon = f ? FAMILY_ICON[f] : KIND_ICON[a.kind];
  return <Icon aria-hidden className={className} />;
}

/** Kinds read as text: shown in a `<pre>` (CSV/TSV as a table, HTML in a sandboxed srcdoc frame), offered as a download past TEXT_INLINE_MAX. */
const TEXT_KINDS: Record<ArtifactKind, boolean> = { image: false, video: false, audio: false, pdf: false, office: false, html: true, markdown: true, text: true };

/** Where a question about an artifact goes; `reason` says why there is none. */
type AskTarget = { room: Room; reason: null } | { room: null; reason: string };

/**
 * "Kết quả" tab: the files rooms registered for the owner (POST /api/artifacts), newest first, one
 * block per project. A row opens the file beside the list (over it on a phone); removing one only
 * takes it off the list, the file on disk stays. Selecting text in a result asks the room that made it
 * (or the project's latest live room) about it: `onAsk` opens that room, whose composer has the quote.
 */
export function ArtifactsView({
  token,
  active,
  repo = null,
  rooms,
  onAsk,
}: {
  token: string;
  active: boolean;
  repo?: string | null;
  rooms: Room[];
  onAsk: (room: Room) => void;
}) {
  const api = useMemo(() => makeApi(token), [token]);
  const list = usePoll<{ artifacts: ArtifactView[]; at: number }>(api, "/api/artifacts", POLL_MS, active);
  const [pick, setPick] = useState(ALL);
  useFollowRepo(repo, (r) => setPick(rootKey(r)));
  // `?artifact=<id>`: another tab (a room's Báo cáo) asked to open this file; read once, then dropped from the URL.
  const [openId, setOpenId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(ARTIFACT_PARAM)));
  useEffect(() => {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(ARTIFACT_PARAM)) return;
    u.searchParams.delete(ARTIFACT_PARAM);
    window.history.replaceState(window.history.state, "", u);
  }, []);
  const groups = useMemo(() => groupArtifacts(list.data?.artifacts ?? []), [list.data]);
  // The sidebar's repo with nothing registered yet: show every project rather than an empty pick.
  const cur = groups.some((g) => g.key === pick) ? pick : ALL;
  const shown = cur === ALL ? groups : groups.filter((g) => g.key === cur);
  const open = list.data?.artifacts.find((a) => a.id === openId) ?? null;
  const now = list.at;
  const { reload } = list;
  const remove = useCallback(
    async (a: ArtifactView) => {
      if (!window.confirm(`Bỏ «${a.title}» khỏi Kết quả? File trên máy vẫn giữ nguyên.`)) return;
      try {
        await api(`/api/artifacts/${a.id}`, { method: "DELETE" });
        setOpenId((id) => (id === a.id ? null : id));
        reload();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [api, reload],
  );
  const target: AskTarget | null = useMemo(() => {
    if (!open) return null;
    const room = askRoomFor(open, rooms);
    return room ? { room, reason: null } : { room: null, reason: "Dự án này chưa có phòng nào đang chạy để hỏi." };
  }, [open, rooms]);

  if (list.error && !list.data) {
    return (
      <div className="p-4 sm:px-6">
        <ErrorNote what="kết quả" error={list.error} onRetry={list.reload} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 sm:px-6">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <InboxIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Kết quả
          <span className="text-xs font-normal text-muted-foreground max-sm:hidden">file các phòng đăng cho anh xem</span>
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {groups.length > 1 && (
            <Select value={cur} onValueChange={setPick}>
              <SelectTrigger size="sm" className="max-w-64 text-xs" aria-label="Dự án">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-xs">
                  Tất cả dự án
                </SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.key} value={g.key} className="text-xs">
                    {g.project}
                    <span className="text-muted-foreground tabular"> · {g.items.length}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant="ghost" size="icon-sm" onClick={list.reload} aria-label="Tải lại kết quả">
            <RefreshCwIcon />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
        <div className={cn("min-h-0 overflow-y-auto lg:border-r", open && "max-lg:hidden")}>
          {!list.data ? (
            <ListSkeleton />
          ) : groups.length === 0 ? (
            <Empty />
          ) : (
            shown.map((g) => (
              <section key={g.key} aria-label={g.project}>
                {cur === ALL && (
                  <h3 className="sticky top-0 z-10 flex items-baseline gap-1.5 border-b bg-background/95 px-4 py-1.5 text-xs font-semibold backdrop-blur sm:px-6" title={g.root}>
                    {g.project}
                    <span className="font-normal text-muted-foreground tabular">{g.items.length}</span>
                  </h3>
                )}
                <ul className="divide-y">
                  {g.items.map((a) => (
                    <Row key={a.id} a={a} api={api} now={now} current={a.id === openId} onOpen={() => setOpenId(a.id)} onRemove={() => remove(a)} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className={cn("min-h-0", !open && "max-lg:hidden")}>
          {open && target ? (
            <Viewer
              key={open.id}
              a={open}
              api={api}
              token={token}
              now={now}
              target={target}
              onAsk={() => target.room && onAsk(target.room)}
              onClose={() => setOpenId(null)}
              onRemove={() => remove(open)}
            />
          ) : (
            list.data &&
            groups.length > 0 && <p className="grid h-full place-items-center px-6 text-sm text-muted-foreground">Chọn một kết quả để mở.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ a, api, now, current, onOpen, onRemove }: { a: ArtifactView; api: Api; now: number; current: boolean; onOpen: () => void; onRemove: () => void }) {
  return (
    <li className={cn("group/row flex items-start gap-1 py-1 pr-2 pl-2 sm:pr-4 sm:pl-4", current ? "bg-muted" : "hover:bg-muted/50")}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={current || undefined}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <KindIcon a={a} className={cn("mt-0.5 size-4 shrink-0", a.missing ? "text-muted-foreground/50" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13px] font-medium", a.missing && "text-muted-foreground line-through")}>{a.title}</span>
          {a.note && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.note}</span>}
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground tabular">
            <span>{KIND_LABEL[a.kind]}</span>
            {a.missing ? <span className="font-medium text-destructive">mất file</span> : a.size != null && <span>{bytes(a.size)}</span>}
            {a.branch && <span className="max-w-32 truncate font-mono">{a.branch}</span>}
            <span title={new Date(a.updated_at).toLocaleString()}>{agoShort(a.updated_at, now)}</span>
          </span>
        </span>
      </button>
      <FolderButton path={a.path} id={a.missing ? undefined : a.id} api={api} className="mt-1 shrink-0 opacity-60 group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:size-10" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="mt-1 shrink-0 text-muted-foreground opacity-60 group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:size-10"
        onClick={onRemove}
        aria-label={`Bỏ ${a.title} khỏi Kết quả`}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

/** "Tải về": the signed link straight to the file (no copy in memory, works for a 2 GB video too). */
function DownloadLink({ a, className, children = "Tải về" }: { a: ArtifactView; className?: string; children?: ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm" className={cn("text-xs max-sm:h-10", className)}>
      <a href={`${a.src}&download=1`} download={baseName(a.path)}>
        <DownloadIcon /> {children}
      </a>
    </Button>
  );
}

/** One artifact opened: its name, where it is, and the file itself. */
function Viewer({
  a,
  api,
  token,
  now,
  target,
  onAsk,
  onClose,
  onRemove,
}: {
  a: ArtifactView;
  api: Api;
  token: string;
  now: number;
  target: AskTarget;
  onAsk: () => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <article aria-label={a.title} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start gap-2 border-b px-4 py-2.5 sm:px-6">
        <Button type="button" variant="ghost" size="icon-sm" className="-ml-1.5 shrink-0 lg:hidden max-sm:size-10" onClick={onClose} aria-label="Về danh sách">
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="truncate text-sm font-semibold">{a.title}</h3>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular">
            <span>{a.project}</span>
            {a.branch && <span className="font-mono">{a.branch}</span>}
            <span>{KIND_LABEL[a.kind]}</span>
            {a.size != null && <span>{bytes(a.size)}</span>}
            <span title={new Date(a.updated_at).toLocaleString()}>đăng {agoVi(a.updated_at, now)}</span>
            {target.room ? (
              <span className="max-w-48 truncate" title={`Hỏi về một đoạn sẽ gửi vào phòng ${target.room.name}`}>
                phòng <span className="font-mono">{target.room.name}</span>
              </span>
            ) : (
              a.session && (
                <span className="max-w-40 truncate font-mono" title={`phòng ${a.session}`}>
                  {a.session}
                </span>
              )
            )}
          </p>
          {a.note && <p className="text-xs text-foreground/80">{a.note}</p>}
          <code className="block font-mono text-[11px] break-all text-muted-foreground">{a.path}</code>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <FolderButton path={a.path} id={a.missing ? undefined : a.id} api={api} className="max-sm:size-10" />
          {!a.missing && <DownloadLink a={a} />}
          <Button type="button" variant="ghost" size="icon-sm" className="max-sm:size-10" onClick={onRemove} aria-label={`Bỏ ${a.title} khỏi Kết quả`}>
            <Trash2Icon />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="max-lg:hidden" onClick={onClose} aria-label="Đóng">
            <XIcon />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <SelectionAsk fallbackRef={baseName(a.path)} disabledReason={target.reason} onAsked={onAsk}>
          <Body a={a} api={api} token={token} />
        </SelectionAsk>
      </div>
    </article>
  );
}

type Loaded = { key: string; url: string | null; text: string | null; failed: boolean };

/** The file's bytes with the token: text for the text kinds, an object URL for a PDF (a frame cannot load an HQ route); refetched when the file changes. */
function useArtifactFile(token: string, a: ArtifactView, skip: boolean): Loaded | null {
  const asText = TEXT_KINDS[a.kind];
  const key = `${a.id}:${a.mtime ?? 0}:${a.updated_at}`;
  const [st, setSt] = useState<Loaded | null>(null);
  useEffect(() => {
    if (skip) return;
    const ac = new AbortController();
    let obj: string | null = null;
    fetch(artifactFileUrl(a.id), { headers: { "x-hq-token": token }, signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        if (asText) {
          setSt({ key, url: null, text: await r.text(), failed: false });
          return;
        }
        obj = URL.createObjectURL(await r.blob());
        setSt({ key, url: obj, text: null, failed: false });
      })
      .catch(() => {
        if (!ac.signal.aborted) setSt({ key, url: null, text: null, failed: true });
      });
    return () => {
      ac.abort();
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [token, a.id, key, asText, skip]);
  return st && st.key === key ? st : null;
}

const FRAME = "h-[min(78dvh,60rem)] w-full rounded-lg border";

/** Markdown `<img>`: only `data:` or HQ's own origin load (lib/artifacts.ts safeImageSrc); a remote one shows as a note. */
function MarkdownImage({ src, alt }: ComponentProps<"img">) {
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
}

/** `<picture><source srcset>` would load around the img check: dropped, the inner `<img>` still goes through it. */
const markdownComponents = { img: MarkdownImage, source: () => null };

function Body({ a, api, token }: { a: ArtifactView; api: Api; token: string }) {
  const big = TEXT_KINDS[a.kind] && (a.size ?? 0) > TEXT_INLINE_MAX;
  // Image, video and audio stream from the signed `src` (Range: a video seeks without loading whole).
  const direct = a.kind === "image" || a.kind === "video" || a.kind === "audio" || a.kind === "office";
  const f = useArtifactFile(token, a, a.missing || big || direct);
  const [broken, setBroken] = useState(false);
  if (a.missing) return <Note title="File không còn ở đường dẫn này">Phòng đã xoá hoặc dời nó. Bỏ khỏi danh sách, hoặc nhờ phòng đăng lại.</Note>;
  if (big) return <Note title="File chữ quá dài để xem ở đây">Bấm “Tải về” để mở bằng ứng dụng trên máy.</Note>;
  if (broken) return <Unsupported a={a} api={api} title="Trình duyệt không mở được file này" why="Định dạng hoặc codec này trình duyệt chưa hỗ trợ. Tải về để mở bằng ứng dụng trên máy." />;
  switch (a.kind) {
    case "image":
      // The signed src, not next/image (no optimizer for private files). SVG as <img> runs no script.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={a.src} alt={a.title} onError={() => setBroken(true)} className="mx-auto max-h-[78dvh] max-w-full rounded-lg border bg-muted object-contain" />;
    case "video":
      return <video src={a.src} controls playsInline preload="metadata" onError={() => setBroken(true)} className="mx-auto max-h-[78dvh] max-w-full rounded-lg border bg-black" aria-label={a.title} />;
    case "audio":
      return (
        <figure className="mx-auto flex max-w-xl flex-col gap-3 rounded-lg border bg-muted/30 p-4">
          <figcaption className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <MusicIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{a.title}</span>
          </figcaption>
          <audio src={a.src} controls preload="metadata" onError={() => setBroken(true)} className="w-full" aria-label={a.title} />
        </figure>
      );
    case "office":
      return <OfficeBody a={a} api={api} token={token} />;
  }
  if (!f) return <Skeleton className="h-[min(70dvh,40rem)] w-full rounded-lg" />;
  if (f.failed) return <Note title="Không mở được file">HQ không đọc được nó lúc này (file đổi loại, quá cỡ hoặc ra ngoài dự án). Tải lại hoặc nhờ phòng đăng lại.</Note>;
  switch (a.kind) {
    case "pdf":
      // The browser's PDF viewer refuses a sandboxed frame; a PDF is not HTML and gets no HQ script access.
      return <iframe src={f.url ?? ""} title={a.title} className={FRAME} />;
    case "html":
      // srcdoc without allow-same-origin: the page runs in an opaque origin, never as HQ (no token, no cookies).
      return <iframe srcDoc={f.text ?? ""} sandbox="allow-scripts allow-popups" referrerPolicy="no-referrer" title={a.title} className={cn(FRAME, "bg-white")} />;
    case "markdown":
      return (
        <TextFrame copy={f.text ?? ""}>
          <div className="text-sm">
            <MessageResponse components={markdownComponents}>{f.text ?? ""}</MessageResponse>
          </div>
        </TextFrame>
      );
  }
  const ext = extOf(a.path);
  if (ext === ".csv" || ext === ".tsv") {
    const t = parseDelimited(f.text ?? "", ext === ".tsv" ? "\t" : ",");
    return (
      <TextFrame copy={f.text ?? ""}>
        <DataTable rows={t.rows} header more={t.more ? "Còn nữa: tải về để xem hết." : null} />
      </TextFrame>
    );
  }
  return (
    <TextFrame copy={f.text ?? ""}>
      <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{f.text}</pre>
    </TextFrame>
  );
}

/** A text result with its "Chép" in the corner. */
function TextFrame({ copy, children }: { copy: string; children: ReactNode }) {
  return (
    <div className="relative min-h-full rounded-lg border bg-muted/40 p-3 pt-9">
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={copy} label="Chép nội dung file" text />
      </div>
      {children}
    </div>
  );
}

function DataTable({ rows, header = false, more = null }: { rows: string[][]; header?: boolean; more?: string | null }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Trống.</p>;
  const [head, ...rest] = header ? rows : [null, ...rows];
  return (
    <div className="overflow-auto rounded-md border bg-background">
      <table className="w-max min-w-full border-collapse text-xs tabular">
        {head && (
          <thead className="sticky top-0 bg-muted">
            <tr>
              {head.map((c, i) => (
                <th key={i} scope="col" className="border-b px-2 py-1.5 text-left font-semibold whitespace-pre-wrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rest.map((r, i) => (
            <tr key={i} className="odd:bg-muted/30">
              {(r ?? []).map((c, j) => (
                <td key={j} className="max-w-96 border-b px-2 py-1 align-top whitespace-pre-wrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more && <p className="px-2 py-1.5 text-xs text-muted-foreground">{more}</p>}
    </div>
  );
}

type OfficeState = { key: string } & ({ mode: "pdf"; url: string } | { mode: "doc"; doc: OfficeDoc; text: string } | { mode: "none"; why: string });

/**
 * An Office file: as PDF when LibreOffice is on HQ's machine (GET /api/artifacts/<id>/pdf), else read here
 * (docx/xlsx/pptx/odt/ods/odp, lib/office-preview.ts, loaded only now), else a card to download it.
 */
function OfficeBody({ a, api, token }: { a: ArtifactView; api: Api; token: string }) {
  const key = `${a.id}:${a.mtime ?? 0}:${a.updated_at}`;
  const [st, setSt] = useState<OfficeState | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    let obj: string | null = null;
    const headers = { "x-hq-token": token };
    (async () => {
      const r = await fetch(`/api/artifacts/${a.id}/pdf`, { headers, signal: ac.signal, cache: "no-store" });
      if (r.ok) {
        obj = URL.createObjectURL(await r.blob());
        return setSt({ key, mode: "pdf", url: obj });
      }
      const noSoffice = r.status === 501;
      if (!officeReadable(a.path)) {
        return setSt({
          key,
          mode: "none",
          why: noSoffice ? "File Office đời cũ (.doc/.xls/.ppt) cần LibreOffice trên máy chạy HQ để xem trước." : "LibreOffice không chuyển được file này.",
        });
      }
      const [file, mod] = await Promise.all([fetch(artifactFileUrl(a.id), { headers, signal: ac.signal, cache: "no-store" }), import("@/lib/office-preview")]);
      const doc = file.ok ? await mod.readOffice(a.path, await file.arrayBuffer()) : null;
      setSt(doc ? { key, mode: "doc", doc, text: mod.officeText(doc) } : { key, mode: "none", why: "File hỏng hoặc định dạng này chưa đọc được." });
    })().catch(() => {
      if (!ac.signal.aborted) setSt({ key, mode: "none", why: "HQ không đọc được file lúc này." });
    });
    return () => {
      ac.abort();
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [a.id, a.path, key, token]);
  const cur = st && st.key === key ? st : null;
  if (!cur) return <Skeleton className="h-[min(70dvh,40rem)] w-full rounded-lg" />;
  if (cur.mode === "pdf") return <iframe src={cur.url} title={a.title} className={FRAME} />;
  if (cur.mode === "none") return <Unsupported a={a} api={api} title="Chưa xem trước được loại file này" why={cur.why} />;
  return <OfficeDocView doc={cur.doc} text={cur.text} />;
}

function OfficeDocView({ doc, text }: { doc: OfficeDoc; text: string }) {
  return (
    <TextFrame copy={text}>
      <p className="mb-3 text-[11px] text-muted-foreground">Bản xem nhanh (chữ và bảng, chưa có định dạng). Cài LibreOffice trên máy chạy HQ để xem đúng như file gốc.</p>
      {doc.kind === "doc" && (
        <div className="max-w-3xl space-y-2 text-sm leading-relaxed">
          {doc.blocks.map((b, i) =>
            b.t === "h" ? (
              <p key={i} role="heading" aria-level={Math.min(b.level + 3, 6)} className={cn("font-semibold text-pretty", b.level <= 1 ? "pt-2 text-lg" : b.level === 2 ? "pt-1.5 text-base" : "text-sm")}>
                {b.text}
              </p>
            ) : b.t === "li" ? (
              <p key={i} className="flex gap-2 whitespace-pre-wrap" style={{ paddingLeft: `${b.depth * 1.25}rem` }}>
                <span aria-hidden className="text-muted-foreground">•</span>
                <span>{b.text}</span>
              </p>
            ) : b.t === "table" ? (
              <DataTable key={i} rows={b.rows} />
            ) : (
              <p key={i} className="whitespace-pre-wrap text-pretty">
                {b.text}
              </p>
            ),
          )}
          {doc.more && <p className="text-xs text-muted-foreground">Còn nữa: tải về để đọc hết.</p>}
        </div>
      )}
      {doc.kind === "sheet" && (
        <div className="space-y-4">
          {doc.sheets.map((s, i) => (
            <section key={i} aria-label={s.name} className="space-y-1.5">
              <h4 className="text-xs font-semibold">{s.name}</h4>
              <DataTable rows={s.rows} more={s.more ? "Còn nữa: tải về để xem hết." : null} />
            </section>
          ))}
          {doc.moreSheets > 0 && <p className="text-xs text-muted-foreground">Còn {doc.moreSheets} sheet nữa trong file.</p>}
        </div>
      )}
      {doc.kind === "slides" && (
        <ol className="grid gap-3 sm:grid-cols-2">
          {doc.slides.map((s, i) => (
            <li key={i} className="flex aspect-video min-w-0 flex-col gap-1.5 overflow-hidden rounded-md border bg-background p-3">
              <span className="text-[11px] text-muted-foreground tabular">Slide {i + 1}</span>
              {s.title && <p className="text-sm font-semibold text-pretty">{s.title}</p>}
              <ul className="min-h-0 space-y-0.5 overflow-hidden text-xs text-foreground/80">
                {s.lines.map((l, j) => (
                  <li key={j} className="whitespace-pre-wrap">
                    {l}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {doc.more && <li className="text-xs text-muted-foreground">Còn nữa: tải về để xem hết.</li>}
        </ol>
      )}
    </TextFrame>
  );
}

function Unsupported({ a, api, title, why }: { a: ArtifactView; api: Api; title: string; why: string }) {
  return (
    <EmptyState
      icon={<FileXIcon />}
      title={title}
      className="max-w-md"
      action={
        <div className="flex items-center gap-2">
          <DownloadLink a={a} />
          <FolderButton path={a.path} id={a.id} api={api} />
        </div>
      }
    >
      <p>{why}</p>
    </EmptyState>
  );
}

function Note({ title, children }: { title: string; children: string }) {
  return (
    <EmptyState icon={<FileIcon />} title={title} className="max-w-md">
      <p>{children}</p>
    </EmptyState>
  );
}

function Empty() {
  return (
    <EmptyState icon={<InboxIcon />} title="Chưa có kết quả nào" className="max-w-md">
      <p>Phòng làm xong một báo cáo, PDF, ảnh, video, nhạc hay file Office thì đăng nó lên đây; HQ giữ đường dẫn, file vẫn nằm trên máy.</p>
      <code className="mt-2 block rounded-md bg-muted px-2 py-1.5 text-left font-mono text-xs break-all text-foreground">
        node &lt;skill hq-control&gt;/scripts/hq.mjs artifact add &lt;file&gt; --title &quot;…&quot;
      </code>
    </EmptyState>
  );
}

function ListSkeleton() {
  return (
    <ul aria-label="Đang tải kết quả" className="divide-y">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="space-y-1.5 px-6 py-3">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </li>
      ))}
    </ul>
  );
}
