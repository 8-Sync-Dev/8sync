"use client";

// A file path in a room reply opens in HQ (owner 2026-11-06: "có path file mà sao không open xem được"):
// an inline-code span that is an absolute file path (lib/file-path.ts) becomes a button, and the file shows
// in a right sheet with the "Thư mục" viewer (files-sheet.tsx FileViewer: its folder as root, so the server
// opens it only inside a project HQ knows and refuses secrets, with its reason shown). Owner views only:
// without PathOpenProvider the span stays plain code, so nothing here reaches the guest app.
import { FileSearchIcon } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { ExtraProps } from "streamdown";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { baseName } from "@/lib/artifacts";
import { absFilePath, splitFilePath } from "@/lib/file-path";
import { cn } from "@/lib/utils";
import { DISCARD, FileViewer } from "./files-sheet";
import { joinPath } from "./folder-button";
import { makeApi } from "./use-hq";

const PathOpenCtx = createContext<((path: string) => void) | null>(null);

/** Gives the room's replies a path viewer (the sheet) that PathCode spans open. */
export function PathOpenProvider({ token, children }: { token: string; children: ReactNode }) {
  const api = useMemo(() => makeApi(token), [token]);
  const dirtyRef = useRef(false);
  const [open, setOpen] = useState(false);
  /** Kept after closing so the sheet slides out with its content; `nonce` reloads a path clicked again. */
  const [at, setAt] = useState<{ root: string; rel: string; nonce: number } | null>(null);
  const openPath = useCallback((path: string) => {
    if (dirtyRef.current && !window.confirm(DISCARD)) return;
    dirtyRef.current = false;
    const { dir, name } = splitFilePath(path);
    setAt((a) => ({ root: dir, rel: name, nonce: (a?.nonce ?? 0) + 1 }));
    setOpen(true);
  }, []);
  const change = (o: boolean) => {
    if (!o && dirtyRef.current && !window.confirm(DISCARD)) return;
    if (!o) dirtyRef.current = false;
    setOpen(o);
  };
  const openRel = useCallback((rel: string) => setAt((a) => a && { ...a, rel, nonce: a.nonce + 1 }), []);
  const full = at ? joinPath(at.root, at.rel) : "";
  return (
    <PathOpenCtx.Provider value={openPath}>
      {children}
      <Sheet open={open} onOpenChange={change}>
        <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[44rem] motion-reduce:animate-none">
          <SheetHeader className="border-b px-4 py-3 pr-12">
            <SheetTitle className="truncate text-base">{at ? baseName(at.rel) : "File"}</SheetTitle>
            <SheetDescription className="font-mono text-[11px] wrap-anywhere">{full}</SheetDescription>
          </SheetHeader>
          {at && (
            <div className="min-h-0 flex-1">
              <FileViewer key={`${at.root}\n${at.rel}`} root={at.root} rel={at.rel} api={api} token={token} nonce={at.nonce} dirtyRef={dirtyRef} onOpen={openRel} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PathOpenCtx.Provider>
  );
}

/** The text of a code span, when it is only text. */
function codeText(children: ReactNode): string | null {
  if (typeof children === "string") return children;
  return Array.isArray(children) && children.every((c) => typeof c === "string") ? children.join("") : null;
}

/** Streamdown's inline code, as a button that opens the file when the span is an absolute file path. */
function PathCode({ children, className }: ComponentProps<"code"> & ExtraProps) {
  const openPath = useContext(PathOpenCtx);
  const text = openPath ? codeText(children) : null;
  const path = text ? absFilePath(text) : null;
  // Streamdown's own inline-code look, so a path and other code read the same.
  const look = cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className);
  if (!openPath || !path)
    return (
      <code className={look} data-streamdown="inline-code">
        {children}
      </code>
    );
  return (
    <button
      type="button"
      onClick={() => openPath(path)}
      aria-haspopup="dialog"
      title={`Mở xem: ${path}`}
      // Phone: the hit area grows to ≥ 40px through a pseudo-element, so the line does not move.
      className="group relative inline rounded text-left align-baseline outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:-inset-y-2.5 max-sm:after:content-['']"
    >
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

/** `components` for a MessageResponse whose inline-code file paths open in the viewer (stable: Streamdown memoizes on it). */
export const pathComponents = { inlineCode: PathCode };
