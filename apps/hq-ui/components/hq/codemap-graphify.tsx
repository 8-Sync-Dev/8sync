"use client";

import { ArrowDownIcon, ArrowLeftRightIcon, LoaderIcon, MapIcon, NetworkIcon, RefreshCwIcon, RouteIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONFIDENCE_VI, relationVi, type ExplainAnswer, type GraphifyAnswer, type Link, type PathAnswer, type Where } from "@/lib/graphify-answer";
import { agoVi } from "@/lib/now";
import { cn } from "@/lib/utils";
import type { Api } from "./use-hq";
import { usePoll } from "./use-poll";

const IDLE_POLL_MS = 30_000;
const UPDATE_POLL_MS = 1_500;
const SYMBOL_MAX = 200;
/** Phones: every tap target at least 44px (impeccable / WCAG 2.5.5). */
const TAP = "max-sm:min-h-11";

type GraphifyUpdate = { state: "running" | "done" | "failed"; startedAt: number; endedAt: number | null; tail: string; error: string | null };
type Mode = "explain" | "path";
type Asked = { mode: Mode; a: string; b: string };
type Result = { asked: Asked; answer: GraphifyAnswer | null; text: string | null; cached: boolean; error: string | null };
type OnOpen = (file: string, line: number | null) => void;

