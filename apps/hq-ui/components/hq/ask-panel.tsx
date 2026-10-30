"use client";

import { CheckIcon, CopyIcon, HandIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { askTitle, attachCommand, type Ask } from "@/lib/ask";
import { interactiveHint } from "@/lib/interactive";
import { agoVi } from "@/lib/now";
import { flatText } from "@/lib/screen";
import { ApiError, makeApi } from "./use-hq";
import type { Room } from "./use-office";
import { openWebTerminal } from "./web-terminal-sheet";

export type AskRoom = {
  key: string;
  label: string;
  session_id: string | null;
  project: string | null;
  waiting: string | null;
  ask: Ask | null;
  /** A tmux room: answered in its live terminal (the drawer), not with `claude attach`. */
  tmux: boolean;
  /** Opened by hand in the owner's own terminal window: answered there, HQ cannot attach to it. */
  interactive?: boolean;
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
  const tap = oneTapKind(r);
  const a = r.ask;

  async function openTerminal() {
    if (!r.session_id) return;
    // An interactive session lives in the owner's own window: `claude attach` cannot reach it.
    if (r.interactive) {
      toast.message(interactiveHint(r.label));
      return;
    }
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
        <div className="min-w-0 flex-1 basis-56">
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
              <Button type="button" size="sm" variant={tap ? "outline" : "default"} disabled={busy} onClick={() => void openTerminal()}>
                <SquareTerminalIcon aria-hidden /> {r.interactive ? "Trả lời trong cửa sổ của anh" : "Mở terminal để trả lời"}
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
              {/* Long questions (a lead's 19-card merge list) fold to three lines; the whole text is one tap away. Owner 2026-10-22: "loạn quá". */}
              <details className="group max-w-[75ch]">
                <summary className="cursor-pointer list-none text-[15px] leading-snug font-medium text-pretty [&::-webkit-details-marker]:hidden">
                  {q.header && <span className="mr-2 rounded-sm bg-muted px-1.5 py-px align-[1px] text-[11px] font-semibold text-muted-foreground">{q.header}</span>}
                  <span className="line-clamp-3 group-open:line-clamp-none">{q.question}</span>
                  {q.multi && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(chọn được nhiều)</span>}
                </summary>
              </details>
              {/* With one-tap answers the options are the buttons below (label and description). */}
              {!tap && (
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
              )}
            </div>
          ))}
        </div>
      ) : null}

      {tap && r.session_id && <OneTap r={r} sid={r.session_id} kind={tap} token={token} onTerminal={() => void openTerminal()} />}

      {a?.kind === "permission" ? (
        <p className="mt-2 max-w-[75ch] text-sm">
          <span className="font-mono text-xs text-muted-foreground">{a.tool}</span>
          {a.what && <span className="ml-2">{a.what}</span>}
        </p>
      ) : !a && !tap ? (
        <p className="mt-2 text-sm text-muted-foreground">{r.waiting ?? "Claude Code đang chờ một câu trả lời"}: mở terminal để xem câu hỏi.</p>
      ) : null}

      <p className="mt-3 max-w-[75ch] text-xs text-muted-foreground text-pretty">
        {r.interactive ? (
          interactiveHint(r.label)
        ) : cmd && tap ? (
          "Bấm một nút: HQ đọc lại màn hình của phòng rồi mới gửi phím, màn hình đã đổi thì không gửi gì. Muốn trả lời khác: mở terminal ngay trong HQ."
        ) : cmd ? (
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

/** The panel's view of an office room. `claude agents` reports a background room's dialog ("permission prompt") as its `doing` line. */
export function askRoomOf(r: Room): AskRoom {
  const waiting = r.waiting ?? (r.status === "needs_input" ? r.doing : null);
  return { key: r.key, label: r.label, session_id: r.session_id, project: r.project?.name ?? null, waiting, ask: r.ask, tmux: r.delivery === "terminal", interactive: r.interactive };
}

/**
 * Which dialogs one tap may answer in a background room: a permission prompt (from the transcript or
 * `claude agents` "permission prompt"), or one single-choice question. Anything else: the terminal.
 */
export function oneTapKind(r: Pick<AskRoom, "ask" | "waiting" | "tmux" | "session_id" | "interactive">): "permission" | "question" | null {
  if (r.tmux || r.interactive || !r.session_id) return null;
  const a = r.ask;
  if (a?.kind === "question") return a.questions.length === 1 && !a.questions[0].multi && a.questions[0].options.length > 0 ? "question" : null;
  if (a?.kind === "permission" || /permission/i.test(r.waiting ?? "")) return "permission";
  return null;
}

type Screen = { text: string; yes: boolean };
/**
 * Screen reads in flight, shared by mounts that overlap (React's dev double effect): two reads would
 * race for the room. Dropped once settled, so a later mount reads the screen again, never an old one.
 */
const peeks = new Map<string, Promise<Screen>>();

const ENTER = "\r";
const ESC = "\u001b";

/**
 * One-tap answers through the room's terminal bridge (POST /api/sessions/<id>/answer). The screen is
 * read first and shown as is (the exact command or question), so the owner approves what the room
 * really asks; the click sends that text back and the server types the key only if the screen still
 * shows exactly it (a new dialog in the same room, even another permission prompt, never takes it).
 */
export function OneTap({ r, sid, kind, token, onTerminal }: { r: AskRoom; sid: string; kind: "permission" | "question"; token: string; onTerminal: () => void }) {
  const key = `${sid}:${r.ask?.at ?? r.waiting ?? ""}`;
  const [screen, setScreen] = useState<Screen | "reading" | "moved" | "error">("reading");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let p = peeks.get(key);
    if (!p) {
      p = makeApi(token)<{ dialog: { text: string; yes?: boolean } }>(`/api/sessions/${encodeURIComponent(sid)}/answer`, { method: "POST", body: { kind, keys: [] } }).then((d) => ({
        text: d.dialog.text,
        yes: d.dialog.yes !== false,
      }));
      peeks.set(key, p);
      const done = () => peeks.delete(key);
      p.then(done, done);
    }
    p.then((s) => live && setScreen(s)).catch((e) => live && setScreen(e instanceof ApiError && e.status === 409 ? "moved" : "error"));
    return () => {
      live = false;
    };
  }, [key, sid, kind, token]);

  async function send(keys: string[], done: string) {
    if (typeof screen !== "object") return;
    setBusy(keys.join(""));
    try {
      await makeApi(token)(`/api/sessions/${encodeURIComponent(sid)}/answer`, { method: "POST", body: { kind, keys, text: screen.text } });
      toast.success(done);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setScreen("moved");
        toast.error(`${r.label}: màn hình đã đổi, mở terminal`);
      } else toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const ready = typeof screen === "object";
  const off = !ready || busy != null;
  const q = r.ask?.kind === "question" ? r.ask.questions[0] : null;
  return (
    <div className="mt-3 space-y-2" aria-live="polite">
      {screen === "reading" ? (
        <p className="text-xs text-muted-foreground">Đang đọc màn hình của phòng…</p>
      ) : screen === "moved" || screen === "error" ? (
        <p className="text-xs text-muted-foreground">
          {screen === "moved" ? "Màn hình đã đổi, " : "Không đọc được màn hình, "}
          <button type="button" className="font-medium text-foreground underline underline-offset-4 hover:no-underline" onClick={onTerminal}>
            mở terminal
          </button>
          .
        </p>
      ) : q && flatText(screen.text) === flatText(q.question) ? null : ( // the question already shows above, word for word: the buttons are the answer (owner 2026-10-22: "loạn quá")
        <figure>
          <figcaption className="text-xs text-muted-foreground">Phòng đang hỏi đúng như sau</figcaption>
          <pre className="mt-1 max-h-40 max-w-[90ch] overflow-auto rounded-md border bg-background px-2.5 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{screen.text}</pre>
        </figure>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Trả lời nhanh cho ${r.label}`}>
        {kind === "permission" ? (
          <>
            <Button type="button" size="sm" disabled={off || (ready && !screen.yes)} onClick={() => void send([ENTER], `Đã cho phép ${r.label} chạy tiếp`)}>
              <CheckIcon aria-hidden /> Cho phép
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={off} onClick={() => void send([ESC], `Đã từ chối: ${r.label} sẽ làm cách khác`)}>
              <XIcon aria-hidden /> Từ chối
            </Button>
          </>
        ) : (
          q?.options.map((o, oi) => (
            <Button
              key={oi}
              type="button"
              size="sm"
              variant="outline"
              className="h-auto min-h-7 max-w-full items-start justify-start py-1.5 text-left whitespace-normal"
              disabled={off}
              onClick={() => void send([String(oi + 1)], `Đã chọn “${o.label}” cho ${r.label}`)}
            >
              <span className="font-mono text-xs leading-5 opacity-70 tabular">{oi + 1}.</span>
              <span className="min-w-0">
                <span className="block leading-5">{o.label}</span>
                {o.description && <span className="block text-xs font-normal text-muted-foreground">{o.description}</span>}
              </span>
            </Button>
          ))
        )}
      </div>
    </div>
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
