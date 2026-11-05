"use client";

import { MessageSquareQuoteIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { quoteForAsk } from "@/lib/ask-quote";
import { askAbout } from "@/lib/ask-store";
import { cn } from "@/lib/utils";

type Pop = { x: number; y: number; below: boolean; text: string; ref: string | null };

/**
 * Select text inside `children` and a small "Hỏi về đoạn này" button floats by the selection; it puts the
 * selection as a quote (with where it came from: the nearest `data-ask-ref`, else `fallbackRef`) into the
 * room's composer (lib/ask-store) and calls `onAsked` (the Kết quả tab opens that room). Tab moves to the
 * button after a keyboard selection; Esc, a scroll or a click elsewhere hides it. `disabledReason`: there
 * is no room to ask, said on the button instead of acting.
 */
export function SelectionAsk({
  children,
  fallbackRef = null,
  disabledReason = null,
  onAsked,
  className,
}: {
  children: ReactNode;
  fallbackRef?: string | null;
  disabledReason?: string | null;
  onAsked?: () => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const fallback = useRef(fallbackRef);
  useEffect(() => {
    fallback.current = fallbackRef;
  }, [fallbackRef]);

  useEffect(() => {
    let raf = 0;
    const read = () => {
      const root = box.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return setPop(null);
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return setPop(null);
      const text = sel.toString();
      if (text.trim().length < 2) return setPop(null);
      const r = range.getBoundingClientRect();
      const start = range.startContainer;
      const el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      const ref = el?.closest<HTMLElement>("[data-ask-ref]")?.dataset.askRef ?? fallback.current;
      // A phone draws its own copy menu above the selection: go under it there.
      const below = matchMedia("(pointer: coarse)").matches || r.top < 64;
      const x = Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110);
      setPop({ x, y: below ? Math.min(r.bottom + 8, window.innerHeight - 56) : r.top - 8, below, text, ref });
    };
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    const hide = () => setPop(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return hide();
      if (e.key !== "Tab" || e.shiftKey || !btn.current) return;
      const a = document.activeElement;
      if (a === btn.current) return;
      if (a === document.body || (a && box.current?.contains(a))) {
        e.preventDefault();
        btn.current.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && btn.current?.contains(e.target)) return;
      hide();
    };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", hide);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  const ask = () => {
    if (!pop || disabledReason) return;
    askAbout(quoteForAsk(pop.text, pop.ref));
    window.getSelection()?.removeAllRanges();
    setPop(null);
    onAsked?.();
  };

  return (
    <div ref={box} className={className}>
      {children}
      {pop &&
        createPortal(
          <div
            role="toolbar"
            aria-label="Đoạn đang chọn"
            style={{ left: pop.x, top: pop.y }}
            className={cn("fixed z-50 -translate-x-1/2", !pop.below && "-translate-y-full")}
          >
            <button
              ref={btn}
              type="button"
              // Keep the selection: a mousedown on a button would clear it before the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={ask}
              aria-disabled={disabledReason ? true : undefined}
              title={disabledReason ?? "Chèn đoạn này vào khung nhắn của phòng để hỏi tiếp"}
              className={cn(
                "flex max-w-72 items-center gap-1.5 rounded-lg border bg-popover px-2.5 py-1.5 text-left text-xs font-medium text-popover-foreground shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-10",
                disabledReason ? "cursor-not-allowed text-muted-foreground" : "hover:bg-muted",
              )}
            >
              <MessageSquareQuoteIcon aria-hidden className="size-3.5 shrink-0" />
              <span>
                Hỏi về đoạn này
                {disabledReason && <span className="block font-normal text-pretty">{disabledReason}</span>}
              </span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
