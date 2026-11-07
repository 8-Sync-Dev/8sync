"use client";

import type { BotStatus } from "@/lib/bots";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";

/**
 * A group's face: its emoji when it has one, else up to three member faces stacked (each ringed in the
 * page colour so the overlap reads) and "+N" for the rest. `faces` are member bot keys with their state;
 * a member whose room ended comes as idle.
 */
export function GroupAvatar({ emoji, faces, size = 44, className }: { emoji?: string | null; faces: { key: string; status: BotStatus }[]; size?: number; className?: string }) {
  if (emoji) {
    return (
      <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full bg-muted", className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>
        {emoji}
      </span>
    );
  }
  const shown = faces.slice(0, faces.length > 3 ? 2 : 3);
  const rest = faces.length - shown.length;
  const face = Math.round(size * 0.6);
  return (
    <span aria-hidden className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      {[...shown.map((f) => ({ ...f, more: 0 })), ...(rest > 0 ? [{ key: "", status: "idle" as const, more: rest }] : [])].map((f, i, all) => {
        // Corners of the square: one face sits centred, two go diagonal, three make a triangle.
        const pos = all.length === 1 ? { left: (size - face) / 2, top: (size - face) / 2 } : all.length === 2 ? [{ left: 0, top: 0 }, { left: size - face, top: size - face }][i] : [{ left: (size - face) / 2, top: 0 }, { left: 0, top: size - face }, { left: size - face, top: size - face }][i];
        return (
          <span key={f.key || "more"} className="absolute rounded-full ring-2 ring-background" style={{ ...pos, width: face, height: face }}>
            {f.more ? (
              <span className="grid size-full place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground tabular">+{f.more}</span>
            ) : (
              <BotAvatar id={f.key} status={f.status} size={face} />
            )}
          </span>
        );
      })}
    </span>
  );
}
