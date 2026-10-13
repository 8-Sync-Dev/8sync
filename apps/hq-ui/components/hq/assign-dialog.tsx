"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROLES, modelShort, type RoleId } from "@/lib/roles";
import { addressOf, messageTargets, sessionLabel } from "@/lib/labels";
import type { Hq } from "./use-hq";
import type { Message, Project, Session, Task } from "./types";

const PRIOS = ["P0", "P1", "P2", "P3"] as const;
type Target = `role:${string}` | `session:${string}`;

export type AssignDialogProps = {
  hq: Hq;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Session[];
  projects: Project[];
  /** Preselect a role, a session, or the project used when a role session must be started. */
  defaultRole?: RoleId;
  defaultSession?: string;
  defaultProjectId?: number | null;
};

type Res = { task: Task; session: string; started: boolean; message: Message; delivery: string; error: string | null };

/** Hand a task to a role (reuses or starts a session) or to one specific session. */
export function AssignDialog({ hq, open, onOpenChange, sessions, projects, defaultRole, defaultSession, defaultProjectId }: AssignDialogProps) {
  const live = sessions.filter((s) => s.tmux && s.status !== "ended");
  // Any live session HQ can reach (tmux or inbox) can take a task directly.
  const reach = messageTargets(sessions);
  // A project whose folder is gone cannot host a new session: never offer it.
  const usable = projects.filter((p) => !p.missing);
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [target, setTarget] = useState<Target>(defaultSession ? `session:${defaultSession}` : `role:${defaultRole ?? "fullstack"}`);
  const [prio, setPrio] = useState<string>("P2");
  const [projectId, setProjectId] = useState<string>(
    String(usable.find((p) => p.id === defaultProjectId)?.id ?? usable[0]?.id ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byRole = target.startsWith("role:");
  const role = ROLES.find((r) => `role:${r.id}` === target);
  const hasLive = byRole && live.some((s) => s.role === role?.id);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !subject.trim()) return;
    if (byRole && !hasLive && !projectId) return setError("Chưa có dự án nào còn thư mục: thêm thư mục dự án ở thanh bên trái trước.");
    setBusy(true);
    setError(null);
    try {
      const [kind, value] = [target.split(":")[0], target.slice(target.indexOf(":") + 1)];
      const body: Record<string, unknown> = { subject: subject.trim(), details: details.trim() || undefined, prio };
      if (kind === "session") body.session = value;
      else {
        body.role = value;
        if (projectId) body.project = Number(projectId);
      }
      const r = await hq.api<Res>("/api/tasks", { method: "POST", body });
      hq.mergeTasks([r.task]);
      if (r.message) hq.mergeMessages([r.message]);
      if (r.delivery === "failed") toast.error(`Đã lưu việc nhưng chưa gửi được: ${r.error}`);
      else {
        const s = sessions.find((x) => x.name === r.session || x.session_id === r.session);
        const who = s ? sessionLabel(s) : r.session.slice(0, 8);
        toast.success(`${r.started ? "Đã mở phiên mới và giao cho" : "Đã giao cho"} ${who}${r.delivery === "inbox" ? " qua inbox (nhận khi xong lượt)" : ""}`);
      }
      setSubject("");
      setDetails("");
      onOpenChange(false);
    } catch (err) {
      // Shown inside the dialog: a toast behind the modal is easy to miss.
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Giao việc</DialogTitle>
            <DialogDescription>Chọn một vai trò (dùng phiên đang chạy hoặc mở phiên mới) hoặc một phiên cụ thể.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-subject">Việc cần làm</Label>
            <Input id="assign-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} required autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-details">Chi tiết</Label>
            <Textarea id="assign-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={4} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-target">Giao cho</Label>
            <Select value={target} onValueChange={(v) => setTarget(v as Target)}>
              <SelectTrigger id="assign-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.id} value={`role:${r.id}`}>
                    {r.labelVi} · {modelShort(r.model)}
                  </SelectItem>
                ))}
                {reach.map((s) => (
                  <SelectItem key={s.name} value={`session:${addressOf(s)}`} className="text-xs">
                    Phiên {sessionLabel(s)}
                    {s.tmux ? "" : " · inbox"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {byRole && !hasLive && (
            <div className="grid gap-1.5">
              <Label htmlFor="assign-project">Chưa có phiên cho vai này — mở phiên mới trong dự án</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="assign-project" className="w-full">
                  <SelectValue placeholder="Dự án" />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="assign-prio">Ưu tiên</Label>
            <Select value={prio} onValueChange={setPrio}>
              <SelectTrigger id="assign-prio" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIOS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={busy || !subject.trim()}>
              {busy ? "Đang giao…" : "Giao việc"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
