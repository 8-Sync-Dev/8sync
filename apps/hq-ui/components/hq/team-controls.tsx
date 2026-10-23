"use client";

import { ChevronDownIcon, PlayIcon, PowerOffIcon, RefreshCwIcon, RocketIcon, SparklesIcon, SquareIcon, UsersIcon, ZapIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BOOST_ONLY, BOOST_TEAM, DEFAULT_TEAM, FULL_TEAM, teamText } from "@/lib/team-size";
import { cn } from "@/lib/utils";
import { ShipLoopChip } from "./ship-loop-chip";
import { makeApi } from "./use-hq";
import { sprintFor, type Sprint } from "@/lib/ship-fast";

type Action = "up" | "full" | "boost" | "unboost" | "clean" | "down" | "ship-fast" | "ship-fast-off" | "ship-ask";
type Result = { ok: boolean; output: string; error: string | null };

const DONE: Record<Action, string> = {
  "ship-fast": "Đã bật Ship tốc độ cao",
  "ship-fast-off": "Đã tắt Ship tốc độ cao",
  "ship-ask": "Đã nhắc lead hỏi Ship",
  up: "Đã mở team",
  full: "Đã mở team đầy đủ",
  boost: "Đã bật Sấm Sét",
  unboost: `Đã tắt Sấm Sét, về team ${DEFAULT_TEAM.length} phòng`,
  clean: "Đã dọn session rác, nạp bản mới và mở team",
  down: "Đã dừng team",
};
const OPENING: Record<Action, string> = {
  "ship-fast": "gửi brief ship nhanh cho mọi phòng",
  "ship-ask": "nhắc lead hỏi Ship ngay",
  "ship-fast-off": "",
  up: DEFAULT_TEAM.join(", "),
  full: teamText(FULL_TEAM),
  boost: `Sấm Sét, ${teamText(BOOST_TEAM)} mở lần lượt`,
  unboost: "",
  clean: "dọn rác, khởi động lại phòng chạy bản cũ",
  down: "",
};
const WAITING = (action: Action, name: string) =>
  action === "down"
    ? `Đang dừng team ${name}…`
    : action === "unboost"
      ? `Đang tắt Sấm Sét của ${name} (dừng ${BOOST_ONLY.join(", ")}, card đang giữ trả về cột)…`
      : action === "ship-fast"
        ? `Đang bật Ship tốc độ cao cho ${name}…`
        : action === "ship-fast-off"
          ? `Đang tắt Ship tốc độ cao của ${name}…`
          : action === "ship-ask"
            ? `Đang nhắc lead ${name} hỏi Ship…`
            : `Đang mở team ${name} (${OPENING[action]})…`;
const FAILED = (action: Action, name: string) => action === "down" ? `Không dừng được team ${name}` : action === "unboost" ? `Không tắt được Sấm Sét của ${name}` : action === "ship-fast" ? `Không bật được Ship tốc độ cao cho ${name}` : action === "ship-fast-off" ? `Không tắt được Ship tốc độ cao của ${name}` : `Không mở được team ${name}`;

/** What the confirm dialog of Sấm Sét says, in one sentence (also the button's tooltip). */
const BOOST_COST = `Sấm Sét = tăng nhân lực + Ship tốc độ cao 2 giờ (cả team land card gần xong trước). ${teamText(BOOST_TEAM)} chạy song song: thêm ${BOOST_ONLY.join(", ")} vào team thường; đội omp mặc định, lease 2 giờ.`;
/** What "Tắt Sấm Sét" does (`auto down --only <BOOST_ONLY>`, lib/team-size.ts). */
const UNBOOST_INFO = `Tắt Sấm Sét: về team ${teamText(DEFAULT_TEAM)}; dừng ${BOOST_ONLY.join(", ")}; card các phòng đó đang giữ trả về cột (building → ready, qa/review ở lại cột, bỏ claim). Lease giữ nguyên: hết giờ Sấm Sét thì cả team dừng như cũ (muốn chạy tiếp: Chạy liên tục). Gia hạn 2 giờ: giữ ${BOOST_TEAM.length} phòng thêm 2 giờ.`;

/**
 * The project's live team is the boost team: every Sấm Sét role alive and no `ui` room (that is
 * "Team đầy đủ", which also has dev2 and review). Any name token counts: omp rooms are `omp-<role>`,
 * `auto up` titles a clashing room `<name>-<repo>`, HQ rooms are `hq-<repo>-<name>`.
 */
