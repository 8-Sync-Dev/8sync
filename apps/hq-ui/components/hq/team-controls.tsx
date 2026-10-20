"use client";

import { PlayIcon, SquareIcon, SparklesIcon, UsersIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { makeApi } from "./use-hq";

type Action = "up" | "full" | "boost" | "clean" | "down";
type Result = { ok: boolean; output: string; error: string | null };

const DONE: Record<Action, string> = {
  up: "Đã mở team",
  full: "Đã mở team đầy đủ",
  boost: "Đã bật Sấm Sét",
  clean: "Đã dọn session rác, nạp bản mới và mở team",
  down: "Đã dừng team",
};
const OPENING: Record<Action, string> = {
  up: "lead, dev, qa, review, rd",
  full: "6 phòng: lead, dev, dev2, ui, qa, review",
  boost: "Sấm Sét, 9 phòng mở lần lượt, có thể mất tới 7 phút",
  clean: "dọn rác, khởi động lại phòng chạy bản cũ",
  down: "",
};

/** What the confirm dialog of Sấm Sét says, in one sentence (also the button's tooltip). */
const BOOST_COST = "9 phòng chạy song song: lead, 5 builder (dev, dev2, dev3, dev4, ui), 2 QA (qa, qa2) và review; tốn quota khoảng 9 lần một phiên, lease 2 giờ.";

/**
 * The project's live team is already the boost team: 9+ rooms that include the rooms only boost opens
 * (qa2, dev4). Any name token counts: `auto up` titles a clashing room `<name>-<repo>`, HQ rooms are `hq-<repo>-<name>`.
 */
export function boostOn(rooms: { name: string; label: string; status: string }[]): boolean {
  const live = rooms.filter((r) => r.status !== "ended");
  const tokens = new Set(live.flatMap((r) => `${r.label} ${r.name}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)));
  return live.length >= 9 && tokens.has("qa2") && tokens.has("dev4");
}

/** POST /api/team and say what happened; `after` refreshes the office and the board. */
function useTeam(token: string, after?: () => void) {
  const [busy, setBusy] = useState<Action | null>(null);
  async function act(root: string, name: string, action: Action) {
    setBusy(action);
    const wait = toast.loading(action === "down" ? `Đang dừng team ${name}…` : `Đang mở team ${name} (${OPENING[action]})…`);
    try {
      const r = await makeApi(token)<Result>("/api/team", { method: "POST", body: { root, action } });
      // Boost: the CLI's own summary (its last line); the other actions show the whole report.
      const description = action === "boost" ? r.output.split("\n").at(-1) : <pre className="mt-1 max-h-48 overflow-auto text-[11px] leading-snug whitespace-pre-wrap">{r.output}</pre>;
      toast.success(`${DONE[action]}: ${name}`, { id: wait, description });
    } catch (e) {
      toast.error(`Không ${action === "down" ? "dừng" : "mở"} được team ${name}`, { id: wait, description: (e as Error).message });
    } finally {
      setBusy(null);
      after?.();
    }
  }
  return { busy, act };
}

/**
 * "⚡ Sấm Sét": the 9-room boost team of one project (`auto up --roles boost --hours 2`). Off: asks first
 * (the quota cost). On (`active`, see boostOn): the click renews the 2-hour lease with the same command.
 */
export function BoostButton({ root, name, token, active, after, className }: { root: string; name: string; token: string; active: boolean; after?: () => void; className?: string }) {
  const { busy, act } = useTeam(token, after);
  const [ask, setAsk] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy != null}
        aria-busy={busy != null}
        onClick={() => (active ? void act(root, name, "boost") : setAsk(true))}
        title={active ? "Team đang chạy 9 phòng. Bấm để gia hạn lease thêm 2 giờ (auto up --roles boost --hours 2)" : `${BOOST_COST} (auto up --roles boost --hours 2)`}
        className={cn(
          "font-semibold",
          active && "border-brand-ink/40 bg-brand/25 text-brand-ink hover:bg-brand/40 hover:text-brand-ink dark:border-brand/40 dark:bg-brand/15 dark:text-brand",
          className,
        )}
      >
        <ZapIcon aria-hidden className={cn(!active && "text-brand-ink dark:text-brand", busy != null && "motion-safe:animate-pulse")} />
        {busy != null ? "Đang bật…" : active ? "Đang Sấm Sét" : "Sấm Sét"}
      </Button>
      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bật Sấm Sét cho {name}?</DialogTitle>
            <DialogDescription>{BOOST_COST}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAsk(false)}>
              Thôi
            </Button>
            <Button
              type="button"
              onClick={() => {
                setAsk(false);
                void act(root, name, "boost");
              }}
            >
              <ZapIcon aria-hidden /> Mở 9 phòng
            </Button>
          </DialogFooter>
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
