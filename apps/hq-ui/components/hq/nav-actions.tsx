"use client";

// The sidebar's close / delete actions: a "⋯" menu on every project and room row, the confirm
// dialogs, and the list of closed projects. Server side: app/api/sessions/[name]/end,
// app/api/projects/sidebar, app/api/projects/worktree.
import { AlertTriangleIcon, ChevronRightIcon, EllipsisIcon, EyeIcon, EyeOffIcon, FolderIcon, PowerIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { closeDoneText, closeLines, closeTotal, ownWarning, type ClosePlan } from "@/lib/close-plan";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SIDEBAR_WORD, type HiddenProject, type SidebarGroup, type SidebarRoom } from "@/lib/sidebar";
import type { WorktreeFacts, WorktreeVerdict } from "@/lib/worktree";
import type { Hq } from "./use-hq";
import type { Room } from "./use-office";

export type RoomAction = "close" | "delete";
export type Confirm = { kind: "room"; x: SidebarRoom<Room>; action: RoomAction } | { kind: "worktree"; g: SidebarGroup<Room> } | { kind: "close"; g: SidebarGroup<Room> };

/** Row-end "⋯": on a mouse it shows on hover / keyboard focus / open menu; always on a phone or touch screen. */
const TRIGGER =
  "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-sidebar-accent data-[state=open]:opacity-100 disabled:cursor-wait motion-reduce:transition-none max-sm:size-11 max-sm:opacity-100 [@media(hover:none)]:opacity-100";

const ITEM = "max-sm:min-h-11";

/**
 * Project keys whose folder is a git worktree (GET /api/projects/sidebar), again when the groups
 * change. Never blocks the list: "Xóa worktree" shows once it is known.
 */
