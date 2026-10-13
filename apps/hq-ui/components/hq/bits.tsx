"use client";

import { AlertTriangleIcon, CornerDownRightIcon, InfoIcon, RadioIcon, RotateCwIcon, TerminalSquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { SessionStatus } from "./types";

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: "Working",
  idle: "Idle",
  needs_input: "Needs you",
  ended: "Ended",
};

const DOT: Record<SessionStatus, string> = {
  running: "bg-st-running",
  idle: "bg-st-idle",
  needs_input: "bg-st-needs",
  ended: "bg-st-ended",
};

export function StatusDot({ status, className }: { status: SessionStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block size-2 shrink-0 rounded-full",
        DOT[status],
        status === "needs_input" && "ring-3 ring-st-needs/25",
        className,
      )}
    />
  );
}

/** Which path delivered an owner message (contract §3). */
export function DeliveryTag({ delivery }: { delivery?: string | null }) {
  if (delivery === "channel")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-via-channel">
        <RadioIcon className="size-3" aria-hidden />
        via channel
      </span>
    );
  if (delivery === "terminal")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <TerminalSquareIcon className="size-3" aria-hidden />
        via terminal
      </span>
    );
  if (delivery === "channel→terminal")
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
        title="The channel got no answer in 25 s, so the message was typed into the terminal once."
      >
        <CornerDownRightIcon className="size-3" aria-hidden />
        via terminal, channel didn&apos;t answer
      </span>
    );
  if (delivery === "unconfirmed")
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
        title="The channel received the message but nothing came back in 25 s. It was not typed again."
      >
        <RadioIcon className="size-3" aria-hidden />
        via channel, no answer yet
      </span>
    );
  if (delivery === "held")
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-destructive"
        title="A dialog was open in the terminal, so the message was not typed. Answer it, then resend."
      >
        <AlertTriangleIcon className="size-3" aria-hidden />
        held, session was waiting
      </span>
    );
  if (delivery === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
        <AlertTriangleIcon className="size-3" aria-hidden />
        not delivered
      </span>
    );
  return null;
}

/** A session_reply that came from the Stop hook rather than the channel's reply tool. */
export function ReplySource({ delivery }: { delivery?: string | null }) {
  if (delivery !== "terminal") return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <TerminalSquareIcon className="size-3" aria-hidden />
      from terminal
    </span>
  );
}

/**
 * Calm, informational: nothing is broken for the owner, delivery just takes the
 * terminal path. Not an alert, so it is not announced on every refresh.
 */
export function ChannelNotice({ state, className }: { state: "blocked-by-org" | "unresponsive" | null; className?: string }) {
  if (!state) return null;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg bg-muted/70 px-3 py-2 text-[13px] leading-snug", className)}>
      <InfoIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {state === "blocked-by-org" ? (
        <p className="text-pretty">
          <span className="font-medium">Channels are off for your Claude org</span>
          <span className="text-muted-foreground">
            {" "}
            — messages are typed into the terminal. An org Owner can enable Channels in claude.ai → Org settings →
            Claude Code.
          </span>
        </p>
      ) : (
        <p className="text-pretty">
          <span className="font-medium">The channel stopped answering</span>
          <span className="text-muted-foreground">: messages are typed into the terminal until it replies again.</span>
        </p>
      )}
    </div>
  );
}

/** Claude Code has a dialog open in the pane that only the owner can answer. */
export function WaitingBadge({ what, compact, className }: { what: string; compact?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-st-needs/15 px-1.5 py-px text-[11px] font-medium text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs",
        className,
      )}
      title={`Claude is waiting for you: ${what}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-st-needs" />
      {compact ? (
        <>
          waiting<span className="sr-only">: Claude is waiting for you ({what})</span>
        </>
      ) : (
        <>Claude is waiting for you</>
      )}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      {icon && <div className="mb-1 text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <div className="text-sm text-pretty text-muted-foreground">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry, what }: { error: string; onRetry?: () => void; what: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
    >
      <AlertTriangleIcon className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1">
        Could not load {what}: <span className="text-muted-foreground">{error}</span>
      </span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCwIcon /> Retry
        </Button>
      )}
    </div>
  );
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function ago(ts: number | null, now = Date.now()): string {
  if (!ts) return "unknown";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** "hq-api" → "api" for display; uuids are shortened. */
export function shortName(name: string | null | undefined): string {
  if (!name) return "unknown";
  if (name === "owner") return "you";
  if (name.startsWith("hq-")) return name.slice(3);
  // Never show a full uuid as primary text.
  return /^[0-9a-f-]{20,}$/i.test(name) ? name.slice(0, 8) : name;
}
