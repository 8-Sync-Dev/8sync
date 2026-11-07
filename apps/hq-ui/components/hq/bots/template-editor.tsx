"use client";

// "Của tôi" in "Bot mới": create, edit or copy one of the owner's templates (~/.config/8sync/hq/templates/),
// with a live preview of the card and of exactly the first message the bot gets (firstPrompt). "Tạo bằng AI"
// / "Viết lại bằng AI" fill the form from one `claude -p` call (POST /api/templates/ai): a draft the owner
// reviews, never saved until "Lưu". Server: app/api/templates/route.ts (owner only, atomic writes).
import { Loader2Icon, SparklesIcon, Undo2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ROLES, roleOf, type RoleId } from "@/lib/roles";
import {
  BLANK_DRAFT,
  TEMPLATE_COLORS,
  TEMPLATE_LIMITS as L,
  checkTemplate,
  draftOf,
  firstPrompt,
  templateOfDraft,
  type BotTemplate,
  type TemplateDraft,
} from "@/lib/templates";
import { cn } from "@/lib/utils";
import { EFFORT_LABEL, modelChipLabel } from "../model-picker";
import type { Hq } from "../use-hq";
import { ENGINE_LABEL, RunRow, TEMPLATE_TINT, TemplateFace, radioKeys, useStartModels } from "./template-bits";

/** What the editor opens on: a new template (blank, a copy's draft, or the AI box first), or one of the owner's. */
export type EditorTarget = { kind: "new"; draft?: TemplateDraft; ai?: boolean } | { kind: "edit"; template: BotTemplate };

const AI_TEXT_MAX = 500;

