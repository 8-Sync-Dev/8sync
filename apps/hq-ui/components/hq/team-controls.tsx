"use client";

import { PlayIcon, PowerOffIcon, RefreshCwIcon, SquareIcon, SparklesIcon, UsersIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ShipLoopChip } from "./ship-loop-chip";
import { makeApi } from "./use-hq";

type Action = "up" | "full" | "boost" | "unboost" | "clean" | "down";
type Result = { ok: boolean; output: string; error: string | null };

const DONE: Record<Action, string> = {
  up: "Đã mở team",
  full: "Đã mở team đầy đủ",
  boost: "Đã bật Sấm Sét",
  unboost: "Đã tắt Sấm Sét, về team 6 phòng",
  clean: "Đã dọn session rác, nạp bản mới và mở team",
  down: "Đã dừng team",
};
const OPENING: Record<Action, string> = {
  up: "lead, dev, qa, review, rd",
  full: "6 phòng: lead, dev, dev2, ui, qa, review",
  boost: "Sấm Sét, 13 phòng mở lần lượt, có thể mất tới 10 phút",
  unboost: "",
  clean: "dọn rác, khởi động lại phòng chạy bản cũ",
  down: "",
};
const WAITING = (action: Action, name: string) =>
  action === "down" ? `Đang dừng team ${name}…` : action === "unboost" ? `Đang tắt Sấm Sét của ${name} (dừng 7 phòng thêm, card đang giữ trả về cột)…` : `Đang mở team ${name} (${OPENING[action]})…`;
const FAILED = (action: Action, name: string) => (action === "down" ? `Không dừng được team ${name}` : action === "unboost" ? `Không tắt được Sấm Sét của ${name}` : `Không mở được team ${name}`);

/** What the confirm dialog of Sấm Sét says, in one sentence (also the button's tooltip). */
const BOOST_COST = "13 phòng chạy song song: 2 lập kế hoạch (lead, ba), 7 builder (dev, dev2, dev3, dev4, dev5, dev6, ui), 2 QA (qa, qa2), 2 review (review, review2); tốn quota khoảng 13 lần một phiên, lease 2 giờ.";
/** What "Tắt Sấm Sét" does (`auto down --only ba,dev3,dev4,dev5,dev6,qa2,review2`, lib/server/team.ts BOOST_ONLY). */
const UNBOOST_INFO = "Tắt Sấm Sét: về team 6 phòng (lead, dev, dev2, ui, qa, review); dừng ba, dev3–dev6, qa2, review2; card các phòng đó đang giữ trả về cột (building → ready, qa/review ở lại cột, bỏ claim). Lease giữ nguyên: hết giờ Sấm Sét thì cả team dừng như cũ (muốn chạy tiếp: Team đầy đủ). Gia hạn 2 giờ: giữ 13 phòng thêm 2 giờ.";

/**
 * The project's live team is already the boost team: 13+ rooms that include the rooms only boost opens
 * (dev6, qa2, review2). Any name token counts: `auto up` titles a clashing room `<name>-<repo>`, HQ rooms are `hq-<repo>-<name>`.
 */
