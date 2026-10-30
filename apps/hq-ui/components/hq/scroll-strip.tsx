"use client";

import { useEffect, type RefObject } from "react";

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
