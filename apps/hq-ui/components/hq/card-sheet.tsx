"use client";

import { ChevronsDownIcon, ChevronsUpIcon, CopyIcon, ExternalLinkIcon, FlameIcon, GitPullRequestIcon, TagIcon, Undo2Icon, ZapIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cardParts, prRef, type CardTag } from "@/lib/card-tags";
import { LANES, claimStale, type Card, type LaneKey } from "@/lib/lanes";
import { agoVi, roomRole } from "@/lib/now";
import { cn } from "@/lib/utils";
import { RoleIcon } from "./role-badge";

/**
 * One restrained hue per lane, from the HQ palette: grey waits, blue is queued, green is being built,
 * violet is tested, teal is reviewed, amber waits on the owner (Ship), red is stuck. `ink` is the
 * text colour that passes AA on light surfaces; dark mode uses the tone itself.
 */
const LANE_TONE: Record<LaneKey, { tone: string; ink: string }> = {
  backlog: { tone: "var(--st-idle)", ink: "color-mix(in oklch, var(--st-idle), black 35%)" },
  ready: { tone: "var(--via-channel)", ink: "var(--via-channel)" },
  building: { tone: "var(--st-running)", ink: "var(--st-running)" },
  qa: { tone: "var(--lane-qa)", ink: "var(--lane-qa)" },
  review: { tone: "var(--lane-review)", ink: "var(--lane-review)" },
  approved: { tone: "var(--st-needs)", ink: "color-mix(in oklch, var(--st-needs), black 38%)" },
  blocked: { tone: "var(--destructive)", ink: "var(--destructive)" },
};

const LABEL_TONE: Record<string, { tone: string; ink: string }> = {
  bug: LANE_TONE.blocked,
  feature: LANE_TONE.ready,
  qa: LANE_TONE.qa,
  arch: LANE_TONE.review,
};

export const LANE_VI: Record<LaneKey, string> = {
  backlog: "Backlog",
  ready: "Ready",
  building: "Building",
  qa: "QA",
  review: "Review",
  approved: "Approved",
  blocked: "Blocked",
};

const LABEL_VI: Record<string, string> = { bug: "bug", feature: "feature", qa: "qa", arch: "kiến trúc" };

/** CSS variables a toned element reads: `--tone` for dots and tints, `--tone-ink` for text. */
export function toneOf(t: { tone: string; ink: string } | undefined): CSSProperties | undefined {
  return t ? ({ "--tone": t.tone, "--tone-ink": t.ink } as CSSProperties) : undefined;
}
export const laneTone = (k: LaneKey) => toneOf(LANE_TONE[k]);

/** Text in the tone (AA on light), tone itself on dark. */
export const TONE_INK = "text-(--tone-ink) dark:text-(--tone)";
const CHIP = "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-px text-[11px] leading-4 font-medium";

/** The card's label (bug / feature / qa) as a toned chip; an unknown label stays neutral. */
export function LabelChip({ label }: { label: string }) {
  const t = LABEL_TONE[label];
  return (
    <span
      style={toneOf(t)}
      className={cn(CHIP, t ? cn("bg-[color-mix(in_oklch,var(--tone)_14%,transparent)]", TONE_INK) : "bg-muted text-muted-foreground")}
    >
      <TagIcon aria-hidden className="size-3 shrink-0" />
      {LABEL_VI[label] ?? label}
    </span>
  );
}

/** Epic in mono, role with its icon, anything else as a plain outline chip. */
export function TagChips({ tags }: { tags: CardTag[] }) {
  return tags.map((t, i) =>
    t.kind === "epic" ? (
      <span key={i} className={cn(CHIP, "bg-foreground/[0.07] font-mono text-foreground")}>
        {t.text}
      </span>
    ) : t.kind === "role" ? (
      <span key={i} className={cn(CHIP, "border border-border text-foreground")}>
        <RoleIcon role={t.role} className="text-muted-foreground" />
        <span className="truncate">{t.text}</span>
      </span>
    ) : (
      <span key={i} className={cn(CHIP, "border border-dashed border-border text-muted-foreground")}>
        <span className="truncate">{t.text}</span>
      </span>
    ),
  );
}

