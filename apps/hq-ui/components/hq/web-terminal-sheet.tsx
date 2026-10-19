"use client";

import { CopyIcon, ExternalLinkIcon, SquareTerminalIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { makeApi } from "./use-hq";

// xterm touches `document`, so it loads only in the browser.
const LiveTerminal = dynamic(() => import("./live-terminal").then((m) => m.LiveTerminal), { ssr: false });

const EVENT = "hq:web-terminal";
/** localStorage: "1" = the terminal button opens the room straight in Orca. */
const ORCA_PREF = "hq.term.orca";
type Target = { id: string; label: string };
type Info = { id: string; orca: boolean; command: string };

/** Open a background room's terminal inside HQ (any component, no prop drilling). */
export function openWebTerminal(id: string, label: string) {
  window.dispatchEvent(new CustomEvent<Target>(EVENT, { detail: { id, label } }));
}

/** The one web terminal of HQ: a wide right-side panel; closing it only detaches from the room. */
export function WebTerminalSheet({ token }: { token: string }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [fetched, setInfo] = useState<Info | null>(null);
  // Read on the client only: the checkbox renders after the Orca check, never in the server HTML.
  const [orcaFirst, setOrcaFirst] = useState(() => typeof window !== "undefined" && localStorage.getItem(ORCA_PREF) === "1");
  const info = fetched && fetched.id === target?.id ? fetched : null;

  async function toOrca(t: Target): Promise<boolean> {
    try {
      await makeApi(token)(`/api/sessions/${encodeURIComponent(t.id)}/orca`, { method: "POST", body: { title: t.label } });
      toast.success(`Đã mở ${t.label} trong Orca`);
      return true;
    } catch (e) {
      toast.error(`Không mở được trong Orca: ${(e as Error).message}`);
      return false;
    }
  }

  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Target>).detail;
      // "Luôn mở Orca": straight to Orca; the web panel opens only when Orca fails.
      if (localStorage.getItem(ORCA_PREF) === "1") void toOrca(t).then((ok) => !ok && setTarget(t));
      else setTarget(t);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!target) return;
    let live = true;
    makeApi(token)(`/api/sessions/${encodeURIComponent(target.id)}/orca`)
      .then((v) => live && setInfo({ ...(v as Omit<Info, "id">), id: target.id }))
      .catch(() => live && setInfo({ id: target.id, orca: false, command: `claude attach ${target.id.slice(0, 8)}` }));
    return () => {
      live = false;
    };
  }, [target, token]);

  async function popOut() {
    if (!target) return;
    try {
      await makeApi(token)(`/api/sessions/${encodeURIComponent(target.id)}/attach`, { method: "POST" });
      toast.success(`Đã mở cửa sổ terminal riêng cho ${target.label}`);
    } catch (e) {
      toast.error(`Không mở được cửa sổ riêng: ${(e as Error).message}`);
    }
  }

  async function copy() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.command);
      toast.success("Đã copy lệnh, dán vào terminal bất kỳ để vào đúng phòng");
    } catch {
      toast.error(`Không copy được, gõ tay: ${info.command}`);
    }
  }

  function setPref(on: boolean) {
    setOrcaFirst(on);
    localStorage.setItem(ORCA_PREF, on ? "1" : "0");
  }

  return (
    <Sheet open={target != null} onOpenChange={(o) => !o && setTarget(null)}>
      {/* data-[side=right] variants: the base sheet caps the right side at max-w-sm with the same prefix. */}
      <SheetContent side="right" className="flex flex-col gap-3 p-4 data-[side=right]:w-[min(1180px,94vw)] data-[side=right]:sm:max-w-[min(1180px,94vw)]">
        <SheetHeader className="flex-row flex-wrap items-center gap-1.5 space-y-0 p-0 pr-10">
          <SheetTitle className="mr-auto text-base">Terminal · {target?.label}</SheetTitle>
          <SheetDescription className="sr-only">Terminal thật của phòng, chạy ngay trong HQ</SheetDescription>
          {info?.orca && (
            <>
              <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted">
                <input type="checkbox" checked={orcaFirst} onChange={(e) => setPref(e.target.checked)} className="size-3.5 accent-primary" />
                Luôn mở Orca
              </label>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => target && void toOrca(target)}>
                <SquareTerminalIcon aria-hidden /> Mở trong Orca
              </Button>
            </>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={!info} title={info?.command} onClick={() => void copy()}>
            <CopyIcon aria-hidden /> Copy lệnh
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void popOut()}>
            <ExternalLinkIcon aria-hidden /> Cửa sổ riêng
          </Button>
        </SheetHeader>
        {target && <LiveTerminal key={target.id} url={`/api/sessions/${encodeURIComponent(target.id)}/term`} token={token} />}
      </SheetContent>
    </Sheet>
  );
}
