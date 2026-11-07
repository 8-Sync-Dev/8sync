"use client";

// Pieces "Bot mới" (new-bot-sheet.tsx) and the template editor (template-editor.tsx) share: the template
// tile colors, the engine + model row and the model list it picks from.
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CLAUDE_START_MODELS, type ModelChoice, type ModelsReply } from "@/lib/room-model";
import { BOT_ENGINES, withModel, withThinking, type BotEngine, type BotRun, type BotTemplate, type TemplateColor } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { EFFORT_LABEL, modelChipLabel, ModelMenu } from "../model-picker";
import type { Api } from "../use-hq";

export const ENGINE_LABEL: Record<BotEngine, string> = { claude: "Claude Code", omp: "omp" };

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

/** Arrow keys move between the radios of a group (one tab stop per group), as a native radio group does. */
export function radioKeys(e: KeyboardEvent<HTMLElement>) {
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

/** The models a new bot of `engine` can start on: Claude Code's pinned ones, omp's (fetched once omp is chosen; null = loading). */
export function useStartModels(api: Api, engine: BotEngine): ModelChoice[] | null {
  const [ompList, setOmpList] = useState<ModelChoice[] | null>(null);
  const needOmp = engine === "omp" && ompList === null;
  useEffect(() => {
    if (!needOmp) return;
    let live = true;
    api<ModelsReply>("/api/models?engine=omp")
      .then((r) => live && setOmpList(r.models))
      .catch((e: Error) => {
        if (!live) return;
        setOmpList([]);
        toast.error(`Chưa tải được danh sách model omp: ${e.message}`);
      });
    return () => {
      live = false;
    };
  }, [needOmp, api]);
  return engine === "omp" ? ompList : CLAUDE_START_MODELS;
}

/** A template's face: the tinted emoji tile, the name, the purpose (cards and the editor's preview). */
export function TemplateFace({ t, className }: { t: Pick<BotTemplate, "emoji" | "color" | "name" | "purpose">; className?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-col items-start gap-1.5", className)}>
      <span aria-hidden className={cn("grid size-8 place-items-center rounded-lg text-base ring-1", TEMPLATE_TINT[t.color])}>
        {t.emoji}
      </span>
      <span className="text-sm leading-tight font-medium">{t.name}</span>
      <span className="line-clamp-2 text-xs leading-snug text-pretty text-muted-foreground">{t.purpose}</span>
    </span>
  );
}

/**
 * Engine (Claude Code | omp) and the model + level it starts on: a segmented control and the composer's
 * model menu (lib/room-model.ts lists) in a popover. "Mặc định" = no `--model`: the engine's own default.
 */
export function RunRow({ run, models, onChange, onEngine }: { run: BotRun; models: ModelChoice[] | null; onChange: (r: BotRun) => void; onEngine: (e: BotEngine) => void }) {
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const label = modelChipLabel(run.engine, run.model, "Model mặc định");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Chạy bằng" onKeyDown={radioKeys} className="inline-flex rounded-lg bg-muted p-0.5">
        {BOT_ENGINES.map((e) => {
          const on = run.engine === e;
          return (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => !on && onEngine(e)}
              className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm motion-reduce:transition-none max-md:h-11"
            >
              {ENGINE_LABEL[e]}
            </button>
          );
        })}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          aria-label={`Model và mức suy nghĩ: ${label}${run.thinking ? `, ${EFFORT_LABEL[run.thinking] ?? run.thinking}` : ""}`}
          className="inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-lg border bg-background px-3 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none max-md:h-11"
        >
          <BrainIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate font-medium">{label}</span>
          {run.thinking && <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{EFFORT_LABEL[run.thinking] ?? run.thinking}</span>}
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            search.current?.focus({ preventScroll: true });
          }}
        >
          <ModelMenu
            engine={run.engine}
            models={models}
            model={run.model}
            thinking={run.thinking}
            searchRef={search}
            defaultLabel={run.engine === "omp" ? "omp mặc định (model trong config omp)" : "Mặc định của tài khoản Claude"}
            effortsLocked={run.engine === "omp" && run.model === null ? "Chọn một model để đặt mức suy nghĩ." : undefined}
            onThinking={(t) => onChange(withThinking(run, t))}
            onModel={(m) => {
              onChange(withModel(run, m, models ?? []));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
