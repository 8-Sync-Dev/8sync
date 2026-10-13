"use client";

import { useEffect, useRef, useState } from "react";
import { HANDOFF_MS, handoffLabel, type FloorHandoff } from "@/lib/floor";
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

/**
 * Small "→ B" / "← A" bubble over a desk for HANDOFF_MS after the event.
 * Reduced motion: same text, no entrance animation.
 */
export function HandoffBubble({ handoff, peerLabel }: { handoff?: FloorHandoff | null; peerLabel?: string }) {
  const [expired, setExpired] = useState<number | null>(null);
  const ts = handoff?.ts;
  useEffect(() => {
    if (ts == null) return;
    const t = setTimeout(() => setExpired(ts), Math.max(0, ts + HANDOFF_MS - Date.now()));
    return () => clearTimeout(t);
  }, [ts]);
  if (!handoff || expired === handoff.ts) return null;
  const text = handoffLabel(handoff, peerLabel);
  return (
    <span
      role="status"
      aria-label={handoff.dir === "out" ? `Giao việc cho ${peerLabel ?? handoff.peer}` : `Nhận việc từ ${peerLabel ?? handoff.peer}`}
      className="pointer-events-none inline-flex max-w-32 items-center truncate rounded-full border bg-background px-2 py-0.5 font-mono text-[11px] shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
    >
      {text}
    </span>
  );
}
