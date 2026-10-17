"use client";

import { CopyIcon, HandIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { askTitle, attachCommand, type Ask } from "@/lib/ask";
import { agoVi } from "@/lib/now";
import { makeApi } from "./use-hq";

export type AskRoom = {
  key: string;
  label: string;
  session_id: string | null;
  project: string | null;
  waiting: string | null;
  ask: Ask | null;
  /** A tmux room: answered in its live terminal (the drawer), not with `claude attach`. */
  tmux: boolean;
};

/**
 * "Anh cần trả lời": every room that waits for the owner, with the question it asks and the one way
 * Claude Code offers to answer a background session (`claude attach`). Shown first on the office page.
 */
export function AskPanel({ rooms, now, token, onOpen }: { rooms: AskRoom[]; now: number; token: string; onOpen: (key: string) => void }) {
  if (!rooms.length) return null;
  return (
    <section aria-labelledby="ask-panel" className="space-y-2">
      <h2 id="ask-panel" className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <HandIcon aria-hidden className="size-4 text-st-needs" />
        Anh cần trả lời
        <span className="text-sm font-normal text-muted-foreground tabular">{rooms.length} phòng đang dừng chờ anh</span>
      </h2>
      <ul className="space-y-3">
        {rooms.map((r) => (
          <AskCard key={r.key} r={r} now={now} token={token} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function AskCard({ r, now, token, onOpen }: { r: AskRoom; now: number; token: string; onOpen: (key: string) => void }) {
  const [busy, setBusy] = useState(false);
  const cmd = r.session_id && !r.tmux ? attachCommand(r.session_id) : null;
  const a = r.ask;

  async function openTerminal() {
    if (!r.session_id) return;
    setBusy(true);
    try {
      await makeApi(token)(`/api/sessions/${encodeURIComponent(r.session_id)}/attach`, { method: "POST" });
      toast.success(`Đã mở terminal cho ${r.label}: chọn đáp án rồi Enter`);
    } catch (e) {
      toast.error(`Không mở được terminal (${(e as Error).message}). Chạy lệnh đã chép trong PowerShell/Terminal.`);
      if (cmd) void copy(cmd, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-st-needs bg-st-needs/6 px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-semibold">{r.label}</span>
            {r.project && <span className="text-muted-foreground"> · {r.project}</span>}
            <span className="text-muted-foreground"> · {a ? askTitle(a) : "Đang chờ anh"}</span>
            {a?.at != null && <span className="text-muted-foreground tabular"> · {agoVi(a.at, now)}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {cmd ? (
            <>
              <Button type="button" size="sm" disabled={busy} onClick={() => void openTerminal()}>
                <SquareTerminalIcon aria-hidden /> Mở terminal để trả lời
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void copy(cmd, true)} title={cmd}>
                <CopyIcon aria-hidden /> Chép lệnh
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" onClick={() => onOpen(r.key)}>
              <SquareTerminalIcon aria-hidden /> Mở phòng để trả lời
            </Button>
          )}
        </div>
      </div>

      {a?.kind === "question" ? (
        <div className="mt-3 space-y-3">
          {a.questions.map((q, qi) => (
            <div key={qi} className="space-y-1.5">
              <p className="max-w-[75ch] text-[15px] leading-snug font-medium text-pretty">
                {q.header && <span className="mr-2 rounded-sm bg-muted px-1.5 py-px align-[1px] text-[11px] font-semibold text-muted-foreground">{q.header}</span>}
                {q.question}
                {q.multi && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(chọn được nhiều)</span>}
              </p>
              <ol className="space-y-1">
                {q.options.map((o, oi) => (
                  <li key={oi} className="flex max-w-[75ch] gap-2 text-sm">
                    <span className="w-4 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular">{oi + 1}.</span>
                    <span className="min-w-0">
                      <span className="font-medium">{o.label}</span>
                      {o.description && <span className="text-muted-foreground">: {o.description}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : a?.kind === "permission" ? (
        <p className="mt-2 max-w-[75ch] text-sm">
          <span className="font-mono text-xs text-muted-foreground">{a.tool}</span>
          {a.what && <span className="ml-2">{a.what}</span>}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{r.waiting ?? "Claude Code đang chờ một câu trả lời"}: mở terminal để xem câu hỏi.</p>
      )}

      <p className="mt-3 max-w-[75ch] text-xs text-muted-foreground text-pretty">
        {cmd ? (
          <>
            Trong terminal: gõ số của đáp án rồi Enter. Trả lời xong, phòng tự làm tiếp và khung này biến mất sau vài giây. Thoát terminal bằng{" "}
            <kbd className="rounded-sm border px-1 font-mono">←</kbd> hoặc đóng cửa sổ: session vẫn chạy.
          </>
        ) : (
          "Phòng này chạy trong terminal của HQ: mở phòng, chọn đáp án bằng thanh phím bên dưới màn hình."
        )}
      </p>
    </li>
  );
}

async function copy(cmd: string, say: boolean) {
  try {
    await navigator.clipboard.writeText(cmd);
    if (say) toast.success(`Đã chép: ${cmd}`);
  } catch {
    toast.message(`Lệnh: ${cmd}`);
  }
}
