"use client";

import { RepeatIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { loopFor, loopWait, type ShipLoop } from "@/lib/slash";
import { cn } from "@/lib/utils";
import { makeApi } from "./use-hq";

const POLL_MS = 30_000;
/** Every chip on the page shares one GET /api/auto/loop per POLL_MS window. */
let shared: { at: number; p: Promise<ShipLoop[]> } | null = null;

function loadLoops(token: string, fresh = false): Promise<ShipLoop[]> {
  if (!fresh && shared && Date.now() - shared.at < POLL_MS / 2) return shared.p;
  const p = makeApi(token)<{ loops: ShipLoop[] }>("/api/auto/loop")
    .then((r) => r.loops)
    .catch(() => []);
  shared = { at: Date.now(), p };
  return p;
}

const CHANGED = "hq-ship-loop";
/** The composer turned a loop on or off: every chip reloads now instead of at its next poll. */
export function shipLoopsChanged() {
  shared = null;
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * "Auto-ship: vòng N" next to a project's team buttons while its loop runs (`/hq-auto-ship`,
 * `8sync ccc auto loop on`), with a stop button (`auto loop off`, the same as `/hq-stop` without the brief).
 */
export function ShipLoopChip({ root, token, className }: { root: string; token: string; className?: string }) {
  const [loop, setLoop] = useState<ShipLoop | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () => void loadLoops(token).then((ls) => alive && setLoop(loopFor(ls, root)));
    tick();
    const t = setInterval(tick, POLL_MS);
    window.addEventListener(CHANGED, tick);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener(CHANGED, tick);
    };
  }, [token, root]);
  if (!loop) return null;
  async function stop() {
    setBusy(true);
    try {
      await makeApi(token)("/api/auto/loop", { method: "POST", body: { root, on: false } });
      toast.success("Đã tắt auto-ship", { description: "Các card đang làm vẫn xong theo luồng thường; không mở vòng mới." });
      setLoop(loopFor(await loadLoops(token, true), root));
    } catch (e) {
      toast.error(`Chưa tắt được auto-ship: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  const wait = loopWait(loop.next);
  const about = `${loop.focus ? `Trọng tâm: ${loop.focus}. ` : ""}Vòng R&D, optimize, nâng cấp, cải tiến, sec, check thiếu; vòng kế tự gửi khi board cạn${wait ? `, lúc này ${wait} (tự chạy tiếp khi hết)` : ""}.`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md bg-brand/20 py-0.5 pr-0.5 pl-2 text-xs font-medium text-brand-ink dark:text-brand", className)} title={about}>
      <RepeatIcon className="size-3.5" aria-hidden />
      Auto-ship: vòng {loop.round}
      {wait && <span className="font-normal opacity-80">· {wait}</span>}
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void stop()}
        aria-label="Dừng auto-ship"
        title="Dừng vòng auto-ship (8sync ccc auto loop off)"
        className="ml-0.5 grid size-6 place-items-center rounded-sm outline-none hover:bg-brand/30 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 max-sm:size-9"
      >
        <SquareIcon className="size-3" aria-hidden />
      </button>
    </span>
  );
}
