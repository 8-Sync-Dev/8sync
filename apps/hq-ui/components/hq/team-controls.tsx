"use client";

import { PlayIcon, SquareIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { makeApi } from "./use-hq";

type Action = "up" | "clean" | "down";
type Result = { ok: boolean; output: string; error: string | null };

const DONE: Record<Action, string> = { up: "Đã mở team", clean: "Đã dọn session rác và mở team", down: "Đã dừng team" };

/** POST /api/team and say what happened; `after` refreshes the office and the board. */
function useTeam(token: string, after?: () => void) {
  const [busy, setBusy] = useState<Action | null>(null);
  async function act(root: string, name: string, action: Action) {
    setBusy(action);
    const wait = toast.loading(action === "down" ? `Đang dừng team ${name}…` : `Đang mở team ${name} (lead, dev, qa, review)…`);
    try {
      const r = await makeApi(token)<Result>("/api/team", { method: "POST", body: { root, action } });
      toast.success(`${DONE[action]}: ${name}`, { id: wait, description: <pre className="mt-1 max-h-48 overflow-auto text-[11px] leading-snug whitespace-pre-wrap">{r.output}</pre> });
    } catch (e) {
      toast.error(`Không ${action === "down" ? "dừng" : "mở"} được team ${name}`, { id: wait, description: (e as Error).message });
    } finally {
      setBusy(null);
      after?.();
    }
  }
  return { busy, act };
}

/** Header buttons of a project that already has rooms: resume / clean and reopen / stop. */
export function TeamControls({ root, name, token, after }: { root: string; name: string; token: string; after?: () => void }) {
  const { busy, act } = useTeam(token, after);
  const [ask, setAsk] = useState<Action | null>(null);
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button type="button" size="sm" variant="outline" disabled={busy != null} onClick={() => void act(root, name, "up")} title="Mở phòng còn thiếu, nối lại phòng đã dừng (8sync ccc auto up)">
        <PlayIcon aria-hidden /> Mở lại team
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsk("clean")} title="Xoá session nền không thuộc phòng nào rồi mở team (auto up --clear-ss)">
        <SparklesIcon aria-hidden /> Dọn & mở lại
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy != null} onClick={() => setAsk("down")} title="Dừng các phòng nền, giữ hội thoại (auto down)">
        <SquareIcon aria-hidden /> Dừng team
      </Button>
      <Dialog open={ask != null} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ask === "down" ? `Dừng team ${name}?` : `Dọn session rác của ${name}?`}</DialogTitle>
            <DialogDescription>
              {ask === "down"
                ? "Các phòng nền (lead, dev, qa, review) dừng lại, hội thoại vẫn giữ. Bấm “Mở lại team” để chạy tiếp từ chỗ cũ."
                : "Xoá các session nền của dự án mà không phòng nào giữ, rồi mở lại team. Session có worktree còn thay đổi chưa commit được giữ lại, không mất code."}
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
              {ask === "down" ? "Dừng team" : "Dọn và mở lại"}
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
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Mở 4 phòng nền: lead viết card, dev làm, qa kiểm, review duyệt. Thêm thư mục khác ở mục Projects bên trái.</p>
    </section>
  );
}
