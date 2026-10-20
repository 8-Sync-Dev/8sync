"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * A horizontal scroller with more content than fits: fades the edge that still has more (`.hq-fade-x`
 * in globals.css reads `data-fade-start` / `data-fade-end`). Attributes are set on the node, no re-render.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      el.toggleAttribute("data-fade-start", start);
      el.toggleAttribute("data-fade-end", end);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [ref]);
}

const smooth = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/** The `[data-lane]` child of `scroller` whose left edge is nearest the scroll position. */
function nearest(scroller: HTMLElement): number {
  const lanes = [...scroller.querySelectorAll<HTMLElement>("[data-lane]")];
  const pad = parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0;
  let best = 0;
  lanes.forEach((l, i) => {
    if (Math.abs(l.offsetLeft - pad - scroller.scrollLeft) < Math.abs(lanes[best].offsetLeft - pad - scroller.scrollLeft)) best = i;
  });
  // Scrolled to the end: the last lanes never reach the left edge, the last one is the one in view.
  return scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2 && lanes.length ? lanes.length - 1 : best;
}

export type StripItem = { key: string; label: string; count: number | null; style?: CSSProperties };

/**
 * Phones: the board shows one lane at a time (snap carousel). This strip names every lane with its
 * count, marks the one in view, and jumps to a lane on tap. The lanes are the `[data-lane]` children
 * of `scroller` (positioned, so `offsetLeft` is measured from it).
 */
export function LaneStrip({ scroller, items, label, className }: { scroller: RefObject<HTMLElement | null>; items: StripItem[]; label: string; className?: string }) {
  const strip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEdgeFade(strip);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(nearest(el)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [scroller]);

  // Keep the chip of the lane in view visible inside the strip (scrollTo, not scrollIntoView: that would scroll the page too).
  useEffect(() => {
    const s = strip.current;
    const chip = s?.children[active] as HTMLElement | undefined;
    if (!s || !chip) return;
    if (chip.offsetLeft < s.scrollLeft || chip.offsetLeft + chip.offsetWidth > s.scrollLeft + s.clientWidth) {
      s.scrollTo({ left: chip.offsetLeft - 16, behavior: smooth() });
    }
  }, [active]);

  const go = (i: number) => {
    const el = scroller.current;
    const lane = el?.querySelectorAll<HTMLElement>("[data-lane]")[i];
    if (!el || !lane) return;
    const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    el.scrollTo({ left: lane.offsetLeft - pad, behavior: smooth() });
    setActive(i);
  };

  return (
    <div ref={strip} role="group" aria-label={label} className={cn("hq-fade-x relative flex shrink-0 gap-1 overflow-x-auto px-4 py-1.5 [scrollbar-width:none]", className)}>
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          style={it.style}
          aria-current={i === active ? "true" : undefined}
          onClick={() => go(i)}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs whitespace-nowrap text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
            i === active ? "bg-secondary font-semibold text-foreground" : "hover:bg-muted hover:text-foreground",
          )}
        >
          {it.style && <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--tone)" />}
          {it.label}
          {it.count != null && <span className="tabular text-muted-foreground">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}
