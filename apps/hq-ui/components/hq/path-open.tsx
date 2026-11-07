"use client";

// A file a room reply names opens in HQ, on a phone too (owner 2026-11-06: "có path file mà sao không open
// xem được"; 2026-11-07: "Chưa xem được video path file linh hoạt"): an inline-code path (absolute, or
// relative to the room's folder), a markdown link to a local file, and the "File nhắc tới" chips under a
// result open a right sheet with the "Thư mục" viewer (files-sheet.tsx FileViewer: video/audio stream with
// seeking, images, PDF, text, markdown; anything else "Tải về"). Where the file is comes from the server
// (POST /api/files/locate: the room's folder, then its repo root, then the path as written), which finds
// only files inside a project HQ knows and never secrets, and says why not otherwise. Owner views only:
// without PathOpenProvider a path stays plain code, so nothing here reaches the guest app.
import { FileAudioIcon, FileCodeIcon, FileIcon, FileImageIcon, FileSearchIcon, FileTextIcon, FileVideoIcon, FileXIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { defaultComponents, defaultRemarkPlugins, type ExtraProps, type Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { baseName, fileType } from "@/lib/artifacts";
import { absFilePath, fileLinkPath, relFilePath, remarkFileLinks } from "@/lib/file-path";
import { FILES_LOCATE_MAX, type FileKind, type FileSpot, type FileSpots } from "@/lib/files";
import { cn } from "@/lib/utils";
import { DISCARD, FileViewer, Note } from "./files-sheet";
import { joinPath } from "./folder-button";
import { makeApi, type Api } from "./use-hq";

/** A file to show: as named in the reply (`path`), with its place when the server already located it. */
type Target = { path: string; root?: string; rel?: string };
type Ctx = { open: (t: Target) => void; base: string | null; api: Api };
const PathOpenCtx = createContext<Ctx | null>(null);

const LOCATE = "/api/files/locate";

type At = { path: string; nonce: number } & ({ state: "finding" } | { state: "found"; root: string; rel: string } | { state: "failed"; error: string });

/**
 * Gives the room's replies a file viewer (the sheet) that paths, file links and chips open. `base`: the
 * room's folder, what a relative path or a bare name in its replies is relative to.
 */
export function PathOpenProvider({ token, base = null, children }: { token: string; base?: string | null; children: ReactNode }) {
  const api = useMemo(() => makeApi(token), [token]);
  const dirtyRef = useRef(false);
  const [open, setOpen] = useState(false);
  /** Kept after closing so the sheet slides out with its content; `nonce` reloads a path opened again. */
  const [at, setAt] = useState<At | null>(null);
  const openTarget = useCallback((t: Target) => {
    if (dirtyRef.current && !window.confirm(DISCARD)) return;
    dirtyRef.current = false;
    setAt((a) => {
      const nonce = (a?.nonce ?? 0) + 1;
      return t.root && t.rel ? { path: t.path, nonce, state: "found", root: t.root, rel: t.rel } : { path: t.path, nonce, state: "finding" };
    });
    setOpen(true);
  }, []);
  // Not located yet (a path in the text, or a chip whose lookup failed: the file may be there by now).
  const findPath = at?.state === "finding" ? at.path : null;
  const findNonce = at?.nonce ?? 0;
  useEffect(() => {
    if (findPath === null) return;
    const ac = new AbortController();
    const settle = (next: (a: At) => At) => setAt((a) => (a && a.nonce === findNonce && a.state === "finding" ? next(a) : a));
    api<FileSpots>(LOCATE, { method: "POST", body: { base, paths: [findPath] }, signal: ac.signal })
      .then(({ files: [s] }) => settle((a) => (s?.ok ? { ...a, state: "found", root: s.root, rel: s.rel } : { ...a, state: "failed", error: s?.error ?? "không thấy file" })))
      .catch((e: Error) => {
        if (!ac.signal.aborted) settle((a) => ({ ...a, state: "failed", error: e.message }));
      });
    return () => ac.abort();
  }, [api, base, findPath, findNonce]);
  const change = (o: boolean) => {
    if (!o && dirtyRef.current && !window.confirm(DISCARD)) return;
    if (!o) dirtyRef.current = false;
    setOpen(o);
  };
  const openRel = useCallback((rel: string) => setAt((a) => (a?.state === "found" ? { ...a, rel, nonce: a.nonce + 1 } : a)), []);
  const value = useMemo<Ctx>(() => ({ open: openTarget, base, api }), [openTarget, base, api]);
  const full = at?.state === "found" ? joinPath(at.root, at.rel) : (at?.path ?? "");
  return (
    <PathOpenCtx.Provider value={value}>
      {children}
      <Sheet open={open} onOpenChange={change}>
        <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[44rem] motion-reduce:animate-none">
          <SheetHeader className="border-b px-4 py-3 pr-12">
            <SheetTitle className="truncate text-base">{at ? baseName(at.state === "found" ? at.rel : at.path) : "File"}</SheetTitle>
            <SheetDescription className="font-mono text-[11px] wrap-anywhere">{full}</SheetDescription>
          </SheetHeader>
          {at && (
            <div className="min-h-0 flex-1">
              {at.state === "found" ? (
                <FileViewer key={`${at.root}\n${at.rel}`} root={at.root} rel={at.rel} api={api} token={token} nonce={at.nonce} dirtyRef={dirtyRef} onOpen={openRel} />
              ) : at.state === "finding" ? (
                <div className="p-3" aria-busy="true" aria-label="Đang tìm file">
                  <Skeleton className="h-[min(60dvh,30rem)] w-full rounded-lg" />
                </div>
              ) : (
                <div className="p-3">
                  <Note title="Không mở được file" tone="error">
                    {at.error}
                  </Note>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PathOpenCtx.Provider>
  );
}

/** The icon of a file kind: video, image, audio, a document, a page, or a plain file. */
function KindIcon({ kind, className }: { kind: FileKind | null; className?: string }) {
  const I =
    kind === "video"
      ? FileVideoIcon
      : kind === "image"
        ? FileImageIcon
        : kind === "audio"
          ? FileAudioIcon
          : kind === "html"
            ? FileCodeIcon
            : kind === "pdf" || kind === "office" || kind === "markdown" || kind === "text"
              ? FileTextIcon
              : FileIcon;
  return <I aria-hidden className={className} />;
}

/**
 * Where each path is, asked once per room folder (POST /api/files/locate, FILES_LOCATE_MAX at a time). A
 * path not found is asked again when `refresh` changes (the room wrote more: the file may be there now);
 * one found or refused (403) is settled. Empty without PathOpenProvider.
 */
export function useFileSpots(paths: readonly string[], refresh: string | number = 0): ReadonlyMap<string, FileSpot> {
  const ctx = useContext(PathOpenCtx);
  const api = ctx?.api ?? null;
  const base = ctx?.base ?? null;
  const [got, setGot] = useState<{ base: string | null; spots: ReadonlyMap<string, FileSpot> }>({ base: null, spots: new Map() });
  /** Paths found or refused under this base: never asked again. */
  const found = useRef<{ base: string | null; set: Set<string> }>({ base: null, set: new Set() });
  const key = [...new Set(paths)].join("\n");
  useEffect(() => {
    if (!api || !key) return;
    if (found.current.base !== base) found.current = { base, set: new Set() };
    const known = found.current.set;
    const want = key.split("\n").filter((p) => !known.has(p));
    if (!want.length) return;
    const ac = new AbortController();
    (async () => {
      const spots: FileSpot[] = [];
      for (let i = 0; i < want.length; i += FILES_LOCATE_MAX) {
        const r = await api<FileSpots>(LOCATE, { method: "POST", body: { base, paths: want.slice(i, i + FILES_LOCATE_MAX) }, signal: ac.signal });
        spots.push(...r.files);
      }
      for (const s of spots) if (s.ok || s.status === 403) known.add(s.path);
      setGot((g) => ({ base, spots: new Map([...(g.base === base ? g.spots : []), ...spots.map((s) => [s.path, s] as const)]) }));
    })().catch(() => {
      // Chips stay as they were; a tap still looks the file up and says why it cannot open.
    });
    return () => ac.abort();
  }, [api, base, key, refresh]);
  return got.base === base ? got.spots : EMPTY;
}

const EMPTY: ReadonlyMap<string, FileSpot> = new Map();

/**
 * "File nhắc tới": a chip per file a result names (`paths`), its icon from the file's type, a tap opens it
 * in the viewer. A file that is missing or refused says so on the chip. `bare` (names without a folder)
 * show only once found under the room's folder, and not twice for a file a path chip already shows.
 */
export function FileChips({ paths, bare, spots }: { paths: readonly string[]; bare: readonly string[]; spots: ReadonlyMap<string, FileSpot> }) {
  const ctx = useContext(PathOpenCtx);
  if (!ctx) return null;
  const at = (s: FileSpot | undefined) => (s?.ok ? `${s.root}\n${s.rel}`.toLowerCase() : null);
  const shown = new Set(paths.map((p) => at(spots.get(p))).filter(Boolean));
  const extra = bare.filter((b) => {
    const k = at(spots.get(b));
    if (!k || shown.has(k)) return false;
    shown.add(k);
    return true;
  });
  const all = [...paths, ...extra];
  if (!all.length) return null;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="mr-0.5">File nhắc tới:</span>
      {all.map((p) => (
        <FileChip key={p} path={p} spot={spots.get(p)} open={ctx.open} />
      ))}
    </div>
  );
}

function FileChip({ path, spot, open }: { path: string; spot: FileSpot | undefined; open: Ctx["open"] }) {
  const failed = spot && !spot.ok ? spot : null;
  const name = baseName(path);
  const kind = spot?.ok ? spot.kind : (fileType(path)?.kind ?? null);
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={() => open(spot?.ok ? { path, root: spot.root, rel: spot.rel } : { path })}
      aria-haspopup="dialog"
      aria-label={failed ? `${name}: ${failed.error}` : `Mở xem ${name}`}
      title={failed ? `${failed.error}: ${path}` : `Mở xem: ${path}`}
      className={cn("max-w-full min-w-0 font-mono font-normal max-sm:h-11 max-sm:px-3 pointer-coarse:h-11 pointer-coarse:px-3", failed && "border-dashed text-muted-foreground")}
    >
      {failed ? <FileXIcon aria-hidden className="text-destructive" /> : <KindIcon kind={kind} />}
      <span className="min-w-0 truncate sm:max-w-56">{name}</span>
      {/* Short state on the chip; the sheet says the whole reason. */}
      {failed && <span className="shrink-0 font-sans text-destructive">· {failed.status === 404 ? "không thấy" : failed.status === 403 ? "bị chặn" : "không mở được"}</span>}
    </Button>
  );
}

/** The text of a code span, when it is only text. */
function codeText(children: ReactNode): string | null {
  if (typeof children === "string") return children;
  return Array.isArray(children) && children.every((c) => typeof c === "string") ? children.join("") : null;
}

/** Phone: the hit area grows to ≥ 44px through a pseudo-element, so the line does not move. */
const INLINE_HIT =
  "group relative inline rounded text-left align-baseline outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:-inset-y-3 max-sm:after:content-['']";

/**
 * Streamdown's inline code, as a button that opens the file when the span is a file path: absolute, or
 * relative to the room's folder (with a folder in it, so a bare `a.ts` stays code).
 */
function PathCode({ children, className }: ComponentProps<"code"> & ExtraProps) {
  const ctx = useContext(PathOpenCtx);
  const text = ctx ? codeText(children) : null;
  const path = text ? (absFilePath(text) ?? (ctx?.base ? relFilePath(text) : null)) : null;
  // Streamdown's own inline-code look, so a path and other code read the same.
  const look = cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className);
  if (!ctx || !path)
    return (
      <code className={look} data-streamdown="inline-code">
        {children}
      </code>
    );
  return (
    <button type="button" onClick={() => ctx.open({ path })} aria-haspopup="dialog" title={`Mở xem: ${path}`} className={INLINE_HIT}>
      <code
        className={cn(look, "wrap-anywhere text-primary underline decoration-primary/40 underline-offset-2 transition-colors group-hover:bg-primary/10 group-hover:decoration-primary motion-reduce:transition-none")}
        data-streamdown="inline-code"
      >
        {/* Before the path: after it, a wrapped path leaves the icon alone on the last line. */}
        <FileSearchIcon aria-hidden className="mr-1 inline size-3.5 align-[-0.15em]" />
        {children}
      </code>
    </button>
  );
}

const DefaultLink = defaultComponents.a;

/**
 * A link in a reply: one to a local file (remarkFileLinks rewrote it to FILE_LINK) opens it in the viewer,
 * its icon from the file's type; any other link is Streamdown's own.
 */
function PathLink(props: ComponentProps<"a"> & ExtraProps) {
  const ctx = useContext(PathOpenCtx);
  const file = fileLinkPath(props.href);
  if (!file) return <DefaultLink {...props} />;
  if (!ctx) return <span title={file}>{props.children}</span>;
  return (
    <button
      type="button"
      onClick={() => ctx.open({ path: file })}
      aria-haspopup="dialog"
      title={`Mở xem: ${file}`}
      className={cn(INLINE_HIT, "font-medium text-primary underline decoration-primary/40 underline-offset-2 wrap-anywhere hover:decoration-primary")}
    >
      <KindIcon kind={fileType(file)?.kind ?? null} className="mr-1 inline size-3.5 align-[-0.15em]" />
      {props.children}
    </button>
  );
}

type MdProps = ComponentProps<typeof Streamdown>;

/**
 * Props for a MessageResponse whose file paths and file links open in the viewer (stable: Streamdown
 * memoizes on them). Spread them: `<MessageResponse {...pathMarkdown}>`.
 */
export const pathMarkdown = {
  components: { inlineCode: PathCode, a: PathLink },
  remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkFileLinks],
} satisfies Pick<MdProps, "components" | "remarkPlugins">;