export function boostOn(rooms: { name: string; label: string; status: string }[]): boolean {
  const live = rooms.filter((r) => r.status !== "ended");
  const tokens = new Set(live.flatMap((r) => `${r.label} ${r.name}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)));
  return live.length >= 13 && tokens.has("dev6") && tokens.has("qa2") && tokens.has("review2");
}

/** POST /api/team and say what happened; `after` refreshes the office and the board. */
function useTeam(token: string, after?: () => void) {
  const [busy, setBusy] = useState<Action | null>(null);
  async function act(root: string, name: string, action: Action) {
    setBusy(action);
    const wait = toast.loading(WAITING(action, name));
    try {
      const r = await makeApi(token)<Result>("/api/team", { method: "POST", body: { root, action } });
      // Boost: the CLI's own summary (its last line); the other actions show the whole report.
      const description = action === "boost" ? r.output.split("\n").at(-1) : <pre className="mt-1 max-h-48 overflow-auto text-[11px] leading-snug whitespace-pre-wrap">{r.output}</pre>;
      toast.success(`${DONE[action]}: ${name}`, { id: wait, description });
    } catch (e) {
      toast.error(FAILED(action, name), { id: wait, description: (e as Error).message });
    } finally {
      setBusy(null);
      after?.();
    }
  }
  return { busy, act };
}

/** The choices of an active Sấm Sét: turn it off (back to the 6-room team), renew the lease, or nothing. */
export function BoostChoices({ onOff, onRenew, onCancel }: { onOff: () => void; onRenew: () => void; onCancel: () => void }) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Thôi
      </Button>
      <Button type="button" variant="outline" onClick={onRenew} title="Giữ 13 phòng thêm 2 giờ (auto up --roles boost --hours 2)">
        <RefreshCwIcon aria-hidden /> Gia hạn 2 giờ
      </Button>
      <Button type="button" onClick={onOff} title="Về team 6 phòng (auto down --only ba,dev3,dev4,dev5,dev6,qa2,review2)">
        <PowerOffIcon aria-hidden /> Tắt Sấm Sét
      </Button>
    </DialogFooter>
  );
}

/**
 * "⚡ Sấm Sét": the 13-room boost team of one project (`auto up --roles boost --hours 2`). Off: asks first
 * (the quota cost). On (`active`, see boostOn): asks to turn it off (`unboost`, back to the 6-room team)
 * or renew the 2-hour lease with the same command.
 */
export function BoostButton({ root, name, token, active, after, className }: { root: string; name: string; token: string; active: boolean; after?: () => void; className?: string }) {
  const { busy, act } = useTeam(token, after);
  const [ask, setAsk] = useState(false);
  const choose = (action: Action) => {
    setAsk(false);
    void act(root, name, action);
  };
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy != null}
        aria-busy={busy != null}
        onClick={() => setAsk(true)}
        title={active ? "Sấm Sét đang chạy 13 phòng. Bấm để gia hạn thêm 2 giờ hoặc tắt (về team 6 phòng)" : `${BOOST_COST} (auto up --roles boost --hours 2)`}
        className={cn(
          "font-semibold",
          active && "border-brand-ink/40 bg-brand/25 text-brand-ink hover:bg-brand/40 hover:text-brand-ink dark:border-brand/40 dark:bg-brand/15 dark:text-brand",
          className,
        )}
      >
        <ZapIcon aria-hidden className={cn(!active && "text-brand-ink dark:text-brand", busy != null && "motion-safe:animate-pulse")} />
        {busy === "unboost" ? "Đang tắt…" : busy != null ? "Đang bật…" : active ? "Đang Sấm Sét" : "Sấm Sét"}
      </Button>
      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{active ? "Sấm Sét đang chạy 13 phòng" : `Bật Sấm Sét cho ${name}?`}</DialogTitle>
            <DialogDescription>{active ? UNBOOST_INFO : BOOST_COST}</DialogDescription>
          </DialogHeader>
          {active ? (
            <BoostChoices onOff={() => choose("unboost")} onRenew={() => choose("boost")} onCancel={() => setAsk(false)} />
          ) : (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAsk(false)}>
                Thôi
              </Button>
              <Button type="button" onClick={() => choose("boost")}>
                <ZapIcon aria-hidden /> Mở 13 phòng
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Header buttons of a project that already has rooms: boost / resume / clean and reopen / stop. */
export function TeamControls({ root, name, token, boost = false, after }: { root: string; name: string; token: string; boost?: boolean; after?: () => void }) {
  const { busy, act } = useTeam(token, after);
  const [ask, setAsk] = useState<Action | null>(null);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <ShipLoopChip root={root} token={token} />
      <BoostButton root={root} name={name} token={token} active={boost} after={after} />
      <Button type="button" size="sm" variant="outline" disabled={busy != null} onClick={() => void act(root, name, "up")} title="Mở phòng còn thiếu, nối lại phòng đã dừng (8sync ccc auto up)">
        <PlayIcon aria-hidden /> Mở lại team
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsk("clean")} title="Xoá session nền rác, khởi động lại phòng đang chạy bản cũ, rồi mở team (auto up --clear-ss)">
        <SparklesIcon aria-hidden /> Dọn & mở lại
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsk("full")} title="6 phòng, 3 phòng code: lead, dev, dev2, ui, qa, review (auto up --roles full)">
        <UsersIcon aria-hidden /> Team đầy đủ
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsk("down")} title="Dừng các phòng nền, giữ hội thoại (auto down)">
        <SquareIcon aria-hidden /> Dừng team
      </Button>
      <Dialog open={ask != null} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ask === "down" ? `Dừng team ${name}?` : ask === "full" ? `Mở team đầy đủ cho ${name}?` : `Dọn và nạp bản mới cho ${name}?`}</DialogTitle>
            <DialogDescription>
              {ask === "down"
                ? "Các phòng nền dừng lại, hội thoại vẫn giữ. Bấm “Mở lại team” để chạy tiếp từ chỗ cũ."
                : ask === "full"
                  ? "6 phòng chạy nền: lead viết card và merge, dev, dev2 và ui làm, qa kiểm, review duyệt. Cột ready đầy 6 card thì lead ngừng tách việc. Mỗi phòng là một session riêng nên tốn quota gần gấp 6 lần một session; tới 90% cửa sổ 5 giờ/7 ngày thì cả team tự nghỉ."
                  : "Xoá session nền của dự án mà không phòng nào giữ, khởi động lại phòng đang chạy bản 8sync cũ (giữ hội thoại), rồi mở team. Session có worktree còn thay đổi chưa commit được giữ lại, không mất code."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAsk(null)}>
              Thôi
            </Button>
            <Button
              type="button"
              variant={ask === "down" ? "destructive" : "default"}
              onClick={() => {
                const a = ask!;
                setAsk(null);
                void act(root, name, a);
              }}
            >
              {ask === "down" ? "Dừng team" : ask === "full" ? "Mở 6 phòng" : "Dọn và mở lại"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Folders added in HQ with no room running: one click opens the whole team there. */
export function TeamStarter({ projects, token, after }: { projects: { path: string; name: string }[]; token: string; after?: () => void }) {
  const { busy, act } = useTeam(token, after);
  if (!projects.length) return null;
  return (
    <section aria-labelledby="team-starter" className="space-y-2">
      <h2 id="team-starter" className="flex items-center gap-2 text-sm font-semibold">
        <UsersIcon aria-hidden className="size-4 text-muted-foreground" />
        Dự án chưa có team
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {projects.map((p) => (
          <li key={p.path} className="flex min-w-0 items-center gap-3 px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground" title={p.path}>
                {p.path}
              </span>
            </span>
            <Button type="button" size="sm" disabled={busy != null} onClick={() => void act(p.path, p.name, "up")}>
              <PlayIcon aria-hidden /> Mở team
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy != null} onClick={() => void act(p.path, p.name, "full")} title="6 phòng, tốn quota gần gấp 6 lần một session">
              <UsersIcon aria-hidden /> Team đầy đủ
            </Button>
          </li>
        ))}
      </ul>
      <p className="max-w-[75ch] text-xs text-muted-foreground text-pretty">
        Mở team: 5 phòng nền (lead viết card, dev làm, qa kiểm, review duyệt, rd nghiên cứu). Team đầy đủ: 6 phòng, 3 phòng code (lead, dev, dev2, ui, qa, review). Thêm thư mục khác ở mục Projects bên trái.
      </p>
    </section>
  );
}