/** P0..P3 as `auto prio` takes them; unset is claimed as P2. */
export const PRIO = [
  { n: 0, label: "P0", hint: "gấp nhất" },
  { n: 1, label: "P1", hint: "gấp" },
  { n: 2, label: "P2", hint: "thường" },
  { n: 3, label: "P3", hint: "để sau" },
] as const;

/** How urgent a card is, on the card: P0 red, P1 amber, P3 quiet; P2 (the default) shows nothing. */
export function PrioChip({ prio }: { prio: number | null | undefined }) {
  if (prio == null || prio === 2 || !PRIO[prio]) return null;
  const p = PRIO[prio];
  if (prio === 3) {
    return (
      <span className={cn(CHIP, "bg-muted text-muted-foreground")} title="P3: để sau, phòng nhận sau các card khác">
        <ChevronsDownIcon aria-hidden className="size-3 shrink-0" />
        {p.label}
      </span>
    );
  }
  const Icon = prio === 0 ? FlameIcon : ChevronsUpIcon;
  return (
    <span
      style={toneOf(prio === 0 ? LANE_TONE.blocked : LANE_TONE.approved)}
      className={cn(CHIP, "bg-[color-mix(in_oklch,var(--tone)_16%,transparent)] font-semibold", TONE_INK)}
      title={`${p.label}: ${p.hint}, phòng nhận trước các card khác`}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      {p.label} · {p.hint}
    </span>
  );
}

