"use client";

// "Bot mới" (su-code/research/hq-bots-groups.md §1): one sheet, top to bottom — template → folder → name →
// first message — then "Tạo và gửi" or "Chỉ tạo". A Claude Code template starts an hq-* session
// (POST /api/sessions, role from the template); an omp one creates an omp session (POST /api/omp/sessions)
// and opens its terminal once on the server so it runs. Rules and request bodies: lib/templates.ts.
import { CheckIcon, FolderGit2Icon, FolderOpenIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { folderName, pathKey, shortPath, type WsProject } from "@/lib/omp-workspace";
import { roleOf } from "@/lib/roles";
import {
  BLANK_TEMPLATE_ID,
  BUILT_IN_TEMPLATES,
  botKeyOf,
  createRequest,
  nameProblem,
  orderFolders,
  suggestName,
  type BotTemplate,
  type TemplateColor,
} from "@/lib/templates";
import { cn } from "@/lib/utils";
import type { Hq } from "../use-hq";
import { ProjectPicker } from "../workspace-launcher";

/** Static classes per template color (Tailwind only ships what it sees written out). */
export const TEMPLATE_TINT: Record<TemplateColor, string> = {
  slate: "bg-slate-500/12 ring-slate-500/25",
  sky: "bg-sky-500/12 ring-sky-500/25",
  amber: "bg-amber-500/12 ring-amber-500/25",
  lime: "bg-lime-500/12 ring-lime-500/25",
  violet: "bg-violet-500/12 ring-violet-500/25",
  indigo: "bg-indigo-500/12 ring-indigo-500/25",
  rose: "bg-rose-500/12 ring-rose-500/25",
  orange: "bg-orange-500/12 ring-orange-500/25",
  emerald: "bg-emerald-500/12 ring-emerald-500/25",
  cyan: "bg-cyan-500/12 ring-cyan-500/25",
  fuchsia: "bg-fuchsia-500/12 ring-fuchsia-500/25",
  teal: "bg-teal-500/12 ring-teal-500/25",
};

/** Folders shown before "Xem tất cả". */
const FOLDERS_SHOWN = 6;

type Folder = { path: string; name: string; id: number | null; lastUsed: number | null };

/** Arrow keys move between the radios of a group (one tab stop per group), as a native radio group does. */
function radioKeys(e: KeyboardEvent<HTMLElement>) {
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = radios.indexOf(document.activeElement as HTMLElement);
  const next = radios[(i + step + radios.length) % radios.length];
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.click();
}

export function NewBotSheet({
  hq,
  open,
  onOpenChange,
  initialTemplate,
  onCreated,
}: {
  hq: Hq;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template picked when it opens (an empty-state card); "Trống" otherwise. */
  initialTemplate?: string | null;
  /** The new bot's key in the Bots list. */
  onCreated: (key: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex h-[min(46rem,92dvh)] flex-col gap-0 p-0 sm:max-w-2xl max-sm:inset-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:ring-0"
      >
        {/* Mounted only while open: every opening starts fresh. */}
        {open && <NewBotForm hq={hq} initialTemplate={initialTemplate ?? null} onDone={(key) => {
          onOpenChange(false);
          onCreated(key);
        }} />}
      </DialogContent>
    </Dialog>
  );
}

function NewBotForm({ hq, initialTemplate, onDone }: { hq: Hq; initialTemplate: string | null; onDone: (key: string) => void }) {
  const uid = useId();
  const [templates, setTemplates] = useState<BotTemplate[]>(BUILT_IN_TEMPLATES as BotTemplate[]);
  const [tab, setTab] = useState<"builtin" | "mine">("builtin");
  const [templateId, setTemplateId] = useState(initialTemplate ?? BLANK_TEMPLATE_ID);
  const [folder, setFolder] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const [allFolders, setAllFolders] = useState(false);
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [message, setMessage] = useState("");
  const [worktree, setWorktree] = useState(false);
  const [busy, setBusy] = useState<null | "send" | "create">(null);
  const [error, setError] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // A phone scrolls the templates sideways: bring the one picked on opening (an empty-state card) into view.
  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  const api = hq.api;
  useEffect(() => {
    let live = true;
    api<{ templates: BotTemplate[] }>("/api/templates")
      .then((r) => live && setTemplates(r.templates))
      .catch(() => {
        // The built-in list is already shown; the owner's own ones just stay hidden.
      });
    return () => {
      live = false;
    };
  }, [api]);

  const mine = templates.filter((t) => !t.builtIn);
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const shownTemplates = tab === "mine" ? mine : templates.filter((t) => t.builtIn);

  // Registered projects (most recently used first), the known repos that match the hint, and a folder picked by hand.
  const sessions = hq.sessions.data;
  const folders = useMemo(() => {
    const used = new Map<number, number>();
    for (const s of sessions) if (s.project_id != null && s.started_at != null) used.set(s.project_id, Math.max(used.get(s.project_id) ?? 0, s.started_at));
    const list: Folder[] = hq.projects.data.filter((p) => !p.missing).map((p) => ({ path: p.path, name: p.name, id: p.id, lastUsed: used.get(p.id) ?? null }));
    const seen = new Set(list.map((p) => pathKey(p.path)));
    for (const k of hq.knownProjects) if (!seen.has(pathKey(k.path))) list.push({ path: k.path, name: k.name, id: null, lastUsed: null });
    const ordered = orderFolders(list, template?.folderHint).filter((f) => f.id != null || f.hinted);
    if (other && !ordered.some((f) => pathKey(f.path) === pathKey(other))) ordered.unshift({ path: other, name: folderName(other), id: null, lastUsed: null, hinted: false });
    return ordered;
  }, [hq.projects.data, hq.knownProjects, sessions, template?.folderHint, other]);
  const picked = folders.find((f) => folder != null && pathKey(f.path) === pathKey(folder)) ?? null;
  // The first folder (the hint's, else the latest used) is chosen until the owner picks one.
  const chosen = picked ?? folders[0] ?? null;
  const shownFolders = allFolders ? folders : folders.slice(0, FOLDERS_SHOWN);
  // `chosen` is always in `folders`, so this only ever touches the slice.
  if (chosen && !shownFolders.includes(chosen)) shownFolders.push(chosen);
  const hintMissing = !!template?.folderHint && !folders.some((f) => f.hinted);

  // Names of live bots: hq-* sessions without the prefix, omp sessions by their name.
  const taken = useMemo(() => sessions.filter((s) => s.status !== "ended").flatMap((s) => [s.name.replace(/^hq-/, ""), s.label]), [sessions]);
  const suggested = template && chosen ? suggestName(template.id, chosen.name, taken) : "";
  const botName = nameTouched ? name : suggested;
  const problem = template ? nameProblem(botName, template.engine, taken) : null;
  const pickerList: WsProject[] = useMemo(
    () => [...hq.projects.data.map((p) => ({ path: p.path, name: p.name })), ...hq.knownProjects.map((k) => ({ path: k.path, name: k.name }))],
    [hq.projects.data, hq.knownProjects],
  );

  const canCreate = !!template && !!chosen && !problem && !busy;

  async function create(send: boolean, e?: FormEvent) {
    e?.preventDefault();
    if (!template || !chosen || problem || busy) return;
    if (send && !message.trim()) {
      setError("Viết tin nhắn đầu, hoặc bấm “Chỉ tạo”.");
      messageRef.current?.focus();
      return;
    }
    setBusy(send ? "send" : "create");
    setError(null);
    try {
      let id = chosen.id;
      // Claude Code runs only in a registered project: a folder picked by hand is registered first.
      if (template.engine === "claude" && id == null) {
        const r = await hq.api<{ project: { id: number } }>("/api/projects", { method: "POST", body: { path: chosen.path } });
        id = r.project.id;
        void hq.reload.projects();
      }
      const req = createRequest({ template, name: botName, project: { id, path: chosen.path }, message, send, worktree });
      const res = await hq.api<{ id?: string; session?: { name?: string } }>(req.url, { method: "POST", body: req.body });
      const key = botKeyOf(req, res);
      // An omp session runs once its terminal opens: open it once here (it keeps running after this poll).
      if (req.url === "/api/omp/sessions" && key) {
        await hq.api(`/api/sessions/${encodeURIComponent(key)}/term?cols=120&rows=32&gen=-1&since=0`).catch((x: Error) => {
          toast.error(`Đã tạo ${req.body.name} nhưng chưa mở được: ${x.message}. Mở nó trong Không gian.`);
        });
      }
      toast.success(`Đã tạo bot ${botName}`);
      void hq.reload.sessions();
      if (key) onDone(key);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const engineLabel = template?.engine === "omp" ? "omp" : `Claude Code${template?.role ? ` · ${roleOf(template.role)?.labelVi ?? template.role}` : ""}`;

  return (
    <>
    <form onSubmit={(e) => create(true, e)} className="flex min-h-0 flex-1 flex-col" aria-busy={busy != null}>
      <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-4 max-sm:px-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))]">
        <DialogTitle className="text-base">Bot mới</DialogTitle>
        <DialogDescription className="text-pretty">Mỗi bot là một phiên làm việc trong một thư mục. Chọn mẫu, chọn thư mục, rồi giao việc đầu tiên.</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 max-sm:px-4">
        {/* 1. Template */}
        <section aria-labelledby={`${uid}-tpl`} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id={`${uid}-tpl`} className="text-sm font-semibold">
              <span className="mr-1.5 text-muted-foreground tabular">1</span>Mẫu
            </h3>
            <div role="group" aria-label="Loại mẫu" className="inline-flex rounded-lg bg-muted p-0.5">
              {(
                [
                  ["builtin", "Mẫu"],
                  ["mine", `Của tôi${mine.length ? ` ${mine.length}` : ""}`],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={tab === v}
                  onClick={() => setTab(v)}
                  className="h-7 rounded-md px-3 text-xs font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm motion-reduce:transition-none max-md:h-9"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shownTemplates.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-pretty text-muted-foreground">
              Chưa có mẫu riêng. Thêm file JSON vào <code className="font-mono text-xs">~/.config/8sync/hq/templates/</code>, mỗi file một mẫu.
            </p>
          ) : (
            // A card gallery (owner 2026-11-07, Grok Bot style): two columns on a phone, three from 640 px.
            <div
              ref={gridRef}
              role="radiogroup"
              aria-labelledby={`${uid}-tpl`}
              onKeyDown={radioKeys}
              className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-3"
            >
              {shownTemplates.map((t) => {
                const on = t.id === template?.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on || (!shownTemplates.some((x) => x.id === template?.id) && t === shownTemplates[0]) ? 0 : -1}
                    onClick={() => {
                      setTemplateId(t.id);
                      setFolder(null);
                    }}
                    className={cn(
                      "group relative flex min-h-[5.5rem] flex-col items-start gap-1.5 rounded-xl border bg-card p-3 text-left outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
                      on && "border-foreground/70 ring-1 ring-foreground/70",
                    )}
                  >
                    <span aria-hidden className={cn("grid size-8 place-items-center rounded-lg text-base ring-1", TEMPLATE_TINT[t.color])}>
                      {t.emoji}
                    </span>
                    <span className="text-sm leading-tight font-medium">{t.name}</span>
                    <span className="line-clamp-2 text-xs leading-snug text-pretty text-muted-foreground">{t.purpose}</span>
                    {on && <CheckIcon aria-hidden className="absolute top-2.5 right-2.5 size-4" />}
                  </button>
                );
              })}
            </div>
          )}
          {template && (
            <p className="text-xs text-muted-foreground">
              Chạy bằng <span className="font-medium text-foreground">{engineLabel}</span>
              {template.skills.length > 0 && <> · nhắc nạp {template.skills.join(", ")}</>}
            </p>
          )}
        </section>

        {/* 2. Folder */}
        <section aria-labelledby={`${uid}-dir`} className="space-y-3">
          <h3 id={`${uid}-dir`} className="text-sm font-semibold">
            <span className="mr-1.5 text-muted-foreground tabular">2</span>Thư mục
          </h3>
          {hintMissing && (
            <p className="text-xs text-pretty text-muted-foreground">
              Chưa thấy thư mục <code className="font-mono">{template?.folderHint}</code> trên máy. Chọn tay hoặc dùng mẫu khác.
            </p>
          )}
          {folders.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed px-4 py-5 text-sm">
              <p className="text-muted-foreground">Chưa có dự án nào. Chọn một thư mục trên máy để bắt đầu.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)} className="max-md:h-11">
                <FolderOpenIcon aria-hidden /> Chọn thư mục
              </Button>
            </div>
          ) : (
            <>
              <div role="radiogroup" aria-labelledby={`${uid}-dir`} onKeyDown={radioKeys} className="space-y-1">
                {shownFolders.map((f) => {
                  const on = chosen === f;
                  return (
                    <button
                      key={f.path}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on ? 0 : -1}
                      title={f.path}
                      onClick={() => setFolder(f.path)}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none max-md:min-h-12",
                        on && "border-border bg-accent",
                      )}
                    >
                      <FolderGit2Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{f.name}</span>
                          {f.hinted && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
                              <SparklesIcon aria-hidden className="size-3" /> Gợi ý
                            </span>
                          )}
                        </span>
                        <span className="block truncate font-mono text-[11px] leading-4 text-muted-foreground [direction:rtl]">
                          <bdi>{shortPath(f.path, null)}</bdi>
                        </span>
                      </span>
                      {on && <CheckIcon aria-hidden className="size-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                {folders.length > FOLDERS_SHOWN && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAllFolders((v) => !v)} className="max-md:h-11">
                    {allFolders ? "Thu gọn" : `Xem tất cả (${folders.length})`}
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(true)} className="max-md:h-11">
                  <FolderOpenIcon aria-hidden /> Thư mục khác…
                </Button>
              </div>
            </>
          )}
          {template?.engine === "omp" && (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm max-md:min-h-11">
              <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} className="size-4 accent-foreground" />
              Worktree riêng <span className="text-xs text-muted-foreground">(nhánh git riêng cho bot)</span>
            </label>
          )}
        </section>

        {/* 3. Name */}
        <section className="space-y-2">
          <label htmlFor={`${uid}-name`} className="block text-sm font-semibold">
            <span className="mr-1.5 text-muted-foreground tabular">3</span>Tên
          </label>
          <Input
            id={`${uid}-name`}
            value={botName}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value.toLowerCase());
            }}
            aria-invalid={!!problem && botName !== ""}
            aria-describedby={`${uid}-name-help`}
            className="h-9 font-mono text-[13px] max-md:h-11 max-md:text-base"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
          />
          <p id={`${uid}-name-help`} className={cn("text-xs", problem ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
            {problem ?? (nameTouched && botName !== suggested ? <>Gợi ý: <button type="button" className="font-mono underline underline-offset-2" onClick={() => setNameTouched(false)}>{suggested}</button></> : "Tên tự gợi ý từ mẫu và thư mục; sửa được.")}
          </p>
        </section>

        {/* 4. First message */}
        <section className="space-y-2">
          <label htmlFor={`${uid}-msg`} className="block text-sm font-semibold">
            <span className="mr-1.5 text-muted-foreground tabular">4</span>Tin nhắn đầu <span className="font-normal text-muted-foreground">(tùy chọn)</span>
          </label>
          <Textarea
            ref={messageRef}
            id={`${uid}-msg`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void create(true);
              }
            }}
            placeholder={template?.firstMessage ?? "Giao việc đầu tiên cho bot…"}
            rows={3}
            className="min-h-20 resize-y text-sm max-md:text-base"
            aria-describedby={`${uid}-msg-help`}
          />
          <p id={`${uid}-msg-help`} className="text-xs text-pretty text-muted-foreground">
            {template?.instructions ? "Bot nhận hướng dẫn của mẫu trước tin này." : "Để trống rồi bấm “Chỉ tạo” nếu anh muốn giao việc sau."}
          </p>
        </section>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3 max-sm:px-4 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="button" variant="ghost" disabled={!canCreate} onClick={() => create(false)} className="max-md:h-11 max-md:flex-1">
          {busy === "create" && <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />} Chỉ tạo
        </Button>
        <Button type="submit" disabled={!canCreate} className="max-md:h-11 max-md:flex-1">
          {busy === "send" && <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />} Tạo và gửi
        </Button>
      </div>
    </form>

      {/* Outside the form: the picker's own search form must not submit this one (React events cross portals). */}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="flex h-[min(36rem,85dvh)] flex-col gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="border-b p-4">
            <DialogTitle>Chọn thư mục</DialogTitle>
            <DialogDescription>Bot chạy trong thư mục này. Dán đường dẫn đầy đủ hoặc duyệt thư mục trên máy.</DialogDescription>
          </DialogHeader>
          <ProjectPicker
            api={hq.api}
            list={pickerList}
            folder={chosen?.path ?? null}
            home={null}
            browseFrom={null}
            onPick={(p) => {
              setOther(p);
              setFolder(p);
              setPicking(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