export function boostOn(rooms: { name: string; label: string; status: string }[]): boolean {
  const live = rooms.filter((r) => r.status !== "ended");
  const tokens = new Set(live.flatMap((r) => `${r.label} ${r.name}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)));
  return BOOST_TEAM.every((r) => tokens.has(r)) && !tokens.has("ui");
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

/** The choices of an active Sấm Sét: turn it off (back to the default team), renew the lease, or nothing. */
export function BoostChoices({ onOff, onRenew, onCancel }: { onOff: () => void; onRenew: () => void; onCancel: () => void }) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Thôi
      </Button>
      <Button type="button" variant="outline" onClick={onRenew} title={`Giữ ${BOOST_TEAM.length} phòng thêm 2 giờ (auto up --roles boost --hours 2)`}>
        <RefreshCwIcon aria-hidden /> Gia hạn 2 giờ
      </Button>
      <Button type="button" onClick={onOff} title={`Về team ${teamText(DEFAULT_TEAM)} (auto down --only ${BOOST_ONLY.join(",")})`}>
        <PowerOffIcon aria-hidden /> Tắt Sấm Sét
      </Button>
    </DialogFooter>
  );
}

/**
 * "⚡ Sấm Sét": the 5-room boost team of one project (`auto up --roles boost --hours 2`). Off: asks
 * first. On (`active`, see boostOn): asks to turn it off (`unboost`, back to the 3-room team) or
 * renew the 2-hour lease with the same command.
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
        title={active ? `Sấm Sét (tăng nhân lực) đang chạy ${BOOST_TEAM.length} phòng. Bấm để gia hạn thêm 2 giờ hoặc tắt (về team ${DEFAULT_TEAM.length} phòng)` : `${BOOST_COST} (auto up --roles boost --hours 2). Muốn đẩy nhanh land/release: Ship tốc độ cao`}
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
            <DialogTitle>{active ? `Sấm Sét đang chạy ${BOOST_TEAM.length} phòng` : `Bật Sấm Sét cho ${name}?`}</DialogTitle>
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
                <ZapIcon aria-hidden /> Mở {BOOST_TEAM.length} phòng
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "🚀 Ship tốc độ cao" (owner 2026-10-21): the team lands work nearest-done first for 2 h. */
export function ShipFastButton({ root, name, token, after, className }: { root: string; name: string; token: string; after?: () => void; className?: string }) {
  const { busy, act } = useTeam(token, after);
  const [ask, setAsk] = useState(false);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void makeApi(token)<{ sprints: Sprint[] }>("/api/auto/loop")
        .then((r) => alive && setSprint(sprintFor(r.sprints ?? [], root)))
        .catch(() => {});
    load();
    const p = setInterval(load, 30_000);
    const c = setInterval(() => setNow(Math.round(Date.now() / 1000)), 30_000);
    return () => {
      alive = false;
      clearInterval(p);
      clearInterval(c);
    };
  }, [token, root]);
  const until = sprint?.until ?? null;
  const left = now > 0 && until != null && until > now ? Math.max(1, Math.round((until - now) / 60)) : until != null ? 0 : null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy != null}
        aria-busy={busy != null}
        onClick={() => setAsk(true)}
        title="Cả team dồn land card gần xong trước: review/qa dọn cột trước, builder không lấy card mới khi ≥ 3 card chờ qa/review/approved, lead hỏi Ship một chạm khi card approved. Không bỏ cổng nào (auto ship-fast on --hours 2)"
        className={cn("font-semibold", left != null && "border-brand-ink/40 bg-brand/25 text-brand-ink hover:bg-brand/40 hover:text-brand-ink dark:border-brand/40 dark:bg-brand/15 dark:text-brand", className)}
      >
        <RocketIcon aria-hidden className={cn(busy != null && "motion-safe:animate-pulse")} />
        {busy === "ship-fast" ? "Đang bật…" : busy === "ship-fast-off" ? "Đang tắt…" : left != null ? `Ship nhanh · ${left}′` : "Ship tốc độ cao"}
      </Button>
      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bật Ship tốc độ cao cho {name}?</DialogTitle>
            <DialogDescription>
              2 giờ: cả team land card gần xong trước (approved → review → qa → building); review/qa dọn cột mình trước; builder không lấy card tính năng mới khi ≥ 3 card chờ qa/review/approved; PR nhỏ, chạy lệnh kiểm + test trước khi push, CI xanh mới merge. Card approved: lead hỏi Ship để anh bấm — anh mới được merge/release. Hết giờ hoặc hết card thì 8sync báo anh.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAsk(false)}>
              Thôi
            </Button>
            {left != null ? (
              <Button type="button" variant="outline" onClick={() => { setAsk(false); void act(root, name, "ship-fast-off"); }}>
                <PowerOffIcon aria-hidden /> Tắt
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                setAsk(false);
                setNow(Math.round(Date.now() / 1000));
                void act(root, name, "ship-fast");
              }}
            >
              <RocketIcon aria-hidden /> Bật 2 giờ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Header buttons of a project that already has rooms: ship-fast / boost / resume / clean / stop. */
export function TeamControls({ root, name, token, boost = false, after }: { root: string; name: string; token: string; boost?: boolean; after?: () => void }) {
  const { busy, act } = useTeam(token, after);
  const [ask, setAsk] = useState<Action | null>(null);
  // Owner 2026-10-22 "ui ux khó hiểu": seven buttons on every project read as noise. The one action a
  // project needs most stays out; the team actions fold behind "Thao tác team" (same buttons, same dialogs).
  const [more, setMore] = useState(false);
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      <ShipLoopChip root={root} token={token} />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy != null}
        onClick={() => void act(root, name, "ship-ask")}
        title="Bảng approved đang chờ: lead hỏi anh một câu Ship (Duyệt tất cả / Chỉ merge / Dừng) ngay lượt này — anh bấm một phát là merge hết (auto ship-fast ship-ask)"
        className="font-semibold"
      >
        <RocketIcon aria-hidden /> Ship card approved
      </Button>
      {/* A live Sấm Sét runs the bigger team: it never hides behind the fold. */}
      {boost && <BoostButton root={root} name={name} token={token} active after={after} />}
      <Button type="button" size="sm" variant="ghost" aria-expanded={more} onClick={() => setMore((m) => !m)} title="Ship tốc độ cao, Sấm Sét, mở lại, dọn, team đầy đủ, dừng team">
        {more ? "Ẩn thao tác" : "Thao tác team"}
        <ChevronDownIcon aria-hidden className={more ? "rotate-180 transition-transform motion-reduce:transition-none" : "transition-transform motion-reduce:transition-none"} />
      </Button>
      {more && (
        <>
      <ShipFastButton root={root} name={name} token={token} after={after} />
      {!boost && <BoostButton root={root} name={name} token={token} active={false} after={after} />}
      <Button type="button" size="sm" variant="outline" disabled={busy != null} onClick={() => void act(root, name, "up")} title={`Mở phòng còn thiếu, nối lại phòng đã dừng: team ${teamText(DEFAULT_TEAM)}, đội omp mặc định (8sync ccc auto up)`}>
        <PlayIcon aria-hidden /> Mở lại team
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsk("clean")} title="Xoá session nền rác, khởi động lại phòng đang chạy bản cũ, rồi mở team (auto up --clear-ss)">
        <SparklesIcon aria-hidden /> Dọn & mở lại
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsk("full")} title={`${teamText(FULL_TEAM)}, 3 phòng code (auto up --roles full)`}>
        <UsersIcon aria-hidden /> Team đầy đủ
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsk("down")} title="Dừng các phòng nền, giữ hội thoại (auto down)">
        <SquareIcon aria-hidden /> Dừng team
      </Button>
        </>
      )}
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
              {ask === "down" ? "Dừng team" : ask === "full" ? `Mở ${FULL_TEAM.length} phòng` : "Dọn và mở lại"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One project with no room running: "Mở team" (`auto up`, the 3-room omp team, primary) then
 * "⚡ Sấm Sét" (`auto up --roles boost`, 5 rooms); `full` adds "Team đầy đủ", `children` follow as
 * secondary actions. The empty office puts these inside its card (owner 2026-10-23: a block below the
 * card sat under the fold behind the composer).
 */
export function TeamStartButtons({ path, name, token, after, full = false, children }: { path: string; name: string; token: string; after?: () => void; full?: boolean; children?: ReactNode }) {
  const { busy, act } = useTeam(token, after);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button type="button" size="sm" disabled={busy != null} onClick={() => void act(path, name, "up")} title="8sync ccc auto up: đội omp mặc định">
        <PlayIcon aria-hidden /> Mở team ({DEFAULT_TEAM.length} phòng: {DEFAULT_TEAM.join(", ")})
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy != null} onClick={() => void act(path, name, "boost")} title={`${BOOST_COST} (auto up --roles boost --hours 2)`} className="font-semibold">
        <ZapIcon aria-hidden className="text-brand-ink dark:text-brand" /> Sấm Sét ({BOOST_TEAM.length} phòng)
      </Button>
      {full && (
        <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => void act(path, name, "full")} title={`${teamText(FULL_TEAM)}, tốn quota gần gấp ${FULL_TEAM.length} lần một session`}>
          <UsersIcon aria-hidden /> Team đầy đủ
        </Button>
      )}
      {children}
    </div>
  );
}

/** Several projects with no room running (all projects in view): one row of team buttons each. */
export function TeamStarter({ projects, token, after, company = false }: { projects: { path: string; name: string }[]; token: string; after?: () => void; company?: boolean }) {
  if (!projects.length) return null;
  return (
    <section aria-labelledby="team-starter" className="space-y-2">
      <h2 id="team-starter" className="flex items-center gap-2 text-sm font-semibold">
        <UsersIcon aria-hidden className="size-4 text-muted-foreground" />
        {company ? "Dự án chưa có phòng riêng" : "Dự án chưa có team"}
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {projects.map((p) => (
          <li key={p.path} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground" title={p.path}>
                {p.path}
              </span>
            </span>
            <TeamStartButtons path={p.path} name={p.name} token={token} after={after} full={!company} />
          </li>
        ))}
      </ul>
    </section>
  );
}