export function useWorktreeKeys(api: Hq["api"], keys: string) {
  const [data, setData] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    api<{ worktrees: string[] }>("/api/projects/sidebar", { signal: ac.signal })
      .then((r) => setData(r.worktrees))
      // Without it the menu only lacks "Xóa worktree"; the next group change asks again.
      .catch(() => {});
    return () => ac.abort();
  }, [api, keys, nonce]);
  return { worktrees: data, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export function ProjectMenu({ g, worktree, busy, onClose, onDelete }: { g: SidebarGroup<Room>; worktree: boolean; busy: boolean; onClose: () => void; onDelete: () => void }) {
  return (
    // Non-modal: the item opens a dialog, and a modal menu would hand focus back over it.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={TRIGGER} aria-label={`Thao tác với dự án ${g.name}`} disabled={busy}>
        <EllipsisIcon className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem className={ITEM} onSelect={onClose}>
          <PowerIcon aria-hidden />
          <span className="flex flex-col">
            Đóng dự án
            <span className="text-xs text-muted-foreground">Dừng hẳn mọi phòng, phiên và tiến trình của dự án rồi ẩn</span>
          </span>
        </DropdownMenuItem>
        {worktree && (
          <DropdownMenuItem className={ITEM} variant="destructive" onSelect={onDelete}>
            <Trash2Icon aria-hidden />
            Xóa worktree…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RoomMenu({ x, onPick }: { x: SidebarRoom<Room>; onPick: (a: RoomAction) => void }) {
  const omp = x.room.engine === "omp";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={TRIGGER} aria-label={`Thao tác với phòng ${x.room.label}`}>
        <EllipsisIcon className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {omp && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Phòng omp: dừng cả đội bằng “Dừng team” của dự án.</DropdownMenuLabel>}
        <DropdownMenuItem className={ITEM} disabled={omp} onSelect={() => onPick("close")}>
          <PowerIcon aria-hidden />
          <span className="flex flex-col">
            Đóng phòng…
            <span className="text-xs text-muted-foreground">Dừng, giữ hội thoại để mở lại</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} variant="destructive" disabled={omp} onSelect={() => onPick("delete")}>
          <Trash2Icon aria-hidden />
          Xóa phòng…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What a busy room loses when it stops now; null when it is quiet. */
function stateWarning(x: SidebarRoom<Room>): string | null {
  const s = x.now.state;
  if (s === "working") return "Phòng đang làm việc: dừng lúc này cắt ngang lượt đang chạy.";
  if (s === "needs") {
    const ask = x.room.ask;
    const what = ask?.kind === "question" ? ask.questions[0]?.question : ask?.kind === "permission" ? `xin quyền ${ask.tool}` : null;
    return `Phòng đang chờ anh${what ? ` (“${what.slice(0, 80)}”)` : ""}: dừng lúc này thì câu đó chưa ai trả lời.`;
  }
  if (s === "blocked") return "Phòng đang kẹt: việc dở dang giữ nguyên như lúc dừng.";
  if (s === "holding") return "Phòng đang giữ một card trên board.";
  return null;
}

export function RoomEndDialog({ hq, x, action, onDone, onCancel }: { hq: Hq; x: SidebarRoom<Room>; action: RoomAction; onDone: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { room } = x;
  const tmux = room.name.startsWith("hq-");
  const warn = stateWarning(x);
  const del = action === "delete";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await hq.api<{ registry: string | null; warning: string | null }>(`/api/sessions/${encodeURIComponent(room.name)}/end`, { method: "POST", body: { action } });
      if (r.warning) toast.warning(`Đã ${del ? "xóa" : "đóng"} phòng ${room.label}, nhưng: ${r.warning}`, { duration: 15_000 });
      else toast.success(del ? `Đã xóa phòng ${room.label}` : `Đã đóng phòng ${room.label}: hội thoại vẫn giữ`);
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(`Không ${del ? "xóa" : "đóng"} được phòng ${room.label}: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {del ? "Xóa" : "Đóng"} phòng {room.label}?
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {del
              ? tmux
                ? "Dừng phiên tmux của phòng và gỡ khỏi danh sách HQ. Hội thoại vẫn còn trong Claude Code."
                : "Dừng phòng, xóa session nền của nó khỏi Claude Code (kèm worktree riêng của phòng nếu có; worktree còn commit chưa push thì được giữ), gỡ phòng khỏi sổ phòng và xóa hội thoại (transcript) của phòng. Không khôi phục được."
              : tmux
                ? "Dừng phiên tmux của phòng. Hội thoại vẫn còn, mở lại được bằng claude --resume."
                : "Dừng phòng, giữ nguyên hội thoại. “Mở team” của dự án mở lại phòng, chạy tiếp từ chỗ dừng."}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Trạng thái</dt>
          <dd>{SIDEBAR_WORD[x.now.state]}</dd>
          {room.project && (
            <>
              <dt className="text-muted-foreground">Thư mục</dt>
              <dd className="font-mono break-all">
                {room.cwd ?? room.project.root}
              </dd>
            </>
          )}
        </dl>
        {warn && (
          <p className="flex items-start gap-2 rounded-lg bg-st-needs/15 px-2.5 py-2 text-xs text-[color-mix(in_oklch,var(--st-needs),black_45%)] dark:text-st-needs">
            <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            {warn}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="max-sm:h-11" onClick={onCancel} disabled={busy}>
            Giữ phòng
          </Button>
          <Button type="button" variant={del ? "destructive" : "default"} className="max-sm:h-11" onClick={submit} disabled={busy} autoFocus={!del}>
            {busy ? (del ? "Đang xóa…" : "Đang đóng…") : `${del ? "Xóa" : "Đóng"} phòng ${room.label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Check = { facts: WorktreeFacts; verdict: WorktreeVerdict };

export function WorktreeDialog({ hq, g, onDone, onCancel, onRoomsClosed }: { hq: Hq; g: SidebarGroup<Room>; onDone: () => void; onCancel: () => void; onRoomsClosed: () => void }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<"rooms" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    hq.api<Check>(`/api/projects/worktree?root=${encodeURIComponent(g.root)}`, { signal: ac.signal })
      .then((r) => {
        setCheck(r);
        setLoadError(null);
      })
      .catch((e: Error) => {
        if (!ac.signal.aborted) setLoadError(e.message);
      });
    return () => ac.abort();
  }, [hq, g.root, nonce]);

  const recheck = () => {
    setCheck(null);
    setLoadError(null);
    setNonce((n) => n + 1);
  };

  /** "Đóng N phòng": the live-room guard's way out, through the same close as the room menu. */
  async function closeRooms() {
    setBusy("rooms");
    setError(null);
    let failed = 0;
    for (const x of g.rooms) {
      try {
        await hq.api(`/api/sessions/${encodeURIComponent(x.room.name)}/end`, { method: "POST", body: { action: "close" } });
      } catch (e) {
        failed++;
        toast.error(`Không đóng được phòng ${x.room.label}: ${(e as Error).message}`);
      }
    }
    setBusy(null);
    if (!failed) toast.success(`Đã đóng ${g.rooms.length} phòng: hội thoại vẫn giữ`);
    onRoomsClosed();
    recheck();
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    try {
      await hq.api("/api/projects/worktree", { method: "POST", body: { root: g.root } });
      toast.success(`Đã xóa worktree ${g.name}`);
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(`Không xóa được worktree ${g.name}: ${msg}`);
      recheck();
    } finally {
      setBusy(null);
    }
  }

  const v = check?.verdict;
  const f = check?.facts;
  const roomsBlock = !!f && f.rooms.length > 0 && g.rooms.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Xóa worktree {g.name}?</DialogTitle>
          <DialogDescription className="text-pretty">
            Chạy <code className="font-mono text-xs whitespace-nowrap">git worktree remove</code> (không bao giờ <code className="font-mono text-xs whitespace-nowrap">--force</code>): thư mục worktree bị xóa, nhánh của nó vẫn giữ trong repo.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Thư mục</dt>
          <dd className="font-mono break-all">
            {g.root}
          </dd>
          {f?.branch && (
            <>
              <dt className="text-muted-foreground">Nhánh</dt>
              <dd className="truncate font-mono">{f.branch}</dd>
            </>
          )}
          {f?.main && (
            <>
              <dt className="text-muted-foreground">Repo chính</dt>
              <dd className="font-mono break-all">
                {f.main}
              </dd>
            </>
          )}
        </dl>
        <div aria-live="polite" className="min-h-10">
          {loadError ? (
            <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
              <span className="min-w-0 flex-1">Không kiểm tra được worktree: {loadError}</span>
              <Button size="sm" variant="outline" className="max-sm:h-11" onClick={recheck}>
                Kiểm tra lại
              </Button>
            </div>
          ) : !v ? (
            <div className="space-y-1.5" aria-busy="true" aria-label="Đang kiểm tra worktree">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          ) : v.ok ? (
            <p className="text-xs text-pretty">Sạch: không còn file chưa commit, mọi commit đã merge{f?.hasRemote ? " và đã push" : ""}, không phòng nào chạy trong đó.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium">HQ không xóa worktree này vì:</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-pretty">
                {v.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {roomsBlock && (
                <Button size="sm" variant="outline" className="max-sm:h-11" onClick={closeRooms} disabled={busy != null}>
                  <PowerIcon />
                  {busy === "rooms" ? "Đang đóng phòng…" : `Đóng ${g.rooms.length} phòng (giữ hội thoại)`}
                </Button>
              )}
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="max-sm:h-11" onClick={onCancel} disabled={busy != null}>
            Giữ worktree
          </Button>
          <Button type="button" variant="destructive" className="max-sm:h-11" onClick={remove} disabled={!v?.ok || busy != null}>
            {busy === "remove" ? "Đang xóa…" : `Xóa worktree ${g.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Đóng dự án": lists what stops (GET /api/projects/sidebar?root= runs `8sync ccc auto close
 * --dry-run`), then stops it all and hides the project. A close that fails hides nothing: the error
 * stays in the dialog with "Chỉ ẩn" (the old hide-only close) as the way out.
 */
export function CloseDialog({ hq, g, onHidden, onCancel }: { hq: Hq; g: SidebarGroup<Room>; onHidden: (row: HiddenProject | null) => void; onCancel: () => void }) {
  const [plan, setPlan] = useState<ClosePlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<"close" | "hide" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    hq.api<{ plan: ClosePlan }>(`/api/projects/sidebar?root=${encodeURIComponent(g.root)}`, { signal: ac.signal })
      .then((r) => {
        setPlan(r.plan);
        setLoadError(null);
      })
      .catch((e: Error) => {
        if (!ac.signal.aborted) setLoadError(e.message);
      });
    return () => ac.abort();
  }, [hq, g.root, nonce]);

  const recheck = () => {
    setPlan(null);
    setLoadError(null);
    setNonce((n) => n + 1);
  };

  async function submit(kill: boolean) {
    setBusy(kill ? "close" : "hide");
    setError(null);
    try {
      const r = await hq.api<{ hidden?: HiddenProject; close?: ClosePlan }>("/api/projects/sidebar", { method: "POST", body: { root: g.root, hidden: true, ...(kill ? { kill: true } : {}) } });
      toast.success(kill ? closeDoneText(g.name, r.close ?? null) : `Đã ẩn ${g.name} (không dừng gì): tự hiện lại khi có hoạt động mới`);
      onHidden(r.hidden ?? null);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(`Không ${kill ? "đóng" : "ẩn"} được ${g.name}: ${msg}`);
      // Part of it may have stopped: show what still runs.
      if (kill) recheck();
    } finally {
      setBusy(null);
    }
  }

  const warn = plan && ownWarning(plan);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Đóng dự án {g.name}?</DialogTitle>
          <DialogDescription className="text-pretty">
            Dừng hẳn mọi thứ của dự án đang chạy trên máy rồi ẩn khỏi danh sách (tự hiện lại khi có hoạt động mới). Hội thoại vẫn giữ: mở lại bằng “Mở team” hoặc{" "}
            <code className="font-mono text-xs whitespace-nowrap">8sync . &lt;tên&gt;</code>.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Thư mục</dt>
          <dd className="font-mono break-all">{g.root}</dd>
        </dl>
        <div aria-live="polite" className="min-h-24">
          {loadError ? (
            <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
              <span className="min-w-0 flex-1">Không xem được những gì sẽ dừng: {loadError}</span>
              <Button size="sm" variant="outline" className="max-sm:h-11" onClick={recheck}>
                Kiểm tra lại
              </Button>
            </div>
          ) : !plan ? (
            <div className="space-y-1.5" aria-busy="true" aria-label="Đang xem những gì sẽ dừng">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3.5 w-3/5" />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium">{closeTotal(plan) > 0 ? "Sẽ dừng:" : "Không còn gì chạy: chỉ bỏ dự án khỏi auto (nếu có) rồi ẩn."}</p>
              <ul className="space-y-1 text-xs">
                {closeLines(plan).map((l) => (
                  <li key={l.key} className={cn("flex items-baseline gap-2", l.n === 0 && "text-muted-foreground")}>
                    <span className="w-6 shrink-0 text-right font-semibold tabular">{l.n}</span>
                    <span className="shrink-0">{l.label}</span>
                    {l.detail && (
                      <span className="min-w-0 truncate font-mono text-muted-foreground" title={l.detail}>
                        {l.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {plan.skipped.length > 0 && <p className="text-xs text-pretty text-muted-foreground">Không đụng: {plan.skipped.map((s) => `${s.label} (${s.why})`).join(", ")}.</p>}
            </div>
          )}
        </div>
        {warn && (
          <p className="flex items-start gap-2 rounded-lg bg-st-needs/15 px-2.5 py-2 text-xs text-[color-mix(in_oklch,var(--st-needs),black_45%)] dark:text-st-needs">
            <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            {warn}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-pretty text-destructive">
            {error}
          </p>
        )}
        {(error || loadError) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 text-pretty">Không dừng được: vẫn có thể chỉ ẩn dự án, mọi thứ tiếp tục chạy.</span>
            <Button size="sm" variant="outline" className="max-sm:h-11" onClick={() => void submit(false)} disabled={busy != null}>
              <EyeOffIcon />
              {busy === "hide" ? "Đang ẩn…" : "Chỉ ẩn"}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="max-sm:h-11" onClick={onCancel} disabled={busy != null}>
            Huỷ
          </Button>
          <Button type="button" variant="destructive" className="max-sm:h-11" onClick={() => void submit(true)} disabled={!plan || busy != null}>
            <PowerIcon />
            {busy === "close" ? "Đang dừng…" : "Dừng hẳn & đóng"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Hiện dự án đã đóng (N)": the closed projects that still have rooms, each with "Hiện lại". */
export function ClosedProjects({ closed, busy, onShow }: { closed: SidebarGroup<Room>[]; busy: string | null; onShow: (g: SidebarGroup<Room>) => void }) {
  const [open, setOpen] = useState(false);
  if (!closed.length) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:h-11"
        aria-expanded={open}
        aria-controls="closed-projects"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        <span className="flex-1">{open ? "Ẩn" : "Hiện"} dự án đã đóng ({closed.length})</span>
      </button>
      <ul id="closed-projects" hidden={!open} className="mt-0.5 space-y-0.5">
        {closed.map((g) => (
          <li key={g.key} className="flex h-8 items-center gap-1.5 pr-0.5 pl-2 max-sm:h-11">
            <FolderIcon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={g.root}>
              {g.name}
            </span>
            <span className="tabular text-xs text-muted-foreground">{g.rooms.length}</span>
            <Button size="xs" variant="ghost" className="max-sm:h-11" onClick={() => onShow(g)} disabled={busy === g.key} aria-label={`Hiện lại dự án ${g.name}`}>
              <EyeIcon />
              {busy === g.key ? "Đang hiện…" : "Hiện lại"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
