"use client";

import { ArrowRightIcon, CheckIcon, FolderIcon, InboxIcon, SparklesIcon, TerminalSquareIcon, UserIcon, UsersIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { assignSummary, distinctLabels, groupTargets, outsideRole, projectTargets, roleTargets, type AssignMode, type RoomLike } from "@/lib/assign";
import { addressOf, deliveryOf, sessionLabel } from "@/lib/labels";
import { ROLES, modelShort, type RoleId } from "@/lib/roles";
import { EVERY_HOURS, EVERY_MINUTES, RD_DUTY, scheduleLabel, type Schedule } from "@/lib/schedule";
import { STATUS_LABEL, StatusDot } from "./bits";
import { RoleIcon } from "./role-badge";
import type { Hq } from "./use-hq";
import type { Message, Project, Session, Task } from "./types";

const PRIOS = [
  ["P0", "Khẩn"],
  ["P1", "Cao"],
  ["P2", "Thường"],
  ["P3", "Thấp"],
] as const;
/** "Khi nào": now, once at HH:MM, daily at HH:MM, or every N minutes/hours (`m:30`, `h:2`). */
const WHEN_EVERY = [...EVERY_MINUTES.map((n) => `m:${n}`), ...EVERY_HOURS.map((n) => `h:${n}`)];
const MODES: { id: AssignMode; label: string; icon: typeof UserIcon; hint: string }[] = [
  { id: "session", label: "Một phiên", icon: UserIcon, hint: "Đúng phiên bạn chọn, kể cả phiên bạn tự mở ngoài HQ." },
  { id: "role", label: "Theo vai trò", icon: SparklesIcon, hint: "HQ tìm phiên đang chạy có vai này; chưa có thì mở phiên mới." },
  { id: "project", label: "Cả dự án", icon: UsersIcon, hint: "Mọi phiên đang chạy trong dự án cùng nhận một bản." },
];

function toSchedule(when: string, at: string): Schedule | null {
  if (when === "once" || when === "daily") return { kind: when, at };
  if (when.startsWith("m:") || when.startsWith("h:")) return { kind: "every", n: Number(when.slice(2)), unit: when[0] as "m" | "h" };
  return null;
}

export type AssignDialogProps = {
  hq: Hq;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Session[];
  projects: Project[];
  /** Office rooms (`/api/office`): sessions outside registered projects are grouped by the git folder they report. */
  rooms?: RoomLike[];
  /** Preselect a role, a session, or the project used when a role session must be started. */
  defaultRole?: RoleId;
  defaultSession?: string;
  defaultProjectId?: number | null;
};

type Res = { task: Task; session: string; started: boolean; message: Message; delivery: string; error: string | null };

/** Hand a task to one session, to whoever has a role (reuse or start a session), or to every session of a project. */
export function AssignDialog({ hq, open, onOpenChange, sessions, projects, rooms, defaultRole, defaultSession, defaultProjectId }: AssignDialogProps) {
  // A project whose folder is gone cannot host a new session: never offer it.
  const usable = projects.filter((p) => !p.missing);
  const groups = groupTargets(sessions, projects, rooms);
  const labels = distinctLabels(groups.flatMap((g) => g.sessions));
  const labelOf = (s: Session) => labels.get(addressOf(s)) ?? sessionLabel(s);
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [mode, setMode] = useState<AssignMode>(defaultSession ? "session" : defaultRole != null || groups.length === 0 ? "role" : "session");
  const [session, setSession] = useState<string>(defaultSession ?? "");
  const [role, setRole] = useState<RoleId>(defaultRole ?? "fullstack");
  const [prio, setPrio] = useState<string>("P2");
  const [when, setWhen] = useState<string>("now");
  const [at, setAt] = useState<string>("09:03");
  const [projectId, setProjectId] = useState<string>(
    String(usable.find((p) => p.id === defaultProjectId)?.id ?? usable[0]?.id ?? ""),
  );
  // "Cả dự án": the scope's project, or every project when HQ shows Everything.
  const [fanProject, setFanProject] = useState<string>(defaultProjectId != null ? String(defaultProjectId) : "all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = groups.flatMap((g) => g.sessions).find((s) => addressOf(s) === session);
  // The summary names the session the way the list does ("rd · 1a2b3c4d" when two rooms are called rd).
  const picked = found ? { ...found, label: labelOf(found) } : null;
  const roleLive = roleTargets(role, sessions);
  const project = usable.find((p) => String(p.id) === projectId) ?? null;
  const fan = projects.find((p) => String(p.id) === fanProject) ?? null;
  const fanOut = projectTargets(fan?.id ?? null, sessions);
  const roleOutside = outsideRole(role, sessions);
  const summary = assignSummary({ mode, session: picked, role, roleSessions: roleLive, project: mode === "project" ? fan : project, projectSessions: fanOut });
  const ready =
    subject.trim().length > 0 &&
    (mode === "session" ? picked != null : mode === "role" ? roleLive.length > 0 || project != null : fanOut.length > 0);

  async function post(body: Record<string, unknown>): Promise<Res> {
    const r = await hq.api<Res>("/api/tasks", { method: "POST", body });
    hq.mergeTasks([r.task]);
    if (r.message) hq.mergeMessages([r.message]);
    return r;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const schedule = toSchedule(when, at);
    const base: Record<string, unknown> = { subject: subject.trim(), details: details.trim() || undefined, prio, schedule: schedule ?? undefined };
    const plan = schedule ? ` · đã nhờ phiên lên lịch ${scheduleLabel(schedule)} (chưa xác nhận: xem câu trả lời của phiên)` : "";
    try {
      if (mode === "project") {
        // One task row per session, sent one after another so a 409 (dialog open) names the session.
        const failed: string[] = [];
        for (const s of fanOut) {
          try {
            const r = await post({ ...base, session: addressOf(s) });
            if (r.delivery === "failed") failed.push(`${sessionLabel(s)}: ${r.error}`);
          } catch (err) {
            failed.push(`${sessionLabel(s)}: ${(err as Error).message}`);
          }
        }
        const ok = fanOut.length - failed.length;
        if (failed.length) toast.error(`Đã giao cho ${ok}/${fanOut.length} phiên. Chưa gửi được: ${failed.join("; ")}`);
        else toast.success(`Đã giao cho ${ok} phiên${fan ? ` trong ${fan.name}` : ""}${plan}`);
      } else {
        const body = mode === "session" ? { ...base, session } : { ...base, role, ...(project ? { project: project.id } : {}) };
        const r = await post(body);
        if (r.delivery === "failed") toast.error(`Đã lưu việc nhưng chưa gửi được: ${r.error}`);
        else {
          const s = sessions.find((x) => x.name === r.session || x.session_id === r.session);
          const who = s ? sessionLabel(s) : r.session.slice(0, 8);
          toast.success(`${r.started ? "Đã mở phiên mới và giao cho" : "Đã giao cho"} ${who}${r.delivery === "inbox" ? " qua inbox (nhận khi xong lượt)" : ""}${plan}`);
        }
      }
      setSubject("");
      setDetails("");
      setWhen("now");
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Giao việc</DialogTitle>
            <DialogDescription>Việc được gõ thẳng vào phiên nhận; phiên mở ngoài HQ nhận qua inbox khi xong lượt.</DialogDescription>
          </DialogHeader>

          <Section title="Việc">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="assign-subject">Việc cần làm</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => {
                    setSubject(RD_DUTY.subject);
                    setDetails(RD_DUTY.details);
                    setMode("role");
                    setRole("rd");
                    setWhen(`m:${RD_DUTY.schedule.n}`);
                  }}
                >
                  Dùng mẫu: R&amp;D trực (mỗi 30 phút)
                </button>
              </div>
              <Input id="assign-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} required autoFocus placeholder="Ví dụ: Viết test cho API /tasks" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="assign-details">
                Chi tiết <span className="font-normal text-muted-foreground">(file, lệnh kiểm, tiêu chí xong — tuỳ chọn)</span>
              </Label>
              <Textarea id="assign-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={3} />
            </div>
          </Section>

          <Section title="Giao cho">
            <div role="group" aria-label="Cách giao" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={mode === m.id}
                  title={m.hint}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "flex h-8 items-center justify-center gap-1.5 rounded-md text-sm transition-colors",
                    mode === m.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <m.icon aria-hidden className="size-3.5" />
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{MODES.find((m) => m.id === mode)?.hint}</p>

            {mode === "session" &&
              (groups.length === 0 ? (
                <Empty>Chưa có phiên nào đang chạy. Chọn «Theo vai trò» để HQ mở phiên mới.</Empty>
              ) : (
                <div role="group" aria-label="Phiên nhận việc" className="max-h-56 overflow-y-auto rounded-lg border">
                  {groups.map((g) => (
                    <div key={g.name}>
                      <div className="flex items-center gap-1.5 bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        <FolderIcon aria-hidden className="size-3" /> {g.name}
                      </div>
                      {g.sessions.map((s) => {
                        const id = addressOf(s);
                        const on = id === session;
                        return (
                          <button
                            key={id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setSession(id)}
                            className={cn(
                              "flex w-full items-center gap-2 border-l-2 border-transparent px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/50",
                              on && "border-primary bg-primary/15 text-foreground",
                            )}
                          >
                            <StatusDot status={s.status} />
                            <span className="min-w-0 flex-1 truncate font-medium">{labelOf(s)}</span>
                            {s.role && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <RoleIcon role={s.role} /> {ROLES.find((r) => r.id === s.role)?.labelVi ?? s.role}
                              </span>
                            )}
                            <span className="inline-flex w-20 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground" title={STATUS_LABEL[s.status]}>
                              {deliveryOf(s) === "inbox" ? <InboxIcon aria-hidden className="size-3" /> : <TerminalSquareIcon aria-hidden className="size-3" />}
                              {deliveryOf(s) === "inbox" ? "inbox" : "terminal"}
                            </span>
                            <CheckIcon aria-hidden className={cn("size-3.5 shrink-0 text-primary", !on && "invisible")} />
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}

            {mode === "role" && (
              <>
                <div role="group" aria-label="Vai trò" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {ROLES.map((r) => {
                    const live = roleTargets(r.id, sessions).length;
                    const on = role === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setRole(r.id)}
                        className={cn(
                          "flex flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-muted/50",
                          on ? "border-primary bg-primary/10" : "border-border",
                        )}
                      >
                        <span className="inline-flex items-center gap-1 text-sm font-medium">
                          <RoleIcon role={r.id} /> {r.labelVi.replace(/ \(.*\)$/, "")}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {modelShort(r.model)} · {live ? `${live} đang chạy` : "mở mới"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {roleOutside.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {roleOutside.map(sessionLabel).join(", ")} cũng mang vai này nhưng mở ngoài HQ: giao thẳng ở «Một phiên».
                  </p>
                )}
                {roleLive.length === 0 && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="assign-project">Mở phiên mới trong dự án</Label>
                    {usable.length === 0 ? (
                      <Empty>Chưa có dự án nào còn thư mục: thêm thư mục dự án ở thanh bên trái trước.</Empty>
                    ) : (
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
                    )}
                  </div>
                )}
              </>
            )}

            {mode === "project" && (
              <div className="grid gap-1.5">
                <Label htmlFor="assign-fan">Dự án</Label>
                <Select value={fanProject} onValueChange={setFanProject}>
                  <SelectTrigger id="assign-fan" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Mọi dự án ({projectTargets(null, sessions).length} phiên)</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} ({projectTargets(p.id, sessions).length} phiên)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fanOut.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {fanOut.map((s) => (
                      <li key={addressOf(s)} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs">
                        <StatusDot status={s.status} /> {labelOf(s)}
                        {s.role && <RoleIcon role={s.role} className="text-muted-foreground" />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Section>

          <Section title="Ưu tiên · Khi nào">
            <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
              <div role="group" aria-label="Ưu tiên" className="flex gap-1">
                {PRIOS.map(([p, label]) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={prio === p}
                    title={label}
                    onClick={() => setPrio(p)}
                    className={cn(
                      "h-8 min-w-11 rounded-lg border px-2 text-sm tabular-nums transition-colors hover:bg-muted/50",
                      prio === p ? "border-primary bg-primary/10 font-medium" : "border-border text-muted-foreground",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Select value={when} onValueChange={setWhen}>
                  <SelectTrigger id="assign-when" aria-label="Khi nào" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="now">Ngay bây giờ</SelectItem>
                    <SelectItem value="once">Một lần, lúc…</SelectItem>
                    <SelectItem value="daily">Hằng ngày, lúc…</SelectItem>
                    {WHEN_EVERY.map((w) => (
                      <SelectItem key={w} value={w}>
                        Lặp mỗi {w.slice(2)} {w[0] === "m" ? "phút" : "giờ"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(when === "once" || when === "daily") && (
                  <Input aria-label="Giờ (giờ máy)" type="time" value={at} onChange={(e) => setAt(e.target.value)} required className="w-28 shrink-0" />
                )}
              </div>
            </div>
            {when !== "now" && (
              <p className="text-xs text-muted-foreground">
                Phiên tự lên lịch bằng CronCreate của Claude Code, theo giờ máy chạy phiên: chạy giữa các lượt khi phiên còn mở, lịch lặp trễ tối đa nửa chu kỳ và hết hạn sau 7 ngày; giờ đã qua thì chạy ngày mai. Bỏ lượt khi phiên đang bận hoặc (login subscription) bạn vắng quá 30 phút.
              </p>
            )}
          </Section>

          <p aria-live="polite" className={cn("flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-sm", ready ? "border-primary/40 bg-primary/5" : "text-muted-foreground")}>
            <ArrowRightIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{summary || "Chọn nơi nhận việc."}</span>
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Huỷ
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy ? "Đang giao…" : mode === "project" ? `Giao cho ${fanOut.length} phiên` : "Giao việc"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2.5">
      <legend className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground">{children}</p>;
}
