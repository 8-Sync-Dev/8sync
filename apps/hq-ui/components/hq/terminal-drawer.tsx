"use client";

import { MaximizeIcon, MinimizeIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { sessionLabel } from "@/lib/labels";
import { STATUS_LABEL, StatusDot } from "./bits";
import { KeyBar } from "./key-bar";
import type { Session } from "./types";
import { makeApi } from "./use-hq";

// xterm touches `document`, so it loads only in the browser.
const TerminalView = dynamic(() => import("./terminal").then((m) => m.TerminalView), { ssr: false });

/** The live pane is re-read this often while the drawer is open and the tab visible. */
export const SCREEN_POLL_MS = 750;

/**
 * Right-side drawer with a session's live tmux screen (ANSI colours via the
 * existing xterm view), a "Gõ cho session" message box (POST /api/messages),
 * the dialog keys bar, and a full-screen toggle. `role`/`model` come from the
 * roles registry when the caller has them.
 */
export function TerminalDrawer({
  session,
  token,
  onClose,
  role,
  model,
}: {
  session: Session | null;
  token: string;
  onClose: () => void;
  role?: string | null;
  model?: string | null;
}) {
  const api = useMemo(() => makeApi(token), [token]);
  const [full, setFull] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null);
  const name = session?.name ?? null;
  const open = name != null;

  // TerminalView's own timer is 1.5 s; nudging it keeps the screen under 1 s.
  // No nudges (and no extra requests) while the tab is hidden.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      if (!document.hidden) setNudge((n) => n + 1);
    }, SCREEN_POLL_MS);
    return () => clearInterval(id);
  }, [open]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!name || !text.trim()) return;
    try {
      const r = await api<{ delivery: string }>("/api/messages", { method: "POST", body: { session: name, text } });
      setText("");
      setNote({ ok: true, msg: `Đã gửi (${r.delivery})` });
      setNudge((n) => n + 1);
    } catch (err) {
      setNote({ ok: false, msg: (err as Error).message });
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className={cn("w-full gap-3 p-4 data-[side=right]:w-full", full ? "data-[side=right]:sm:max-w-none" : "data-[side=right]:sm:max-w-2xl")}
      >
        <SheetHeader className="p-0 pr-8">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-sm">
            {session && <StatusDot status={session.status} />}
            {session ? sessionLabel(session) : ""}
            {role && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">{role}</span>}
            {model && <span className="font-mono text-[11px] font-normal text-muted-foreground">{model}</span>}
            {session && <span className="text-xs font-normal text-muted-foreground">{STATUS_LABEL[session.status]}</span>}
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setFull((f) => !f)} aria-pressed={full}>
              {full ? <MinimizeIcon aria-hidden /> : <MaximizeIcon aria-hidden />}
              {full ? "Thu nhỏ" : "Mở toàn màn hình"}
            </Button>
          </SheetTitle>
          <SheetDescription>
            {session?.waiting ? `${session.waiting} Trả lời bằng các phím bên dưới.` : "Màn hình tmux trực tiếp, chỉ đọc. Gõ bên dưới để gửi cho session."}
          </SheetDescription>
        </SheetHeader>
        {name && (
          <>
            <TerminalView api={api} name={name} nudge={nudge} />
            <form onSubmit={send} className="flex shrink-0 items-center gap-2">
              <label htmlFor="drawer-msg" className="sr-only">
                Gõ cho session
              </label>
              <Input id="drawer-msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Gõ cho session" maxLength={4000} autoComplete="off" />
              <Button type="submit" size="sm" disabled={!text.trim()}>
                Gửi
              </Button>
            </form>
            {note && (
              <p role={note.ok ? "status" : "alert"} className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-destructive")}>
                {note.msg}
              </p>
            )}
            <KeyBar api={api} name={name} onSent={() => setNudge((n) => n + 1)} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