export function Problem({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {onRetry && (
        <Button size="sm" variant="outline" className={TAP} onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

/**
 * A repo with no code map yet: one owner action registers it (POST /api/codemap/enable, which adds
 * the project the way "+ Dự án" does) and starts `graphify update` and `trail build` in the background.
 */
export function EnablePrompt({ name, root, busy, onEnable }: { name: string; root: string | null; busy: boolean; onEnable: () => void }) {
  return (
    <section aria-labelledby="codemap-enable" className="space-y-3 rounded-lg border bg-muted/30 px-4 py-4">
      <div className="flex items-start gap-3">
        <MapIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <h3 id="codemap-enable" className="text-sm font-semibold text-balance">
            {name} chưa có bản đồ code
          </h3>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            HQ sẽ thêm repo vào danh sách dự án, rồi chạy graphify và trail trên máy này để đọc cấu trúc code (không gọi model). Repo lớn có thể mất vài phút; tab này hiện tiến độ.
          </p>
          {root && (
            <code className="block truncate font-mono text-[11px] text-muted-foreground" title={root}>
              {root}
            </code>
          )}
        </div>
      </div>
      <Button type="button" onClick={onEnable} disabled={busy} className="w-full sm:w-auto max-sm:h-11">
        {busy ? <LoaderIcon className="animate-spin motion-reduce:animate-none" /> : <NetworkIcon />}
        {busy ? "Đang tạo…" : "Tạo bản đồ code cho repo này"}
      </Button>
    </section>
  );
}

/**
 * graphify on the server for one project: "Giải thích" (`graphify explain`) as a card of callers,
 * callees and file:line, "Đường đi" (`graphify path`) as a step list, and "Cập nhật graph"
 * (`graphify update . --no-cluster`) with its progress. Names in a card ask again; file:line opens
 * the file's skeleton beside the map.
 */
export function GraphifyPanel({ api, project, active, onUpdated, onOpen }: { api: Api; project: number; active: boolean; onUpdated: () => void; onOpen: OnOpen }) {
  const [fast, setFast] = useState(false);
  const st = usePoll<{ installed: boolean; graph: boolean; update: GraphifyUpdate | null }>(api, `/api/codemap/graphify?project=${project}`, fast ? UPDATE_POLL_MS : IDLE_POLL_MS, active);
  const running = st.data?.update?.state === "running";
  // Poll fast only while an update runs; when one ends, the status above re-reads graph.html.
  if (st.data && running !== fast) setFast(running);
  useEffect(() => {
    if (!fast) onUpdated();
  }, [fast, onUpdated]);
  const [mode, setMode] = useState<Mode>("explain");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  const update = async () => {
    try {
      await api(`/api/codemap/graphify`, { method: "POST", body: { project, action: "update" } });
      setFast(true);
      st.reload();
    } catch (e) {
      toast.error(`graphify: ${(e as Error).message}`);
    }
  };
  const run = async (q: Asked) => {
    if (busy || !q.a.trim() || (q.mode === "path" && !q.b.trim())) return;
    setMode(q.mode);
    setA(q.a);
    setB(q.b);
    setBusy(true);
    try {
      const body = q.mode === "explain" ? { project, action: "explain", symbol: q.a } : { project, action: "path", a: q.a, b: q.b };
      const r = await api<{ text: string; cached: boolean; answer: GraphifyAnswer }>(`/api/codemap/graphify`, { method: "POST", body });
      setRes({ asked: q, answer: r.answer, text: r.text, cached: r.cached, error: null });
    } catch (err) {
      setRes({ asked: q, answer: null, text: null, cached: false, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ mode, a: a.trim(), b: b.trim() });
  };
  const explain = (symbol: string) => void run({ mode: "explain", a: symbol, b: "" });
  const endRef = useRef<HTMLInputElement>(null);
  /** "Tìm đường từ đây": the node becomes the start, the owner types where to. */
  const pathFrom = (id: string) => {
    setMode("path");
    setA(id);
    setB("");
    requestAnimationFrame(() => endRef.current?.focus());
  };

  const u = st.data?.update;
  const noGraph = st.data != null && !st.data.graph && !running;
  const status =
    st.data && !st.data.installed
      ? "chưa cài graphify: chạy `8sync setup`"
      : running
        ? "đang dựng graph…"
        : u?.state === "done"
          ? `graph cập nhật ${agoVi(u.endedAt ?? u.startedAt, st.at || (u.endedAt ?? u.startedAt))}`
          : u?.state === "failed"
            ? "cập nhật graph lỗi"
            : noGraph
              ? "repo chưa có graph"
              : "đọc từ graph của repo, không gọi model";
  return (
    <section aria-labelledby="graphify-h" className="space-y-3 rounded-lg border px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <NetworkIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 id="graphify-h" className="text-sm font-semibold">
            Hỏi đồ thị code
          </h3>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {status}
          </p>
        </div>
        <Button type="button" size="sm" variant={noGraph ? "default" : "outline"} className="max-sm:h-11" disabled={running || st.data?.installed === false} onClick={() => void update()}>
          {running ? <LoaderIcon className="animate-spin motion-reduce:animate-none" /> : <RefreshCwIcon />}
          {noGraph ? "Dựng graph" : "Cập nhật graph"}
        </Button>
      </div>
      {running && <div role="progressbar" aria-label="Đang dựng graph" className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full w-1/4 animate-pulse rounded-full bg-primary motion-reduce:animate-none" /></div>}
      {u?.error && <Problem text={u.error} />}
      {u?.tail && (running || u.state === "failed") && <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px] break-all whitespace-pre-wrap text-muted-foreground">{u.tail}</pre>}

      <form onSubmit={submit} className="space-y-2">
        <div role="radiogroup" aria-label="Hỏi gì" className="grid grid-cols-2 rounded-lg border p-0.5 sm:inline-grid">
          {(
            [
              ["explain", "Giải thích", SearchIcon],
              ["path", "Đường đi", RouteIcon],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-checked:bg-muted aria-checked:text-foreground motion-reduce:transition-none",
                TAP,
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={a}
            onChange={(e) => setA(e.target.value)}
            maxLength={SYMBOL_MAX}
            placeholder={mode === "explain" ? "Tên hàm, class hay file: checkAuth()" : "Từ: POST()"}
            aria-label={mode === "explain" ? "Ký hiệu cần giải thích" : "Điểm đầu"}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-9 min-w-0 font-mono text-sm max-sm:h-11 max-sm:text-base sm:flex-1"
          />
          {mode === "path" && (
            <>
              <Button type="button" variant="ghost" size="icon-sm" className="self-center max-sm:size-11" aria-label="Đảo điểm đầu và điểm cuối" onClick={() => (setA(b), setB(a))}>
                <ArrowLeftRightIcon className="max-sm:rotate-90" />
              </Button>
              <Input
                value={b}
                onChange={(e) => setB(e.target.value)}
                maxLength={SYMBOL_MAX}
                placeholder="Đến: safeEqual()"
                aria-label="Điểm cuối"
                ref={endRef}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-9 min-w-0 font-mono text-sm max-sm:h-11 max-sm:text-base sm:flex-1"
              />
            </>
          )}
          <Button type="submit" disabled={busy || !a.trim() || (mode === "path" && !b.trim())} className="h-9 max-sm:h-11">
            {busy ? <LoaderIcon className="animate-spin motion-reduce:animate-none" /> : mode === "explain" ? <SearchIcon /> : <RouteIcon />}
            {mode === "explain" ? "Giải thích" : "Tìm đường"}
          </Button>
        </div>
      </form>

      {res && (
        <div aria-live="polite" aria-busy={busy} className={cn("space-y-2", busy && "opacity-60")}>
          {res.error ? (
            <Problem text={res.error} onRetry={() => void run(res.asked)} />
          ) : res.answer ? (
            <AnswerView answer={res.answer} asked={res.asked} run={(q) => void run(q)} explain={explain} pathFrom={pathFrom} onOpen={onOpen} />
          ) : null}
          {res.text && (
            <details className="text-xs text-muted-foreground">
              <summary className={cn("inline-flex cursor-pointer items-center rounded outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60", TAP)}>
                Bản in gốc của graphify{res.cached && " · lấy lại từ bộ nhớ (hỏi lại trong 1 phút)"}
              </summary>
              <pre className="mt-1 max-h-72 overflow-auto rounded-md border bg-muted/30 px-2 py-1.5 font-mono text-[11px] break-all whitespace-pre-wrap">{res.text}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function WhereButton({ where, onOpen }: { where: Where; onOpen: OnOpen }) {
  const label = `${where.file}${where.line != null ? `:${where.line}` : ""}`;
  return (
    <button
      type="button"
      onClick={() => onOpen(where.file, where.line)}
      title={`Xem khung ${label}`}
      className={cn("block max-w-full min-w-0 truncate rounded text-left font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60", TAP)}
    >
      {label}
    </button>
  );
}

function AnswerView({
  answer,
  asked,
  run,
  explain,
  pathFrom,
  onOpen,
}: {
  answer: GraphifyAnswer;
  asked: Asked;
  run: (q: Asked) => void;
  explain: (s: string) => void;
  pathFrom: (id: string) => void;
  onOpen: OnOpen;
}) {
  switch (answer.kind) {
    case "explain":
      return <ExplainCard x={answer} explain={explain} onOpen={onOpen} pathFrom={pathFrom} />;
    case "path":
      return <PathList p={answer} explain={explain} />;
    case "ambiguous":
      return (
        <div className="rounded-lg border">
          <p className="border-b px-3 py-2 text-sm">
            <span className="font-mono">{answer.query}</span> khớp {answer.candidates.length} chỗ, chọn một:
          </p>
          <ul className="divide-y">
            {answer.candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  // Ask again with the picked id in place of the ambiguous name (either end of a path).
                  onClick={() => run(asked.mode === "path" && asked.b === answer.query ? { ...asked, b: c.id } : { ...asked, a: c.id })}
                  className="block w-full min-w-0 px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset max-sm:min-h-11"
                >
                  <span className="block truncate font-mono text-xs">{c.file}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{c.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    case "missing":
      return (
        <Note>
          Không thấy <span className="font-mono">{answer.query}</span> trong graph. Thử tên kèm ngoặc như <span className="font-mono">checkAuth()</span>, tên file như <span className="font-mono">auth.ts</span>, hoặc bấm Cập nhật graph nếu code vừa đổi.
        </Note>
      );
    case "nopath":
      return (
        <Note>
          <span className="block">
            Không có đường gọi một chiều từ <span className="font-mono">{answer.from}</span> tới <span className="font-mono">{answer.to}</span>.
          </span>
          <Button type="button" size="sm" variant="outline" className="mt-2 max-sm:h-11" onClick={() => run({ mode: "path", a: asked.b, b: asked.a })}>
            <ArrowLeftRightIcon /> Thử chiều ngược lại
          </Button>
        </Note>
      );
    case "text":
      return <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">{answer.text}</pre>;
  }
}

function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-pretty">{children}</div>;
}

/** One node: where it is, who calls it, what it calls, the rest of its links. */
function ExplainCard({ x, explain, onOpen, pathFrom }: { x: ExplainAnswer; explain: (s: string) => void; onOpen: OnOpen; pathFrom: (id: string) => void }) {
  const groups: [string, Link[]][] = [
    ["Nơi gọi", x.callers],
    ["Gọi tới", x.callees],
    ["Liên quan khác", x.related],
  ];
  return (
    <article aria-label={`Giải thích ${x.name}`} className="rounded-lg border">
      <header className="space-y-1 border-b px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h4 className="min-w-0 font-mono text-base font-semibold break-all">{x.name}</h4>
          {x.type && <span className="text-[11px] text-muted-foreground">{x.type}</span>}
          {x.degree != null && <span className="text-[11px] text-muted-foreground tabular">{x.degree} liên kết</span>}
        </div>
        {x.where && <WhereButton where={x.where} onOpen={onOpen} />}
        {x.id && (
          <Button type="button" size="sm" variant="outline" className="mt-1 max-sm:h-11" onClick={() => pathFrom(x.id!)}>
            <RouteIcon /> Tìm đường từ đây
          </Button>
        )}
      </header>
      {groups.map(([title, links]) =>
        links.length === 0 ? null : (
          <section key={title} aria-label={title} className="border-b last:border-b-0">
            <h5 className="px-3 pt-2 text-xs font-semibold text-muted-foreground">
              {title} <span className="font-normal tabular">({links.length})</span>
            </h5>
            <ul className="pb-1">
              {links.map((l, i) => (
                <li key={`${l.dir}:${l.name}:${i}`} className="flex min-w-0 flex-col px-3 py-1 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    {l.relation !== "calls" && <span className="shrink-0 text-[11px] text-muted-foreground">{l.dir === "in" ? "←" : "→"} {relationVi(l.relation)}</span>}
                    <button
                      type="button"
                      // A caller lives in the file of its link: `file::name` keeps graphify from asking which one.
                      onClick={() => explain(l.relation === "calls" && l.dir === "in" && l.where ? `${l.where.file}::${l.name}` : l.name)}
                      title={`Giải thích ${l.name}`}
                      className={cn("min-w-0 truncate rounded text-left font-mono text-[13px] font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60", TAP)}
                    >
                      {l.name}
                    </button>
                    {CONFIDENCE_VI[l.confidence] && <span className="shrink-0 text-[11px] text-amber-700 dark:text-amber-300">{CONFIDENCE_VI[l.confidence]}</span>}
                  </span>
                  {l.where && (
                    <span className="min-w-0 sm:ml-auto">
                      <WhereButton where={l.where} onOpen={onOpen} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      {x.callers.length + x.callees.length + x.related.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">graphify không thấy liên kết nào của nút này.</p>}
      {x.more > 0 && <p className="border-t px-3 py-2 text-xs text-muted-foreground tabular">+{x.more} liên kết nữa graphify không liệt kê (chỉ hiện 20 liên kết nhiều nhất)</p>}
    </article>
  );
}

/** A path: each node in order, the edge that leads to the next between them. */
function PathList({ p, explain }: { p: PathAnswer; explain: (s: string) => void }) {
  const first = p.steps[0].name;
  const last = p.steps[p.steps.length - 1].name;
  return (
    <article aria-label={`Đường đi từ ${first} tới ${last}`} className="rounded-lg border">
      <header className="border-b px-3 py-2">
        <h4 className="text-sm font-semibold">
          {p.hops} bước từ <span className="font-mono">{first}</span> tới <span className="font-mono">{last}</span>
        </h4>
        {p.confidence && CONFIDENCE_VI[p.confidence] && <p className="text-xs text-amber-700 dark:text-amber-300">Có bước graphify {CONFIDENCE_VI[p.confidence]}, nên kiểm lại trong code.</p>}
      </header>
      <ol className="px-3 py-2">
        {p.steps.map((s, i) => (
          <li key={`${s.name}:${i}`}>
            {s.via && (
              <span className="flex items-center gap-1.5 py-0.5 pl-[11px] text-[11px] text-muted-foreground">
                <ArrowDownIcon aria-hidden className={cn("size-3", s.via.back && "rotate-180")} />
                {relationVi(s.via.relation)}
                {CONFIDENCE_VI[s.via.confidence] && <span className="text-amber-700 dark:text-amber-300">· {CONFIDENCE_VI[s.via.confidence]}</span>}
              </span>
            )}
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => explain(s.name)}
                title={`Giải thích ${s.name}`}
                className={cn("min-w-0 truncate rounded text-left font-mono text-[13px] font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60", TAP)}
              >
                {s.name}
              </button>
            </span>
          </li>
        ))}
      </ol>
    </article>
  );
}
