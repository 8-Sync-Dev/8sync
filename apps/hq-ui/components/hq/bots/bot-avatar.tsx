"use client";

import type { CSSProperties } from "react";
import { BOT_STATUS_LABEL, botColors, hashId, type BotStatus } from "@/lib/bots";
import { cn } from "@/lib/utils";

const FACE = "fill-(--bot-face) dark:fill-(--bot-face-dark)";

/**
 * The head, one of four by the id's hash (other bits than the colour's), so two bots of one hue still
 * look apart (owner 2026-11-07: a roster of faces, like Grok's bots): round, rounded square, soft
 * hexagon, wide bean.
 */
function Head({ id }: { id: string }) {
  const shape = (hashId(id) >>> 9) % 4;
  if (shape === 1) return <rect x="1" y="1" width="38" height="38" rx="13" className={FACE} />;
  if (shape === 2)
    return <path d="M20 3 L35 11.5 L35 28.5 L20 37 L5 28.5 L5 11.5 Z" strokeWidth="5" strokeLinejoin="round" className={cn(FACE, "stroke-(--bot-face) dark:stroke-(--bot-face-dark)")} />;
  if (shape === 3) return <rect x="0.5" y="4" width="39" height="32" rx="16" className={FACE} />;
  return <circle cx="20" cy="20" r="20" className={FACE} />;
}

/**
 * A bot's face: a soft head in its own colour and shape (stable per id) with two oval eyes. The eyes
 * carry the state: working glances left and right, waiting looks up wide with a badge, error squints
 * shut with a red badge, idle rests half closed. Pure SVG + CSS; reduced motion stops the glance.
 */
export function BotAvatar({ id, status, size = 40, className }: { id: string; status: BotStatus; size?: number; className?: string }) {
  const c = botColors(id);
  const style = { width: size, height: size, "--bot-face": c.face, "--bot-face-dark": c.faceDark, "--bot-ink": c.ink } as CSSProperties;
  return (
    <span aria-hidden className={cn("relative inline-block shrink-0", className)} style={style}>
      <svg viewBox="0 0 40 40" className="size-full">
        <Head id={id} />
        {/* A soft light on the upper left: the head reads round, not flat. */}
        <ellipse cx="13" cy="11" rx="8" ry="5" fill="white" opacity="0.28" />
        <Eyes status={status} />
      </svg>
      {(status === "needs" || status === "error") && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 grid size-[38%] min-h-3 min-w-3 place-items-center rounded-full text-[0.55em] leading-none font-bold text-white ring-2 ring-background",
            status === "needs" ? "bg-[color-mix(in_oklch,var(--st-needs),black_18%)] motion-safe:animate-[hq-bot-call_1.6s_ease-out_infinite]" : "bg-destructive",
          )}
          style={{ fontSize: Math.max(8, Math.round(size * 0.24)) }}
        >
          !
        </span>
      )}
    </span>
  );
}

function Eyes({ status }: { status: BotStatus }) {
  const ink = "fill-(--bot-ink)";
  if (status === "error") {
    // Squeezed shut: two short arcs.
    return (
      <g className="stroke-(--bot-ink)" strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M11.5 20.5 Q14 18 16.5 20.5" />
        <path d="M23.5 20.5 Q26 18 28.5 20.5" />
      </g>
    );
  }
  if (status === "idle") {
    return (
      <g className={ink}>
        <ellipse cx="14" cy="21" rx="2.6" ry="2.1" />
        <ellipse cx="26" cy="21" rx="2.6" ry="2.1" />
      </g>
    );
  }
  if (status === "needs") {
    return (
      <g className={ink}>
        <ellipse cx="14" cy="18" rx="2.9" ry="4.4" />
        <ellipse cx="26" cy="18" rx="2.9" ry="4.4" />
        <circle cx="14.9" cy="16.4" r="1" fill="white" />
        <circle cx="26.9" cy="16.4" r="1" fill="white" />
      </g>
    );
  }
  return (
    <g className={cn(ink, "motion-safe:animate-[hq-bot-look_3.2s_cubic-bezier(0.22,1,0.36,1)_infinite]")}>
      <ellipse cx="14" cy="19.5" rx="2.6" ry="3.8" />
      <ellipse cx="26" cy="19.5" rx="2.6" ry="3.8" />
    </g>
  );
}

const PILL: Record<BotStatus, string> = {
  needs: "bg-st-needs/15 text-[color-mix(in_oklch,var(--st-needs),black_42%)] dark:text-st-needs",
  error: "bg-destructive/10 text-destructive",
  working: "bg-st-running/12 text-[color-mix(in_oklch,var(--st-running),black_12%)] dark:text-st-running",
  idle: "bg-muted text-muted-foreground",
};

/** The status as words in a tinted pill (colour only reinforces the label). */
export function StatusPill({ status, className }: { status: BotStatus; className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap", PILL[status], className)}>{BOT_STATUS_LABEL[status]}</span>;
}
