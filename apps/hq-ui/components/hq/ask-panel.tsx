"use client";

import { CheckIcon, CopyIcon, HandIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TOOL_ASK, askTitle, attachCommand, type Ask } from "@/lib/ask";
import { agoVi } from "@/lib/now";
import type { Permit } from "@/lib/server/permit";
import { makeApi } from "./use-hq";
import { openWebTerminal } from "./web-terminal-sheet";

export type AskRoom = {
  key: string;
  label: string;
  session_id: string | null;
  project: string | null;
  waiting: string | null;
  ask: Ask | null;
  /** A permission request the room's hook holds open for the owner's click (`ccc hook permit`). */
  permit?: Permit | null;
  /** A tmux room: answered in its live terminal (the drawer), not with `claude attach`. */
  tmux: boolean;
};

/**
 * "Anh cần trả lời": every room that waits for the owner, with the question it asks and the one way
 * Claude Code offers to answer a background session (`claude attach`). Shown first on the office page.
 */
export function AskPanel({
  rooms,
  now,
  token,
  onOpen,
  wide,
}: {
  rooms: AskRoom[];
  now: number;
  token: string;
  onOpen: (key: string) => void;
  /** Tổng quan: asks side by side so the projects stay above the fold. */
  wide?: boolean;
}) {
  if (!rooms.length) return null;
  return (
    <section aria-labelledby="ask-panel" className="space-y-2">
      <h2 id="ask-panel" className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <HandIcon aria-hidden className="size-4 text-st-needs" />
        Anh cần trả lời
        <span className="text-sm font-normal text-muted-foreground tabular">{rooms.length} phòng đang dừng chờ anh</span>
      </h2>
      {/* Wide: side by side, each ask scrolls inside a capped height (the buttons stay on top). */}
      <ul className={wide ? "grid items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,34rem),1fr))] [&>li]:max-h-80 [&>li]:overflow-y-auto" : "space-y-3"}>
        {rooms.map((r) =>
          r.permit && r.session_id ? (
            <PermitCard key={r.key} r={r} p={r.permit} sid={r.session_id} now={now} token={token} />
          ) : (
            <AskCard key={r.key} r={r} now={now} token={token} onOpen={onOpen} />
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * A permission request while the owner is away: the room's hook waits for this click. When the
 * countdown ends it goes on by itself: everyday work inside the project proceeds, a ship step, an
 * upload or a write outside the project is skipped (the room notes the card and does other work).
 */
function PermitCard({ r, p, sid, now, token }: { r: AskRoom; p: Permit; sid: string; now: number; token: string }) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const left = Math.max(0, Math.round(p.until - now / 1000));

  async function answer(decision: "allow" | "deny") {
    setBusy(decision);
    try {
      await makeApi(token)(`/api/sessions/${encodeURIComponent(sid)}/permit`, { method: "POST", body: { id: p.id, decision } });
      toast.success(decision === "allow" ? `Đã cho phép ${r.label} chạy tiếp` : `Đã từ chối: ${r.label} sẽ làm cách khác`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-xl border border-st-needs bg-st-needs/6 px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-semibold">{r.label}</span>
            {r.project && <span className="text-muted-foreground"> · {r.project}</span>}
            <span className="text-muted-foreground"> · {TOOL_ASK[p.tool] ?? `Xin quyền dùng ${p.tool}`}</span>
          </p>
          {p.what && <p className="mt-1.5 max-w-[75ch] text-sm break-words">{p.what}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" disabled={busy != null || left === 0} onClick={() => void answer("allow")} aria-label={`Cho phép ${r.label}`}>
            <CheckIcon aria-hidden /> Cho phép
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy != null || left === 0} onClick={() => void answer("deny")} aria-label={`Từ chối ${r.label}`}>
            <XIcon aria-hidden /> Từ chối
          </Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground tabular" role="timer" aria-live="off">
        {silence(p, left)}
      </p>
    </li>
  );
}

/** What happens if the owner does not click: the hook decided it when it posted the request. */
/** Ship (merge, release, deploy) is the owner's alone: the critic never answers it, however long the owner is away. */
export const SHIP_NOTE = "Câu Ship (merge, release, deploy): chỉ anh duyệt. Critic không trả lời thay câu này dù anh vắng bao lâu.";
/** A question typed as text, not through AskUserQuestion: the delegate hook cannot see it. */
export const PROSE_NOTE = "Phòng hỏi bằng chữ thường nên critic không trả lời thay được.";

export function isShip(a: { kind: string; questions?: { header?: string | null }[] } | null | undefined): boolean {
  return a?.kind === "question" && (a.questions ?? []).some((q) => (q.header ?? "").trim().toLowerCase() === "ship");
}

export function silence(p: Pick<Permit, "then" | "why">, left: number): string {
  if (p.then === "allow") {
    return left > 0 ? `Không bấm thì sau ${left} s phòng tự cho phép và làm tiếp (việc thường trong dự án).` : "Hết giờ: phòng đã tự cho phép và làm tiếp.";
  }
  const why = p.why ? ` (${p.why})` : "";
  return left > 0 ? `Không bấm thì sau ${left} s phòng bỏ bước này${why}, ghi chú lên card rồi làm việc khác.` : `Hết giờ: phòng đã bỏ bước này${why} và làm việc khác.`;
}

function AskCard({ r, now, token, onOpen }: { r: AskRoom; now: number; token: string; onOpen: (key: string) => void }) {
  const [busy, setBusy] = useState(false);
  const cmd = r.session_id && !r.tmux ? attachCommand(r.session_id) : null;
  const a = r.ask;

  async function openTerminal() {
    if (!r.session_id) return;
    // tmux rooms keep their own drawer; a background room's real terminal opens inside HQ.
    if (r.tmux) {
      setBusy(true);
      try {
        await makeApi(token)(`/api/sessions/${encodeURIComponent(r.session_id)}/attach`, { method: "POST" });
        toast.success(`Đã mở terminal cho ${r.label}: chọn đáp án rồi Enter`);
      } catch (e) {
        toast.error(`Không mở được terminal (${(e as Error).message}). Chạy trong PowerShell/Terminal: ${cmd}`);
        if (cmd) void copy(cmd, false);
      } finally {
        setBusy(false);
      }
      return;
    }
    openWebTerminal(r.session_id, r.label);
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
          {isShip(a) && <p className="text-xs font-medium text-st-needs">{SHIP_NOTE}</p>}
        </div>
      ) : a?.kind === "permission" ? (
        <p className="mt-2 max-w-[75ch] text-sm">
          <span className="font-mono text-xs text-muted-foreground">{a.tool}</span>
          {a.what && <span className="ml-2">{a.what}</span>}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{r.waiting ?? "Claude Code đang chờ một câu trả lời"}: mở terminal để xem câu hỏi. {PROSE_NOTE}</p>
      )}

      <p className="mt-3 max-w-[75ch] text-xs text-muted-foreground text-pretty">
        {cmd ? (
          <>
            Terminal mở ngay trong HQ: chọn đáp án bằng mũi tên hoặc gõ số, rồi Enter. Trả lời xong, phòng tự làm tiếp và khung này biến mất sau vài giây. Đóng terminal thì phòng vẫn chạy.
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
