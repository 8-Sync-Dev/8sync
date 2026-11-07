import { useLayoutEffect, useRef, type RefObject } from "react";
import { flipAnchor, flipMoves, type FlipBox } from "@/lib/flip";

/** Spring-like ease-out (fast start, long soft landing), the feel of a Messenger row settling. */
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const MOVE_MS = 300;
const ENTER_MS = 240;
const PULSE_MS = 1200;
const PULSE = "color-mix(in oklch, var(--primary) 14%, transparent)";

/** The row's translateY right now (mid-animation), so a re-sort that lands during one starts from where it is. */
function shownY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0;
}

/**
 * Messenger-style re-sort for a list: after every commit the rows (direct children of `list` carrying
 * `data-flip="<stable key>"`) that moved slide from where they were on screen to their new place, new
 * rows fade in, and a row that rose past others gets a short highlight. When the reader has scrolled
 * down, the scroller (`scroller`, positioned so the rows' offsetTop is measured in it; give it
 * `overflow-anchor: none` so the browser does not adjust it too) shifts so the row they were reading
 * stays put. `prefers-reduced-motion`: the scroll fix only, nothing moves. No dependency: the Web
 * Animations API; the arithmetic is lib/flip.ts.
 */
export function useFlip(list: RefObject<HTMLElement | null>, scroller: RefObject<HTMLElement | null>): void {
  const last = useRef<{ el: HTMLElement; boxes: FlipBox[] } | null>(null);
  useLayoutEffect(() => {
    const ul = list.current;
    last.current = ul ? { el: ul, boxes: flip(ul, scroller.current, last.current?.el === ul ? last.current.boxes : null) } : null;
  });
}

/** One commit: measure the rows, hold the reader's scroll, play the moves. The boxes, for the next commit. */
function flip(ul: HTMLElement, sc: HTMLElement | null, prev: FlipBox[] | null): FlipBox[] {
  const rows = new Map<string, HTMLElement>();
  for (const c of ul.children) if (c instanceof HTMLElement && c.dataset.flip) rows.set(c.dataset.flip, c);
  const boxes: FlipBox[] = [...rows].map(([key, el]) => ({ key, top: el.offsetTop, height: el.offsetHeight }));
  if (!prev) return boxes;

  let scrolled = 0;
  if (sc && sc.scrollTop > 0) {
    const from = sc.scrollTop;
    const shift = flipAnchor(prev, boxes, from);
    if (shift) {
      sc.scrollTop = from + shift;
      scrolled = sc.scrollTop - from;
    }
  }
  const { moves, entered } = flipMoves(prev, boxes, scrolled);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return boxes;

  for (const m of moves) {
    const el = rows.get(m.key)!;
    const dy = m.dy + shownY(el);
    for (const a of el.getAnimations()) if (a.id === "flip") a.cancel();
    // A row that rose slides over the ones it passes (they shift down beneath it), lit for a moment.
    el.style.zIndex = m.rose ? "1" : "";
    const run = el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: MOVE_MS, easing: EASE, id: "flip" });
    run.onfinish = () => {
      el.style.zIndex = "";
    };
    if (m.rose) (el.firstElementChild as HTMLElement | null)?.animate([{ backgroundColor: PULSE, offset: 0 }], { duration: PULSE_MS, easing: "ease-out" });
  }
  for (const key of entered) rows.get(key)!.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: ENTER_MS, easing: EASE });
  return boxes;
}
