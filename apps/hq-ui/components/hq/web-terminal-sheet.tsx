"use client";

import { ExternalLinkIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { makeApi } from "./use-hq";

// xterm touches `document`, so it loads only in the browser.
const LiveTerminal = dynamic(() => import("./live-terminal").then((m) => m.LiveTerminal), { ssr: false });

const EVENT = "hq:web-terminal";
type Target = { id: string; label: string };

/** Open a background room's terminal inside HQ (any component, no prop drilling). */
export function openWebTerminal(id: string, label: string) {
  window.dispatchEvent(new CustomEvent<Target>(EVENT, { detail: { id, label } }));
}

/** The one web terminal of HQ: a wide right-side panel; closing it only detaches from the room. */
export function WebTerminalSheet({ token }: { token: string }) {
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    const on = (e: Event) => setTarget((e as CustomEvent<Target>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  async function popOut() {
    if (!target) return;
    try {
      await makeApi(token)(`/api/sessions/${encodeURIComponent(target.id)}/attach`, { method: "POST" });
      toast.success(`Đã mở cửa sổ terminal riêng cho ${target.label}`);
    } catch (e) {
      toast.error(`Không mở được cửa sổ riêng: ${(e as Error).message}`);
    }
  }

  return (
    <Sheet open={target != null} onOpenChange={(o) => !o && setTarget(null)}>
      {/* data-[side=right] variants: the base sheet caps the right side at max-w-sm with the same prefix. */}
      <SheetContent side="right" className="flex flex-col gap-3 p-4 data-[side=right]:w-[min(1180px,94vw)] data-[side=right]:sm:max-w-[min(1180px,94vw)]">
        <SheetHeader className="flex-row items-center gap-3 space-y-0 p-0 pr-10">
          <SheetTitle className="text-base">Terminal · {target?.label}</SheetTitle>
          <SheetDescription className="sr-only">Terminal thật của phòng, chạy ngay trong HQ</SheetDescription>
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => void popOut()}>
            <ExternalLinkIcon aria-hidden /> Mở cửa sổ riêng
          </Button>
        </SheetHeader>
        {target && <LiveTerminal key={target.id} sessionId={target.id} token={token} />}
      </SheetContent>
    </Sheet>
  );
}
