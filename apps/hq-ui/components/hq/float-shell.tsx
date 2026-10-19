"use client";

import { Maximize2Icon, Minimize2Icon, PowerIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// xterm touches `document`, so it loads only in the browser.
const LiveTerminal = dynamic(() => import("./live-terminal").then((m) => m.LiveTerminal), { ssr: false });

/** Below this width the panel is a bottom sheet (phone), above it a window you can drag and resize. */
const WIDE = 768;

/**
 * The owner's shell on the PC, floating over every HQ view (`8sync ccc term --shell`: 8sync's zsh with
 * autosuggestions when installed, else PowerShell / $SHELL). Opens in `cwd` (the folder in view) the
 * first time; closing keeps the shell 30 min, "Tắt shell" ends it. Toggle: header button or Ctrl+`.
 */
export function FloatShell({ token, cwd, open, onOpenChange }: { token: string; cwd: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [big, setBig] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [wide, setWide] = useState(true);
  const [gen, setGen] = useState(0);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  // The folder is fixed when the panel opens: a later scope change must not reopen the terminal.
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const m = window.matchMedia(`(min-width: ${WIDE}px)`);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onOpenChange]);

  // Adjusting state while rendering (React's documented pattern), not in an effect.
  if (open && !url) setUrl(cwd ? `/api/shell?cwd=${encodeURIComponent(cwd)}` : "/api/shell");

  const onDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!wide || big || (e.target instanceof Element && e.target.closest("button"))) return;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [wide, big]);
  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setPos({ x: Math.max(0, Math.min(window.innerWidth - 160, e.clientX - d.dx)), y: Math.max(0, Math.min(window.innerHeight - 48, e.clientY - d.dy)) });
  }, []);
  const onUp = useCallback(() => {
    drag.current = null;
  }, []);

  async function kill() {
    await fetch("/api/shell", { method: "DELETE", headers: { "x-hq-token": token } }).catch(() => {});
    setUrl(null);
    setGen((n) => n + 1);
    onOpenChange(false);
  }

  if (!open || !url) return null;
  const placed = wide && !big && pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;
  return (
    <section
      role="dialog"
      aria-label="Shell trên máy"
      className={cn(
        "fixed z-50 flex flex-col gap-2 border bg-background p-3 shadow-2xl",
        !wide
          ? "inset-x-0 bottom-0 h-[78dvh] rounded-t-xl"
          : big
            ? "inset-4 rounded-xl"
            : "right-4 bottom-4 h-[460px] w-[760px] min-h-[260px] min-w-[420px] resize overflow-hidden rounded-xl",
      )}
      style={placed}
    >
      <div className={cn("flex items-center gap-1.5", wide && !big && "cursor-move select-none")} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <SquareTerminalIcon className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="mr-auto truncate text-sm font-medium">Shell trên máy</h2>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void kill()} title="Thoát shell (lần mở sau là shell mới)">
          <PowerIcon aria-hidden /> Tắt shell
        </Button>
        {wide && (
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setBig((b) => !b)} aria-label={big ? "Thu nhỏ" : "Phóng to"}>
            {big ? <Minimize2Icon aria-hidden /> : <Maximize2Icon aria-hidden />}
          </Button>
        )}
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => onOpenChange(false)} aria-label="Đóng (shell vẫn chạy)">
          <XIcon aria-hidden />
        </Button>
      </div>
      <LiveTerminal key={`${url}#${gen}`} url={url} kind="shell" token={token} />
    </section>
  );
}
