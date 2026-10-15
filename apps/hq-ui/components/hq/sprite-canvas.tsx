"use client";

import { useEffect, useRef } from "react";
import type { SeatKey } from "@/lib/office";
import type { Clip } from "@/lib/sprite/frames";
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

/**
 * A specialist walking in from another room (shared rAF loop; reduced motion: stands).
 * `carry`: holding a task paper, i.e. bringing work into the room.
 */
export function WalkerCanvas({ shirt, ts, carry = false }: { shirt: string; ts: number; carry?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? mountWalker(ref.current, { shirt, carry }) : undefined), [shirt, ts, carry]);
  return (
    <canvas
      key={ts}
      ref={ref}
      aria-hidden
      className="block motion-safe:animate-[hq-walk-in_1.6s_cubic-bezier(0.22,1,0.36,1)_both]"
    />
  );
}
