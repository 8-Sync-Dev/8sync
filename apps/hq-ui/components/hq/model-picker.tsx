"use client";

import { BrainIcon, CheckIcon, ChevronDownIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { modelShort, ompModelLabel } from "@/lib/roles";
import { effortsFor, filterModels, findChoice, type ModelChoice, type ModelsReply } from "@/lib/room-model";
import { cn } from "@/lib/utils";
import type { Api } from "./use-hq";

/** Effort words the owner reads; the level itself is still shown in the chip's title. */
export const EFFORT_LABEL: Record<string, string> = { off: "tắt", minimal: "tối thiểu", low: "thấp", medium: "vừa", high: "cao", xhigh: "rất cao", max: "tối đa" };
const LIST_MAX = 120;

/** The chip's model words: an omp selector or a Claude id, else the engine's default. */
export const modelChipLabel = (engine: "omp" | "claude", model: string | null | undefined, none = "Model") =>
  model ? (engine === "omp" ? ompModelLabel(model) : modelShort(model)) : engine === "omp" ? "omp mặc định" : none;

/**
 * The composer's model + effort switch for one room: a chip showing what the room runs, a popover with
 * the effort bubbles on top and the model list (search, by provider) under them. omp rooms switch
 * through their inbox (this session only); Claude Code rooms HQ types into get `/model` and `/effort`.
 */
export function ModelPicker({ api, session, engine, model, className }: { api: Api; session: string; engine: "omp" | "claude"; model: string | null | undefined; className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  // Sent and not yet seen on the room: the chip shows it with a spinner until the room reports it.
  const [sent, setSent] = useState<{ session: string; model?: string; thinking?: string } | null>(null);

  // What the room reports (office poll; omp rooms carry the level), else what the open picker fetched.
  const [fetched, setFetched] = useState<{ session: string; reply: ModelsReply } | null>(null);
  const data = fetched?.session === session ? fetched.reply : null;
  const [roomModel, roomThinking] = splitLevel(model);
  const curModel = roomModel ?? data?.current?.model ?? null;
  const curThinking = roomThinking ?? data?.current?.thinking ?? null;
  const seen = !!sent && (!sent.model || sameModel(sent.model, curModel)) && (!sent.thinking || sent.thinking === curThinking);
  const pending = sent && sent.session === session && !seen ? sent : null;
  // Claude Code rooms never report effort back, and a switch omp refused never shows: stop waiting.
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(null), engine === "omp" ? 60_000 : 20_000);
    return () => clearTimeout(t);
  }, [sent, engine]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api<ModelsReply>(`/api/models?session=${encodeURIComponent(session)}`)
      .then((r) => live && setFetched({ session, reply: r }))
      .catch((e: Error) => live && toast.error(`Chưa tải được danh sách model: ${e.message}`));
    return () => {
      live = false;
    };
  }, [open, api, session]);

  const shownModel = pending?.model ?? curModel;
  const shownThinking = pending?.thinking ?? curThinking;
  const models = useMemo(() => data?.models ?? [], [data]);
  const canApply = data ? data.apply !== null : true;
  const label = modelChipLabel(engine, shownModel);

  async function apply(change: { model?: string; thinking?: string }) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/models", { method: "POST", body: { session, ...change } });
      setSent((p) => ({ ...(p?.session === session ? p : {}), session, ...change }));
      const what = [change.model ? (chosenName(models, change.model) ?? change.model) : null, change.thinking ? `suy nghĩ ${EFFORT_LABEL[change.thinking] ?? change.thinking}` : null].filter(Boolean).join(" · ");
      toast.success(`Đã gửi: ${what}`, { description: engine === "omp" ? "Áp dụng từ lượt sau, chỉ phiên này (config omp giữ nguyên)." : "Đã gõ vào terminal của phòng." });
      if (change.model) setOpen(false);
    } catch (e) {
      toast.error((e as Error).message === "session-waiting" ? "Phòng đang chờ anh trả lời trong terminal: trả lời trước rồi đổi" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={`Model và mức suy nghĩ: ${label}${shownThinking ? `, ${shownThinking}` : ""}`}
        className={cn(
          "inline-flex h-7 min-w-0 max-w-[14rem] items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          pending && "border-dashed",
          className,
        )}
      >
        <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{label}</span>
        {shownThinking && <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{EFFORT_LABEL[shownThinking] ?? shownThinking}</span>}
        {pending ? <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden /> : <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        // `autoFocus` would focus before Radix places the popover and scroll the page to it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          search.current?.focus({ preventScroll: true });
        }}
      >
        {data?.current?.error && !pending && (
          <p role="alert" className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Lần đổi trước chưa áp dụng: {data.current.error}
          </p>
        )}
        <ModelMenu
          engine={engine}
          models={data ? models : null}
          model={shownModel}
          thinking={shownThinking}
          disabled={busy}
          searchRef={search}
          notice={
            data && !canApply
              ? engine === "omp"
                ? "Phòng omp này mở trước bản 8sync-inbox biết đổi model: chạy 8sync up, thoát rồi mở lại phòng (hoặc gõ /model ngay trong omp)."
                : "Phiên Claude Code này mở ngoài HQ (nhận tin qua inbox): đổi trong terminal của nó bằng /model và /effort."
              : null
          }
          onThinking={(t) => void apply({ thinking: t })}
          onModel={(sel) => (sel === null || sel === findChoice(models, shownModel)?.selector ? setOpen(false) : void apply({ model: sel }))}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The picker's body: effort bubbles, then the model list (search, by provider). `models` null = still
 * loading. `notice` replaces the list and locks the effort row. `defaultLabel` adds a first row for the
 * engine's own default (`onModel(null)`). Shared by the composer chip and "Bot mới" (new-bot-sheet.tsx).
 */
export function ModelMenu({
  engine,
  models,
  model,
  thinking,
  disabled = false,
  notice = null,
  defaultLabel,
  effortsLocked,
  searchRef,
  onThinking,
  onModel,
}: {
  engine: "omp" | "claude";
  models: ModelChoice[] | null;
  model: string | null;
  thinking: string | null;
  disabled?: boolean;
  notice?: ReactNode;
  defaultLabel?: string;
  /** Why the effort row is locked (shown under it). */
  effortsLocked?: string;
  searchRef?: Ref<HTMLInputElement>;
  onThinking: (t: string) => void;
  onModel: (selector: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const all = useMemo(() => models ?? [], [models]);
  const chosen = findChoice(all, model);
  const efforts = effortsFor(engine, chosen);
  const list = useMemo(() => filterModels(all, q), [all, q]);
  const groups = useMemo(() => byProvider(list.slice(0, LIST_MAX)), [list]);

  // Open on the current model, not the top of a 300-model list. Scroll the list only: `scrollIntoView`
  // would also scroll the page.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = listRef.current;
    const el = models ? box?.querySelector("[aria-selected='true']") : null;
    if (!box || !el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = top - box.clientHeight / 2;
  }, [models]);

  return (
    <>
      <div className="space-y-2 border-b p-3">
        <p className="text-xs font-medium">Mức suy nghĩ</p>
        <div role="radiogroup" aria-label="Mức suy nghĩ" className="flex flex-wrap gap-1.5">
          {efforts.map((t) => {
            const on = t === thinking;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                title={t}
                disabled={disabled || !!notice || !!effortsLocked}
                onClick={() => onThinking(t)}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-xs transition-colors disabled:opacity-50 max-sm:h-9",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                )}
              >
                {EFFORT_LABEL[t] ?? t}
              </button>
            );
          })}
        </div>
        {effortsLocked && <p className="text-[11px] text-muted-foreground">{effortsLocked}</p>}
      </div>
      {notice ? (
        <p className="p-3 text-xs text-muted-foreground">{notice}</p>
      ) : (
        <>
          <label className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="sr-only">Tìm model</span>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={engine === "omp" ? "Tìm model: opus, glm, gpt…" : "Tìm model"}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground max-sm:h-11 max-sm:text-base"
            />
          </label>
          <div ref={listRef} role="listbox" aria-label="Model" className="max-h-72 overflow-y-auto overscroll-contain p-1">
            {defaultLabel && !q.trim() && (
              <button
                type="button"
                role="option"
                aria-selected={model === null}
                disabled={disabled}
                onClick={() => onModel(null)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50 max-sm:py-2.5", model === null && "bg-muted")}
              >
                <span className="min-w-0 flex-1 truncate">{defaultLabel}</span>
                {model === null && <CheckIcon className="size-3.5 shrink-0" aria-hidden />}
              </button>
            )}
            {!models && (
              <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Đang tải model…
              </p>
            )}
            {models && list.length === 0 && <p className="p-2 text-xs text-muted-foreground">{all.length === 0 ? "omp chưa trả danh sách model (chạy `omp models` để xem lỗi)." : "Không có model khớp."}</p>}
            {groups.map(([provider, ms]) => (
              <div key={provider} role="group" aria-label={provider}>
                <p className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{provider}</p>
                {ms.map((m) => {
                  const on = m.selector === chosen?.selector;
                  return (
                    <button
                      key={m.selector}
                      type="button"
                      role="option"
                      aria-selected={on}
                      disabled={disabled}
                      onClick={() => onModel(m.selector)}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50 max-sm:py-2.5", on && "bg-muted")}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.name}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{m.selector}</span>
                      </span>
                      {on && <CheckIcon className="size-3.5 shrink-0" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            ))}
            {list.length > LIST_MAX && <p className="p-2 text-[11px] text-muted-foreground">Còn {list.length - LIST_MAX} model nữa: gõ để lọc.</p>}
          </div>
        </>
      )}
    </>
  );
}

/** `provider/model:level` → [model, level]; a Claude id has no level. */
function splitLevel(m: string | null | undefined): [string | null, string | null] {
  const raw = m?.trim();
  if (!raw) return [null, null];
  const i = raw.lastIndexOf(":");
  return i > raw.lastIndexOf("/") && i > 0 ? [raw.slice(0, i), raw.slice(i + 1)] : [raw, null];
}

const sameModel = (a: string, b: string | null) => !!b && (a === b || a.slice(a.indexOf("/") + 1) === b.slice(b.indexOf("/") + 1));
const chosenName = (ms: ModelChoice[], sel: string) => ms.find((m) => m.selector === sel)?.name;

function byProvider(ms: ModelChoice[]): [string, ModelChoice[]][] {
  const out = new Map<string, ModelChoice[]>();
  for (const m of ms) out.set(m.provider, [...(out.get(m.provider) ?? []), m]);
  return [...out];
}
