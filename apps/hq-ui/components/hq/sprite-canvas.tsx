"use client";

import { useEffect, useRef } from "react";
import type { SeatKey } from "@/lib/office";
import type { Clip } from "@/lib/sprite/frames";
import { cn } from "@/lib/utils";
import { mountSprite, mountWalker, type SpriteHandle } from "@/lib/sprite/render";

/** Decorative pixel character; the state is always also written as text next to it. */
export function SpriteCanvas({
  state,
  role = null,
  shirt,
  seed,
  size = 96,
  className,
}: {
  state: Clip;
  role?: SeatKey | null;
  shirt: string;
  /** Stable per sprite (e.g. room:seat): offsets its loop phase and blinks. */
  seed: string;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<SpriteHandle | null>(null);
  const first = useRef(state);

  useEffect(() => {
    if (!ref.current) return;
    handle.current = mountSprite(ref.current, { state: first.current, role, shirt, seed, size });
    return () => handle.current?.dispose();
  }, [role, shirt, seed, size]);

  useEffect(() => {
    handle.current?.setState(state);
  }, [state]);

  return <canvas ref={ref} aria-hidden className={className ?? "block"} />;
}

const WALK_ANIM = {
  in: "motion-safe:animate-[hq-walk-in_1.6s_cubic-bezier(0.22,1,0.36,1)_both]",
  out: "motion-safe:animate-[hq-walk-out_1.6s_cubic-bezier(0.22,1,0.36,1)_both]",
  back: "motion-safe:animate-[hq-walk-back_1.6s_cubic-bezier(0.22,1,0.36,1)_both]",
} as const;

/**
 * A specialist walking in from another room (shared rAF loop; reduced motion: stands).
 * `carry`: holding a task paper, i.e. bringing work into the room. `anim` "out" leaves to the
 * right (facing right), "back" returns from the right (`dir` "left": mirrored frames).
 */
export function WalkerCanvas({
  shirt,
  ts,
  carry = false,
  anim = "in",
  dir = "right",
}: {
  shirt: string;
  ts: number;
  carry?: boolean;
  anim?: keyof typeof WALK_ANIM;
  dir?: "right" | "left";
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? mountWalker(ref.current, { shirt, carry, dir }) : undefined), [shirt, ts, carry, dir]);
  return <canvas key={`${ts}-${anim}`} ref={ref} aria-hidden className={cn("block", WALK_ANIM[anim])} />;
}
