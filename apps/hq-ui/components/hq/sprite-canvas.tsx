"use client";

import { useEffect, useRef } from "react";
import type { SpriteState } from "@/lib/sprite/frames";
import { mountSprite, type SpriteHandle } from "@/lib/sprite/render";

/** Decorative pixel character; the state is always also written as text next to it. */
export function SpriteCanvas({ state, shirtKey, size = 96 }: { state: SpriteState; shirtKey: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<SpriteHandle | null>(null);
  const first = useRef(state);

  useEffect(() => {
    if (!ref.current) return;
    handle.current = mountSprite(ref.current, { state: first.current, shirtKey, size });
    return () => handle.current?.dispose();
  }, [shirtKey, size]);

  useEffect(() => {
    handle.current?.setState(state);
  }, [state]);

  return <canvas ref={ref} aria-hidden className="block" />;
}
