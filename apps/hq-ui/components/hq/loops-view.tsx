"use client";

import { ChevronRightIcon, CopyIcon, RepeatIcon, SendIcon, TerminalSquareIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { entryFor, useFollowRepo } from "@/lib/follow-repo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { eccxArgs, eccxExample, eccxFlags, eccxLine, eccxMessage, eccxReaches, type EccxCommand } from "@/lib/eccx";
import { agoShort } from "@/lib/now";
import type { ProjectLoops } from "@/lib/server/loops";
import { cn } from "@/lib/utils";
import { ErrorNote } from "./bits";
import { RoomSend, TOUCH } from "./room-send";
import { makeApi } from "./use-hq";
import type { Room } from "./use-office";

export type LoopsState = { data: { projects: ProjectLoops[]; commands?: EccxCommand[] } | null; error: string | null; at: number };

/** "Vòng lặp" tab: each `/ship-loop` of the project in view (`su-code/ship/*`), then the `/eccx-loop-*` and `/eccx-*` commands to copy or send into a room. */
export function LoopsView({ loops, repo = null, token, rooms }: { loops: LoopsState; repo?: string | null; token: string; rooms: Room[] }) {
  const [pick, setPick] = useState<string | null>(repo);
  useFollowRepo(repo, setPick);
  const list = useMemo(() => loops.data?.projects ?? [], [loops.data]);
  const cur = (pick ? entryFor(list, pick) : undefined) ?? list[0];
  const rows = cur?.loops ?? [];
  const now = loops.at;

  return (
    <div className="h-full overflow-y-auto">
      <section aria-labelledby="loops" className="max-w-5xl space-y-3 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 id="loops" className="flex items-center gap-1.5 text-sm font-semibold">
            <RepeatIcon aria-hidden className="size-3.5 text-muted-foreground" />
            Vòng lặp
            <span className="text-xs font-normal text-muted-foreground">/ship-loop, đọc từ su-code/ship/*/LOOP.md</span>
          </h2>
          {list.length > 1 && (
            <Select value={cur?.root ?? ""} onValueChange={setPick}>
              <SelectTrigger size="sm" className="ml-auto max-w-64 text-xs" aria-label="Dự án">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.map((p) => (
                  <SelectItem key={p.root} value={p.root} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {loops.error && !loops.data ? (
          <ErrorNote what="vòng lặp" error={loops.error} />
        ) : !loops.data ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Chưa có vòng lặp nào{cur ? ` trong ${cur.name}` : ""}. Khi anh chạy <code className="font-mono">/ship-loop</code> hay một lệnh <code className="font-mono">/eccx-loop-*</code> bên dưới, mỗi lượt kiểm ghi một dòng bằng chứng ở đây.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {rows.map((l) => (
              <li key={l.slug} className="grid grid-cols-[minmax(8rem,14rem)_auto_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-2">
                <span className="truncate font-medium" title={l.slug}>
                  {l.slug}
                </span>
                <span className="text-xs whitespace-nowrap tabular">
                  {l.iter != null ? `lượt ${l.iter}${l.maxIter != null ? `/${l.maxIter}` : ""}` : "chưa chạy lượt"}
                  <span className={cn("ml-2", l.running ? "font-medium text-st-running" : "text-muted-foreground")}>{l.running ? "đang chạy" : l.stopped ? `dừng: ${l.stopped}` : "không rõ"}</span>
                </span>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={l.last ?? undefined}>
                  {l.last ?? "chưa có bằng chứng"} <span className="font-sans">· {agoShort(l.at, now)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {loops.data && <EccxCommands commands={loops.data.commands ?? []} token={token} rooms={rooms} root={cur?.root ?? repo} />}
    </div>
  );
}

/** The installed eccx commands: loops first, then the one-shot plans (folded) and utilities. */
function EccxCommands({ commands, token, rooms, root }: { commands: EccxCommand[]; token: string; rooms: Room[]; root: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const loops = commands.filter((c) => c.kind === "loop");
  const rest = commands.filter((c) => c.kind !== "loop");
  const toggle = useCallback((name: string) => setOpen((o) => (o === name ? null : name)), []);
  const row = (c: EccxCommand) => <EccxRow key={c.name} c={c} open={open === c.name} onToggle={toggle} token={token} rooms={rooms} root={root} />;

  return (
    <section aria-labelledby="eccx-cmds" className="max-w-5xl space-y-3 px-4 pb-6 sm:px-6">
      <h2 id="eccx-cmds" className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-semibold">
        <span className="flex items-center gap-1.5">
          <TerminalSquareIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Lệnh eccx
        </span>
        <span className="text-xs font-normal text-muted-foreground">chép lệnh, hoặc gõ mục tiêu rồi gửi thẳng vào một phiên</span>
      </h2>
      {commands.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Chưa thấy lệnh eccx nào trong <code className="font-mono">~/.claude/commands</code> hay <code className="font-mono">~/.omp/agent/commands</code>. Chạy <code className="font-mono">8sync ccc kit</code> để cài.
        </p>
      ) : (
        <>
          {loops.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">/eccx-loop-* · {loops.length} lệnh, chỉ phiên Claude Code</h3>
              <p className="text-xs text-pretty text-muted-foreground">
                Lặp tới khi xanh: mỗi tiêu chí một lệnh kiểm, mỗi lượt ghi bằng chứng vào su-code/ship/&lt;slug&gt;/LOOP.md (hiện ở bảng trên), dừng khi hết lượt, hết giờ hoặc kẹt. Dừng sớm: <code className="font-mono">/eccx-clear &lt;slug&gt;</code>.
              </p>
              <ul className="divide-y rounded-lg border">{loops.map(row)}</ul>
            </div>
          )}
          {rest.length > 0 && (
            <details className="group space-y-1.5" open={loops.length === 0}>
              <summary className={cn("flex cursor-pointer list-none items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden", "max-sm:min-h-11")}>
                <ChevronRightIcon aria-hidden className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                /eccx-* · chạy một lần · {rest.length} lệnh
              </summary>
              <ul className="divide-y rounded-lg border">{rest.map(row)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

async function copy(line: string) {
  try {
    await navigator.clipboard.writeText(line);
    toast.success(`Đã chép: ${line}`);
  } catch {
    toast.message(`Lệnh: ${line}`);
  }
}

const ENGINE = { claude: "Claude Code", omp: "omp" } as const;

function EccxRow({ c, open, onToggle, token, rooms, root }: { c: EccxCommand; open: boolean; onToggle: (name: string) => void; token: string; rooms: Room[]; root: string | null }) {
  const example = eccxExample(c);
  const flags = eccxFlags(c.hint);
  const api = useMemo(() => makeApi(token), [token]);
  const reach = useMemo(() => rooms.filter((r) => eccxReaches(c, r.engine)), [rooms, c]);
  const prepare = useCallback(async (typed: string, room: Room) => ({ text: eccxMessage(c.name, typed, room), files: [] }), [c.name]);
  const domId = `eccx-${c.name}`;
  const goal = c.hint.includes("<goal>");

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-mono font-medium">/{c.name}</span>
            {c.kind !== "util" && <span className="text-xs text-muted-foreground">{c.title}</span>}
            <span className="text-[11px] text-muted-foreground">{c.engines.map((e) => ENGINE[e]).join(" · ")}</span>
          </p>
          <p className="mt-0.5 text-xs text-pretty text-muted-foreground" title={c.description || undefined}>
            {eccxLine(c)}
            {c.scope && <span> Phạm vi: {c.scope}.</span>}
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs break-all">{example}</code>
            {flags && <span className="font-mono text-[11px] text-muted-foreground">{flags}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full">
          <Button type="button" size="sm" variant="outline" className={cn("text-xs", TOUCH, "max-sm:flex-1")} aria-label={`Chép ${example}`} onClick={() => void copy(example)}>
            <CopyIcon aria-hidden /> Chép
          </Button>
          <Button type="button" size="sm" variant={open ? "secondary" : "default"} className={cn("text-xs", TOUCH, "max-sm:flex-1")} aria-expanded={open} aria-controls={open ? `${domId}-send` : undefined} onClick={() => onToggle(c.name)}>
            <SendIcon aria-hidden /> Gửi vào phiên
          </Button>
        </div>
      </div>
      {open && (
        <div id={`${domId}-send`} className="mt-2.5">
          <RoomSend
            api={api}
            token={token}
            rooms={reach}
            id={domId}
            preferRoot={root}
            placeholder={goal ? `Mục tiêu cho /${c.name}, vd: trang giá hiển thị đúng trên điện thoại (Ctrl+Enter để gửi)` : `${eccxArgs(c.hint) || "Tham số"} cho /${c.name} (Ctrl+Enter để gửi)`}
            prepare={prepare}
            onSent={() => onToggle(c.name)}
          >
            <p className="mb-1.5 text-xs text-muted-foreground">
              Gửi đi: <code className="font-mono">/{c.name} {goal ? "<mục tiêu anh gõ>" : "<tham số anh gõ>"}</code>
              {c.kind === "loop" ? ". Chỉ phiên Claude Code chạy được lệnh lặp." : c.engines.length === 1 ? `. Chỉ phiên ${ENGINE[c.engines[0]]} có lệnh này.` : "."}
            </p>
          </RoomSend>
        </div>
      )}
    </li>
  );
}