export function TemplateEditor({ hq, target, onClose, onSaved }: { hq: Hq; target: EditorTarget | null; onClose: () => void; onSaved: (t: BotTemplate) => void }) {
  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(48rem,94dvh)] flex-col gap-0 p-0 sm:max-w-4xl max-sm:inset-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:ring-0"
      >
        {target && <EditorForm hq={hq} target={target} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({ hq, target, onSaved }: { hq: Hq; target: EditorTarget; onSaved: (t: BotTemplate) => void }) {
  const uid = useId();
  const editing = target.kind === "edit" ? target.template : null;
  const [draft, setDraft] = useState<TemplateDraft>(() => (editing ? draftOf(editing) : (target.kind === "new" && target.draft) || BLANK_DRAFT));
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // The draft before the AI's: "Hoàn tác" puts it back.
  const [beforeAi, setBeforeAi] = useState<TemplateDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const models = useStartModels(hq.api, draft.run.engine);

  const set = <K extends keyof TemplateDraft>(k: K, v: TemplateDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const raw = templateOfDraft(draft, editing?.id);
  const check = checkTemplate(raw);
  const touched = JSON.stringify(draft) !== JSON.stringify(BLANK_DRAFT);
  // A valid draft is rewritten; an empty or broken one is written from the sentence.
  const rewrite = check.ok && touched;
  const lines = draft.instructions ? draft.instructions.split("\n").length : 0;
  const prompt = firstPrompt(raw, draft.firstMessage);
  const role = draft.run.engine === "claude" && draft.role ? (roleOf(draft.role)?.labelVi ?? draft.role) : null;
  const runLabel = [ENGINE_LABEL[draft.run.engine], role, modelChipLabel(draft.run.engine, draft.run.model, "model mặc định"), draft.run.thinking ? `suy nghĩ ${EFFORT_LABEL[draft.run.thinking] ?? draft.run.thinking}` : null]
    .filter(Boolean)
    .join(" · ");

  async function askAi() {
    const text = aiText.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const body = rewrite && check.ok ? { mode: "rewrite", text, template: check.template } : { mode: "new", text };
      const r = await hq.api<{ template: BotTemplate }>("/api/templates/ai", { method: "POST", body });
      setBeforeAi(draft);
      setDraft(draftOf(r.template));
      setAiText("");
    } catch (x) {
      setAiError((x as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  async function save() {
    if (!check.ok || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await hq.api<{ template: BotTemplate }>("/api/templates", { method: editing ? "PUT" : "POST", body: { template: raw } });
      toast.success(`Đã lưu mẫu ${r.template.name}`);
      onSaved(r.template);
    } catch (x) {
      setSaveError((x as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const label = "text-xs font-medium";
  const hint = "text-[11px] text-muted-foreground tabular";
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-busy={saving || aiBusy}
    >
      <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-4 max-sm:px-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))]">
        <DialogTitle className="text-base">{editing ? `Sửa mẫu ${editing.name}` : "Mẫu mới"}</DialogTitle>
        <DialogDescription className="text-pretty">Mẫu lưu trên máy này. Bot tạo từ mẫu nhận lời dặn và skill ở đầu tin nhắn đầu tiên.</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-6 px-5 py-5 max-sm:px-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-5">
            {/* AI: a sentence → a draft, or an instruction → the draft rewritten. */}
            <section aria-labelledby={`${uid}-ai`} className="space-y-2 rounded-xl border bg-muted/40 p-3">
              <label id={`${uid}-ai`} htmlFor={`${uid}-ai-text`} className="flex items-center gap-1.5 text-sm font-medium">
                <SparklesIcon className="size-4 text-muted-foreground" aria-hidden />
                {rewrite ? "Viết lại bằng AI" : "Tạo bằng AI"}
              </label>
              <div className="flex gap-2 max-sm:flex-col">
                <Textarea
                  id={`${uid}-ai-text`}
                  value={aiText}
                  maxLength={AI_TEXT_MAX}
                  rows={2}
                  autoFocus={target.kind === "new" && !!target.ai}
                  onChange={(e) => setAiText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void askAi();
                    }
                  }}
                  placeholder={rewrite ? "Muốn đổi gì? VD: thêm bước chạy lint, lời dặn ngắn hơn" : "Tả bot trong một câu. VD: bot viết test cho API đơn hàng, chạy test trước khi báo"}
                  className="min-h-11 flex-1 bg-background text-sm"
                  disabled={aiBusy}
                />
                <Button type="button" variant="secondary" className="max-md:h-11 sm:self-start" disabled={!aiText.trim() || aiBusy} onClick={() => void askAi()}>
                  {aiBusy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden /> : <SparklesIcon aria-hidden />}
                  {aiBusy ? "Đang viết…" : rewrite ? "Viết lại" : "Tạo"}
                </Button>
              </div>
              <p className={cn(hint, "text-pretty")} aria-live="polite">
                {aiBusy
                  ? "Claude đang viết mẫu, tối đa 60 giây."
                  : aiError
                    ? <span className="text-destructive">{aiError}</span>
                    : beforeAi
                      ? <>Bản nháp AI viết, xem lại rồi bấm Lưu. <button type="button" className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline max-md:min-h-11" onClick={() => {
                          setDraft(beforeAi);
                          setBeforeAi(null);
                        }}><Undo2Icon className="size-3" aria-hidden />Hoàn tác</button></>
                      : "AI chỉ điền form, anh xem lại trước khi lưu. Không ghi secret hay dữ liệu khách hàng."}
              </p>
            </section>

            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-emoji`} className={label}>Emoji</label>
                <Input id={`${uid}-emoji`} value={draft.emoji} maxLength={L.emoji} onChange={(e) => set("emoji", e.target.value)} className="text-center text-base max-md:h-11" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-name`} className={label}>Tên</label>
                <Input id={`${uid}-name`} value={draft.name} maxLength={L.name} onChange={(e) => set("name", e.target.value)} placeholder="VD: Viết tài liệu" className="max-md:h-11" />
              </div>
            </div>

            <div className="space-y-1.5">
              <span id={`${uid}-color`} className={label}>Màu</span>
              <div role="radiogroup" aria-labelledby={`${uid}-color`} onKeyDown={radioKeys} className="flex flex-wrap gap-1.5">
                {TEMPLATE_COLORS.map((c) => {
                  const on = draft.color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={c}
                      tabIndex={on ? 0 : -1}
                      onClick={() => set("color", c)}
                      className={cn("size-8 rounded-lg ring-1 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none max-md:size-11", TEMPLATE_TINT[c], on && "ring-2 ring-foreground/70")}
                    />
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${uid}-purpose`} className={label}>Mục đích</label>
              <Input id={`${uid}-purpose`} value={draft.purpose} maxLength={L.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Một dòng: bot làm gì" className="max-md:h-11" />
            </div>

            <div className="space-y-1.5">
              <span className={label}>Chạy bằng</span>
              <RunRow run={draft.run} models={models} onChange={(r) => set("run", r)} onEngine={(e) => set("run", { engine: e, model: null, thinking: null })} />
              {draft.run.engine === "claude" && (
                <div className="flex items-center gap-2 pt-1">
                  <label htmlFor={`${uid}-role`} className="text-xs text-muted-foreground">Vai trò</label>
                  <select
                    id={`${uid}-role`}
                    value={draft.role}
                    onChange={(e) => set("role", e.target.value as RoleId | "")}
                    className="h-9 min-w-0 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-md:h-11"
                  >
                    <option value="">Không</option>
                    {ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.labelVi}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`${uid}-ins`} className={label}>Lời dặn</label>
                <span className={cn(hint, (lines > L.instructionLines || draft.instructions.length > L.instructions) && "text-destructive")}>
                  {lines}/{L.instructionLines} dòng · {draft.instructions.length}/{L.instructions}
                </span>
              </div>
              <Textarea
                id={`${uid}-ins`}
                value={draft.instructions}
                rows={4}
                onChange={(e) => set("instructions", e.target.value)}
                placeholder={"Mỗi dòng một việc cụ thể, kiểm được.\nVD: Chạy test trước khi báo xong. Không push khi chưa có lệnh."}
                className="text-sm"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-skills`} className={label}>Skill nhắc nạp</label>
                <Input id={`${uid}-skills`} value={draft.skills} onChange={(e) => set("skills", e.target.value)} placeholder="tdd-workflow, e2e-testing" className="font-mono text-xs max-md:h-11" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-hint`} className={label}>Thư mục hay làm</label>
                <Input id={`${uid}-hint`} value={draft.folderHint} maxLength={L.folderHint} onChange={(e) => set("folderHint", e.target.value)} placeholder="VD: apps/web (không bắt buộc)" className="font-mono text-xs max-md:h-11" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${uid}-first`} className={label}>Tin nhắn đầu gợi ý</label>
              <Input id={`${uid}-first`} value={draft.firstMessage} maxLength={L.firstMessage} onChange={(e) => set("firstMessage", e.target.value)} placeholder="VD: Viết README cho thư mục này" className="max-md:h-11" />
            </div>
          </div>

          {/* Preview: the card as "Bot mới" shows it, and the bot's first message word for word. */}
          <aside aria-label="Xem trước" className="space-y-3 md:sticky md:top-0 md:self-start">
            <h3 className="text-xs font-medium text-muted-foreground">Xem trước</h3>
            <div className="rounded-xl border bg-card p-3">
              <TemplateFace t={{ emoji: draft.emoji || "🤖", color: draft.color, name: draft.name || "Tên mẫu", purpose: draft.purpose || "Mục đích của bot" }} />
              <p className="mt-2 text-[11px] text-pretty text-muted-foreground">Chạy bằng <span className="font-medium text-foreground">{runLabel}</span></p>
            </div>
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium">Tin nhắn đầu bot nhận</h4>
              <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap break-words">
                {prompt ?? <span className="text-muted-foreground">Trống: bot chỉ nhận tin anh gõ.</span>}
              </pre>
              <p className={cn(hint, "text-pretty")}>Lời dặn và skill đứng trước, tin anh gõ khi tạo bot đứng sau (đây là câu gợi ý).</p>
            </div>
          </aside>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-3 max-sm:px-4 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="mr-auto min-w-0 text-xs text-pretty" aria-live="polite">
          {saveError ? <span className="text-destructive">{saveError}</span> : check.ok ? <span className="text-muted-foreground">Sẵn sàng lưu.</span> : touched ? <span className="text-destructive">{check.error}</span> : null}
        </p>
        <DialogClose asChild>
          <Button type="button" variant="ghost" className="max-md:h-11">
            Huỷ
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!check.ok || saving || aiBusy} className="max-md:h-11">
          {saving && <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden />}
          Lưu mẫu
        </Button>
      </div>
    </form>
  );
}
