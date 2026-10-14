"use client";

import { GraduationCapIcon, HammerIcon, HistoryIcon, MessageCircleQuestionIcon, MoonIcon } from "lucide-react";
import { idleView, isStale, type IdleIcon, type IdleRecord } from "@/lib/idle";
import { fmtDuration } from "@/lib/office";
import { cn } from "@/lib/utils";

const ICON: Record<IdleIcon, typeof HammerIcon> = {
  working: HammerIcon,
  recall: HistoryIcon,
  learn: GraduationCapIcon,
  ask: MessageCircleQuestionIcon,
  rest: MoonIcon,
};

/*
 * One agent-team member: icon + name + state text (never colour alone). `scene` sits on the
 * fixed dark room floor (office-view SCENE inks); `plain` follows the app theme.
 * Resting members stay visible on purpose: the owner wants to see who is free.
 */
export function IdleChip({ r, now, variant = "scene" }: { r: IdleRecord; now: number; variant?: "scene" | "plain" }) {
  const v = idleView(r);
  const Icon = ICON[v.icon];
  const stale = isStale(r, now);
  const since = fmtDuration(Math.max(0, now - r.ts * 1000));
  const tone =
    variant === "scene"
      ? { running: "text-[oklch(0.8_0.14_155)]", needs: "text-[oklch(0.84_0.14_75)]", idle: "text-(--soft)" }[v.tone]
      : { running: "text-st-running", needs: "text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs", idle: "text-muted-foreground" }[v.tone];
  return (
    <li
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] leading-tight",
        variant === "scene" ? "bg-white/8 text-(--ink)" : "border bg-card",
        r.state === "rest" && "opacity-85",
      )}
      title={`${r.name} (${r.team}): ${r.detail || v.label} · ${since} trước`}
    >
      <Icon aria-hidden className={cn("size-3.5 shrink-0", tone)} />
      <span className="shrink-0 font-semibold">{r.name}</span>
      <span className={cn("min-w-0 truncate", variant === "scene" ? "text-(--soft)" : "text-muted-foreground")}>
        {v.label}
        {r.state === "rest" && !stale && <span className="tabular"> · {since}</span>}
      </span>
    </li>
  );
}
