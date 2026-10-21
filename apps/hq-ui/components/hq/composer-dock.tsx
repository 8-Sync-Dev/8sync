"use client";

import { SendIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useNarrow } from "@/hooks/use-narrow";
import { cn } from "@/lib/utils";

/** sessionStorage: whether this dock's sheet was open, per tab (a reload on the phone lands where it was). */
const KEY = (id: string) => `hq-dock:${id}`;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/**
 * The height the on-screen keyboard takes from the bottom of the layout viewport (iOS keeps
 * `position: fixed` under it); 0 on desktop and while the keyboard is closed.
 */
function useKeyboardInset(active: boolean) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const read = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
      setInset(0);
    };
  }, [active]);
  return inset;
}

/**
 * A composer that, on a phone (< sm), folds into a floating send button at the bottom right and
 * opens as a bottom sheet (the textarea gets focus; a send or a tap outside closes it). From `sm`
 * up the children render in place, unchanged.
 */
export function ComposerDock({ id, draft, label, children }: { id: string; draft: boolean; label: string; children: (ctx: { close: () => void }) => ReactNode }) {
  const narrow = useNarrow();
  // The server render has no sessionStorage: it starts closed, and the tab's own value lands after hydration.
  const open = useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(KEY(id)) === "1",
    () => false,
  );
  const box = useRef<HTMLDivElement>(null);
  const inset = useKeyboardInset(narrow && open);
  const set = useCallback(
    (o: boolean) => {
      sessionStorage.setItem(KEY(id), o ? "1" : "0");
      for (const l of listeners) l();
    },
    [id],
  );
  const close = useCallback(() => set(false), [set]);
  if (!narrow) return <>{children({ close: () => {} })}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => set(true)}
        aria-label={draft ? `${label} (đang soạn dở)` : label}
        aria-expanded={open}
        className={cn(
          "fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none transition-[transform,opacity] duration-150 ease-out hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-95 motion-reduce:transition-none",
          open && "pointer-events-none scale-90 opacity-0",
        )}
      >
        <SendIcon className="size-6" aria-hidden />
        {draft && <span aria-hidden className="absolute top-1 right-1 size-3 rounded-full bg-st-needs ring-2 ring-background" />}
      </button>
      <Sheet open={open} onOpenChange={set}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          style={inset ? { bottom: inset } : undefined}
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl bg-background p-0 pb-[env(safe-area-inset-bottom)]"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            box.current?.querySelector("textarea")?.focus();
          }}
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="sr-only">{label}</SheetTitle>
          <div ref={box}>{children({ close })}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