/** P0..P3 buttons in the sheet; the pressed one is the card's level (unset reads as P2). */
function PrioPicker({ c, onPrio }: { c: Card; onPrio: (prio: number | null) => Promise<void> }) {
  const [busy, setBusy] = useState<number | null>(null);
  const cur = c.prio ?? 2;
  async function pick(n: number) {
    if (n === cur) return;
    setBusy(n);
    try {
      await onPrio(n);
      toast.success(`Card #${c.id}: ${PRIO[n].label} (${PRIO[n].hint})`);
    } catch (e) {
      toast.error(`Không đổi được ưu tiên: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div role="group" aria-label="Mức ưu tiên" className="inline-flex rounded-md border p-0.5">
      {PRIO.map((p) => (
        <button
          key={p.n}
          type="button"
          aria-pressed={p.n === cur}
          disabled={busy != null}
          onClick={() => void pick(p.n)}
          title={p.hint}
          className={cn(
            "rounded-[5px] px-2 py-0.5 font-mono text-xs transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60 motion-reduce:transition-none",
            p.n === cur ? "bg-foreground font-semibold text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {busy === p.n ? "…" : p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The force button a card carries, wherever it sits: "unblock" for a Blocked card, "rush" for one
 * still waiting (Backlog or Ready) and not P0 yet; null elsewhere (in work, or closed).
 */
export function forceKind(c: Pick<Card, "lane" | "prio">): "rush" | "unblock" | null {
  if (c.lane === "blocked") return "unblock";
  return (c.lane === "backlog" || c.lane === "ready") && c.prio !== 0 ? "rush" : null;
}

const FORCE = {
  rush: { label: "Làm ngay", done: (id: number) => `#${id} lên P0`, title: "Đặt P0, báo lead và gọi phòng rảnh của cột nhận card này ngay" },
  unblock: {
    label: "Gỡ block ngay",
    done: (id: number) => `#${id} ra khỏi Blocked, P0 — lead xử lý ngay`,
    title: "Đưa card về Backlog kèm ghi chú cho lead (quyết, viết AC + check, đưa Ready lượt này) và đặt P0",
  },
} as const;

/**
 * "⚡ Làm ngay" (P0 through `auto prio`) or "⚡ Gỡ block ngay" (POST /api/board/unblock: Backlog with
 * the owner's note, then P0): the lead hears it and the free rooms of the card's lane are called.
 * `run` does the call; a string it resolves to (the CLI's "Đã gọi dev nhận #21 ngay · đã báo lead",
 * lib/server/board.ts rushLine) is the toast's second line.
 */
export function ForceButton({ c, run, className }: { c: Card; run: () => Promise<unknown>; className?: string }) {
  const [busy, setBusy] = useState(false);
  const kind = forceKind(c);
  if (!kind) return null;
  const f = FORCE[kind];
  async function force() {
    setBusy(true);
    try {
      const woke = await run();
      toast.success(f.done(c.id), typeof woke === "string" ? { description: woke } : undefined);
    } catch (e) {
      toast.error(`${f.label} #${c.id} thất bại: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button type="button" size="xs" variant="outline" disabled={busy} aria-busy={busy} onClick={() => void force()} className={className} aria-label={`${f.label} card #${c.id}`} title={f.title}>
      <ZapIcon aria-hidden className="text-st-needs" /> {f.label}
    </Button>
  );
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Đã chép ${what}`);
  } catch {
    toast.message(text);
  }
}

/** Everything the board knows about one card. Rendered inside the sheet; kept separate so tests can render it. */
export function CardDetail({ c, now, next, onPrio, onForce }: { c: Card; now: number; next: boolean; onPrio?: (prio: number | null) => Promise<void>; onForce?: () => Promise<unknown> }) {
  const { title, tags } = cardParts(c.text);
  const lane = LANES.find((l) => l.key === c.lane);
  const stale = claimStale(c, now);
  const pr = c.pr ? prRef(c.pr) : null;
  const row = "grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 py-2.5";
  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <span style={laneTone(c.lane)} className={cn(CHIP, "bg-[color-mix(in_oklch,var(--tone)_14%,transparent)]", TONE_INK)}>
          <span aria-hidden className="size-1.5 rounded-full bg-(--tone)" />
          {LANE_VI[c.lane]}
        </span>
        <PrioChip prio={c.prio} />
        {c.label && <LabelChip label={c.label} />}
        <TagChips tags={tags} />
        {next && <span className={cn(CHIP, "bg-brand/25 text-brand-ink dark:text-brand")}>Kế tiếp</span>}
        {onForce && <ForceButton c={c} run={onForce} className="ml-auto" />}
      </div>

      {title !== c.text.trim() && (
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">Toàn văn</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-pretty">{c.text}</p>
        </div>
      )}

      <dl className="divide-y border-y text-sm">
        <div className={row}>
          <dt className="text-muted-foreground">Cột</dt>
          <dd>
            {LANE_VI[c.lane]}
            {lane && <span className="text-muted-foreground">: {lane.hint}</span>}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Ưu tiên</dt>
          <dd className="min-w-0 space-y-1">
            {onPrio ? <PrioPicker c={c} onPrio={onPrio} /> : <span>{PRIO[c.prio ?? 2]?.label ?? "P2"}</span>}
            <p className="text-xs text-muted-foreground text-pretty">
              {c.prio == null ? "Chưa đặt, tính như P2. " : ""}Phòng nhận card gấp hơn trước; cùng mức thì theo thứ tự hàng. Lệnh: <code className="font-mono">8sync ccc auto prio {c.id} P0</code>
            </p>
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Lệnh check</dt>
          <dd className="min-w-0">
            {c.check ? (
              <div className="flex items-start gap-1.5">
                <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">{c.check}</code>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Chép lệnh check" onClick={() => void copy(c.check!, "lệnh check")}>
                  <CopyIcon />
                </Button>
              </div>
            ) : (
              <span className="text-destructive">Chưa có. Card không qua QA được khi thiếu lệnh check.</span>
            )}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Phòng giữ</dt>
          <dd className="min-w-0">
            {c.claim ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <RoleIcon role={roomRole(c.claim.room)?.role ?? null} className="size-3.5 text-muted-foreground" />
                <span className="font-medium">{c.claim.room}</span>
                <span className="text-muted-foreground">nhận {agoVi(c.claim.at, now)}</span>
                {stale && <span className="text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs">· im quá 2 giờ, claim kế sẽ thu hồi</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">Chưa phòng nào nhận.</span>
            )}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Ghi chú mới nhất</dt>
          <dd className="min-w-0">
            {c.note ? (
              <>
                <p className="whitespace-pre-wrap text-pretty">
                  {c.note.room && <span className="font-medium">{c.note.room}: </span>}
                  {c.note.text}
                </p>
                {c.note.at > 0 && <p className="text-xs text-muted-foreground tabular">{agoVi(c.note.at, now)}</p>}
              </>
            ) : (
              <span className="text-muted-foreground">Chưa có ghi chú.</span>
            )}
          </dd>
        </div>
        {(pr || c.sha) && (
          <div className={row}>
            <dt className="text-muted-foreground">Pull request</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              {pr &&
                (pr.href ? (
                  <a href={pr.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                    <GitPullRequestIcon aria-hidden className="size-3.5" />
                    {pr.text}
                    <ExternalLinkIcon aria-hidden className="size-3" />
                    <span className="sr-only">(mở tab mới)</span>
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium">
                    <GitPullRequestIcon aria-hidden className="size-3.5" />
                    {pr.text}
                  </span>
                ))}
              {c.sha && (
                <span className="font-mono text-xs text-muted-foreground" title="Commit review đã duyệt: merge với --match-head-commit">
                  duyệt ở {c.sha.slice(0, 12)}
                </span>
              )}
            </dd>
          </div>
        )}
        <div className={row}>
          <dt className="text-muted-foreground">Bị trả về</dt>
          <dd className={cn("inline-flex items-center gap-1", c.bounces >= 2 && "font-medium text-[color-mix(in_oklch,var(--st-needs),black_38%)] dark:text-st-needs")}>
            <Undo2Icon aria-hidden className="size-3.5" />
            {c.bounces ? `${c.bounces} lần` : "Chưa lần nào"}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">Thêm vào</dt>
          <dd>
            {c.added > 0 ? agoVi(c.added, now) : "Không rõ"}
            <span className="text-muted-foreground"> · {c.from ? `bởi phòng ${c.from}` : "anh giao"}</span>
          </dd>
        </div>
      </dl>

      {(c.history?.length ?? 0) > 1 && (
        <section aria-labelledby={`hist-${c.id}`} className="space-y-2">
          <h3 id={`hist-${c.id}`} className="text-xs font-medium text-muted-foreground">
            Lịch sử <span className="font-normal">(mới nhất trước, board giữ 12 ghi chú gần nhất)</span>
          </h3>
          <ol className="space-y-1.5 text-sm">
            {[...c.history!].reverse().map((h, i) => (
              <li key={i} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2">
                <span className="text-xs text-muted-foreground tabular">{h.at > 0 ? agoVi(h.at, now) : ""}</span>
                <span className="min-w-0 text-pretty">
                  {h.to && (
                    <span style={laneTone(h.to)} className={cn("mr-1 font-medium", TONE_INK)}>
                      {LANE_VI[h.from!]} → {LANE_VI[h.to]}
                    </span>
                  )}
                  {h.room && <span className="font-medium">{h.room}: </span>}
                  <span className={cn(h.to && "text-muted-foreground")}>{h.to ? h.text.replace(/^\s*[a-z]+\s*(?:→|->)\s*[a-z]+\s*:?\s*/, "") : h.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** Right-side sheet: Esc and the close button dismiss it; Radix returns focus to the card that opened it. */
export function CardSheet({
  c,
  open,
  now,
  next,
  onClose,
  onPrio,
  onForce,
}: {
  c: Card | null;
  open: boolean;
  now: number;
  next: boolean;
  onClose: () => void;
  onPrio?: (prio: number | null) => Promise<void>;
  onForce?: () => Promise<unknown>;
}) {
  const title = c ? cardParts(c.text).title : "";
  return (
    <Sheet open={open && c != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-base leading-snug font-semibold text-pretty">
            <span className="mr-1.5 font-mono text-sm font-normal text-muted-foreground">#{c?.id}</span>
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">Chi tiết card trên board</SheetDescription>
        </SheetHeader>
        {c && <CardDetail c={c} now={now} next={next} onPrio={onPrio} onForce={onForce} />}
      </SheetContent>
    </Sheet>
  );
}
