"use client";

import { LightbulbIcon, ListChecksIcon, Loader2Icon, PaperclipIcon, SendIcon, UsersIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FILE_MAX_MB, FILES_MAX, fileError, toBase64 } from "@/lib/attach";
import { ALL_PROJECTS, broadcastProjects, broadcastSummary, choiceValid, isSendKey, resolveChoice, resultLine, sendOutcome, type BroadcastResult } from "@/lib/broadcast";
import { inboxText } from "@/lib/labels";
import { leadOf, parseTarget, roomGroups, suggestion, targetValue, type SendTarget } from "@/lib/room-send";
import { parseSlash, slashSend, type SlashRoom } from "@/lib/slash";
import { groupKey } from "@/lib/sidebar";
import type { Message } from "./types";
import { cn } from "@/lib/utils";
import { MentionTextarea } from "./mention-textarea";
import { shipLoopsChanged } from "./ship-loop-chip";
import { ApiError, type Api } from "./use-hq";
import type { Room } from "./use-office";

export type Upload = { id: string; name: string; size: number };

/** Phones: every control in the toolbar is a 44 px touch target; desktop keeps the dense row. */
const TOUCH = "max-sm:h-11 max-sm:min-w-11";

/**
 * The composer every "send to rooms" surface shares (Chat tổng, Preview "Hỏi về ảnh này"): one
 * specific room (POST /api/messages) or every room of a project / of all projects (POST
 * /api/targets, `8sync ccc auto add`), files (upload, paste, `@path`), and the lead suggestion.
 */
export function RoomSend({
  api,
  rooms,
  id,
  preferRoot,
  preferRoom,
  placeholder,
  prepare,
  allowEmpty = false,
  reserve = 0,
  onMessage,
  onSent,
  className,
  children,
}: {
  api: Api;
  rooms: Room[];
  /** DOM id prefix (two composers can be mounted at once). */
  id: string;
  /** The project in scope: the default "Mọi phòng" target. */
  preferRoot?: string | null;
  /** Room key picked first (Preview: the room that saved the image) until the owner picks. */
  preferRoom?: string | null;
  placeholder: string;
  /** Builds the text actually sent (Preview: image path + pins) and adds uploads made at send time. */
  prepare?: (typed: string) => Promise<{ text: string; files: Upload[] }>;
  /** Send with an empty box (Preview: the pins carry the question). */
  allowEmpty?: boolean;
  /** File slots `prepare` will use (the pinned PNG). */
  reserve?: number;
  /** The stored owner message of a one-room send, for the timeline. */
  onMessage?: (m: Message) => void;
  onSent?: () => void;
  className?: string;
  /** Above the box (Preview: the pin list). */
  children?: ReactNode;
}) {
  const projects = useMemo(() => broadcastProjects(rooms), [rooms]);
  const groups = useMemo(() => roomGroups(rooms), [rooms]);
  const [picked, setPicked] = useState<SendTarget | null>(null);
  const [text, setText] = useState("");
  const [now, setNow] = useState(true);
  const [check, setCheck] = useState("");
  const [showCheck, setShowCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; text: string }[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(0);

  const byKey = (k: string | null | undefined) => (k ? groups.flatMap((g) => g.rooms).find((r) => r.key === k) ?? null : null);
  const valid = (t: SendTarget | null): t is SendTarget => (t?.kind === "room" ? !!byKey(t.key) : !!t && choiceValid(t.root, projects));
  // The owner's pick while it still exists; else the preferred room; else every room of the project in scope.
  // A pick whose room or project went away is forgotten, so it never snaps back unseen.
  if (picked && !valid(picked)) setPicked(null);
  const chosen: SendTarget = valid(picked) ? picked : byKey(preferRoom) ? { kind: "room", key: preferRoom! } : { kind: "all", root: resolveChoice(null, projects, preferRoot) };
  const chosenRoom = chosen.kind === "room" ? byKey(chosen.key) : null;
  // The project in view: its rooms are what "/" offers, its lead takes the /hq-* presets.
  const group = chosenRoom
    ? groups.find((g) => g.rooms.includes(chosenRoom))
    : groups.find((g) => {
        const want = chosen.kind === "all" && chosen.root !== ALL_PROJECTS ? chosen.root : preferRoot;
        return want != null && groupKey(g.root) === groupKey(want);
      }) ?? null;
  const slashRooms: SlashRoom[] = useMemo(() => (group?.rooms ?? []).map((r) => ({ key: r.key, name: r.name, label: r.label })), [group]);
  // A "/…" command overrides the target for this send only (lib/slash.ts).
  const slash = parseSlash(text, slashRooms);
  const plan = slashSend(slash, { target: chosen, root: group?.root ?? null, lead: group ? leadOf(group.rooms) : null, rooms: slashRooms });
  const target: SendTarget = plan.ok ? plan.target : chosen;
  const room = target.kind === "room" ? byKey(target.key) : null;
  const sug = group ? suggestion(group.rooms) : null;
  const showSug = sug && !(room && room.key === sug.room) && slash.kind === "none";
  const allRoot = target.kind === "all" ? target.root : null;
  const total = room ? 1 : (allRoot === ALL_PROJECTS ? projects : projects.filter((p) => p.root === allRoot)).reduce((n, p) => n + p.rooms.length, 0);
  const disabled = total === 0;
  const slots = FILES_MAX - reserve;

  async function attach(list: File[]) {
    const free = slots - files.length - uploading;
    if (list.length > free) toast.warning(`Tối đa ${slots} file mỗi lần gửi`);
    for (const f of list.slice(0, Math.max(0, free))) {
      const why = fileError(f);
      if (why) {
        toast.error(why);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const up = await api<Upload>("/api/uploads", { method: "POST", body: { name: f.name || "anh-dan.png", data: await toBase64(f) } });
        setFiles((xs) => [...xs, up]);
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length === 0) return;
    e.preventDefault();
    void attach(pasted);
  }

  function done() {
    setText("");
    setCheck("");
    setFiles([]);
    onSent?.();
    area.current?.focus();
  }

  /** The owner wrote to the project: a parked auto-ship loop runs again (`auto loop wake`, a no-op otherwise). */
  async function wakeLoop(root: string | null): Promise<void> {
    if (!root) return;
    try {
      await api("/api/auto/loop", { method: "POST", body: { root, wake: true } });
      shipLoopsChanged();
    } catch {
      /* older 8sync or no loop: nothing to wake */
    }
  }

  /** `/hq-auto-ship` / `/hq-stop`: the project's loop (POST /api/auto/loop → `8sync ccc auto loop on|off`); its result line. */
  async function switchLoop(l: { on: boolean; root: string; focus: string | null }): Promise<{ ok: boolean; text: string }> {
    try {
      const r = await api<{ line: string }>("/api/auto/loop", { method: "POST", body: l });
      shipLoopsChanged();
      return { ok: true, text: r.line };
    } catch (e) {
      return { ok: false, text: `Auto-ship: chưa ${l.on ? "bật" : "tắt"} được (${(e as Error).message})` };
    }
  }

  async function send() {
    if (!plan.ok) {
      setLast([{ ok: false, text: plan.error }]);
      toast.error(plan.error);
      return;
    }
    const typed = plan.text.trim();
    if ((!typed && !allowEmpty) || disabled || busy || uploading > 0) return;
    setBusy(true);
    try {
      const made = prepare ? await prepare(typed) : { text: typed, files: [] };
      const ids = [...files, ...made.files].map((f) => f.id);
      const loop = plan.loop;
      if (plan.fan) {
        // No lead: the brief goes to each room of the project as a message, never a card.
        const out: { ok: boolean; text: string }[] = [];
        for (const key of plan.fan) {
          const r = byKey(key);
          if (!r) continue;
          try {
            const m = await api<{ message: Message; delivery: string; live?: boolean; error: string | null }>("/api/messages", { method: "POST", body: { session: r.name, text: made.text, base: r.cwd, files: ids } });
            out.push({ ok: m.delivery !== "failed", text: `${r.label}: ${m.delivery === "inbox" ? inboxText(m.live) : "đã gõ vào terminal"}` });
          } catch (e) {
            out.push({ ok: false, text: `${r.label}: chưa gửi được (${(e as Error).message})` });
          }
        }
        setLast([...out, ...(loop ? [await switchLoop(loop)] : [])]);
        toast.success(`Đã gửi brief cho ${out.filter((x) => x.ok).length} phòng`);
        done();
        void wakeLoop(group?.root ?? null);
        return;
      }
      if (room) {
        const r = await api<{ message: Message; delivery: string; live?: boolean; error: string | null }>("/api/messages", {
          method: "POST",
          body: { session: room.name, text: made.text, base: room.cwd, files: ids },
        });
        onMessage?.(r.message);
        if (r.delivery === "failed") {
          setLast([{ ok: false, text: `${room.label}: chưa gửi được (${r.error ?? "lỗi không rõ"})` }]);
          toast.error(`Chưa gửi được tới ${room.label}`);
          return;
        }
        const how = r.delivery === "inbox" ? inboxText(r.live) : "đã gõ vào terminal";
        setLast([{ ok: true, text: `${room.label}: ${how}` }, ...(loop ? [await switchLoop(loop)] : [])]);
        toast.success(`Đã gửi cho ${room.label}`);
        done();
        void wakeLoop(group?.root ?? null);
        return;
      }
      const r = await api<{ results: BroadcastResult[] }>("/api/targets", {
        method: "POST",
        body: { text: made.text, now, check: showCheck ? check.trim() || null : null, root: allRoot, files: ids },
      });
      const lines = r.results.map((x) => ({ ok: x.ok, text: resultLine(x, now) }));
      const out = sendOutcome(r.results);
      setLast(out.clear && loop ? [...lines, await switchLoop(loop)] : lines);
      if (out.clear) {
        toast.success(now ? `Đã gửi việc cho ${out.sent} phòng` : "Việc đã vào hàng đích");
        done();
        void wakeLoop(allRoot && allRoot !== ALL_PROJECTS ? allRoot : group?.root ?? null);
      } else if (out.failed.length === r.results.length) toast.error("Chưa gửi được việc nào");
      // Some projects took it: keep the text so the owner can pick a failed project and send again.
      else toast.warning(`Chưa gửi được tới: ${out.failed.join(", ")} (xem dòng đỏ bên dưới)`);
    } catch (e) {
      if (e instanceof ApiError && e.message === "session-waiting") toast.error(`${room?.label ?? "Phòng"} đang chờ anh trả lời trong terminal: trả lời trước rồi gửi lại`);
      else toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSendKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      void send();
    }
  }

  const summary = room
    ? `Chỉ ${room.label}${group ? ` (${group.name})` : ""} nhận, ${room.delivery === "inbox" ? inboxText(room.inboxLive) : "gõ thẳng vào terminal của phòng"}.${room.waiting ? " Phòng đang chờ anh trả lời, trả lời trước rồi gửi." : ""}`
    : broadcastSummary(allRoot ?? "", projects, now);
  // What the "/…" command resolved to, before sending (or why it cannot be sent).
  const slashNote = !plan.ok
    ? plan.error
    : slash.kind === "preset"
      ? `/${slash.preset.cmd} → ${room ? room.label : `mọi phòng (${plan.fan?.length ?? 0}, không có lead)`}: gửi brief [HQ /${slash.preset.cmd}]${slash.preset.loop === "on" ? " và bật vòng auto-ship (8sync gửi lead vòng kế khi board cạn)" : slash.preset.loop === "off" ? " và tắt vòng auto-ship" : ""}.`
      : slash.kind === "all" || slash.kind === "room"
        ? `/${slash.kind === "all" ? "all" : slash.room.label}: chỉ cho lần gửi này.`
        : null;
  const titleId = `${id}-title`;
  const allTotal = projects.reduce((n, p) => n + p.rooms.length, 0);

  return (
    <form
      aria-labelledby={titleId}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h2 id={titleId} className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        {room ? <SendIcon className="size-3.5 text-muted-foreground" aria-hidden /> : <UsersIcon className="size-3.5 text-muted-foreground" aria-hidden />}
        {room ? `Gửi cho phòng ${room.label}` : "Gửi cho mọi phòng"}
      </h2>
      {children}
      {showSug && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/60 px-2 py-1.5 text-xs">
          <LightbulbIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 max-sm:line-clamp-2">
            <span className="font-medium">Tiết kiệm token: gửi cho {sug.label.toLowerCase() === "lead" ? "lead" : `lead ${sug.label}`}.</span>{" "}
            <span className="text-muted-foreground">{sug.line}</span>
          </span>
          <Button type="button" size="sm" variant="outline" className={cn("h-7 text-xs", TOUCH)} onClick={() => setPicked({ kind: "room", key: sug.room })}>
            Chọn {sug.label}
          </Button>
        </div>
      )}
      <div className="rounded-xl border bg-card transition-shadow duration-150 focus-within:ring-2 focus-within:ring-ring/40 motion-reduce:transition-none">
        <label htmlFor={id} className="sr-only">
          {room ? `Tin cho ${room.label}` : "Việc cho mọi phòng"}
        </label>
        <MentionTextarea
          id={id}
          ref={area}
          value={text}
          onValueChange={setText}
          base={room ? room.cwd : allRoot && allRoot !== ALL_PROJECTS ? allRoot : null}
          api={api}
          slashRooms={slashRooms}
          onKeyDown={onKey}
          onPaste={onPaste}
          disabled={disabled}
          rows={2}
          maxLength={2000}
          aria-describedby={slashNote ? `${id}-slash ${id}-summary` : `${id}-summary`}
          placeholder={placeholder}
          className="max-h-48 min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        {(files.length > 0 || uploading > 0) && (
          <ul className="flex flex-wrap gap-1.5 px-2 pb-2" aria-label="File đính kèm">
            {files.map((f) => (
              <li key={f.id} className="inline-flex max-w-56 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                <PaperclipIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate" title={f.name}>
                  {f.name}
                </span>
                <button
                  type="button"
                  className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-8"
                  aria-label={`Bỏ ${f.name}`}
                  onClick={() => setFiles((xs) => xs.filter((x) => x.id !== f.id))}
                >
                  <XIcon className="size-3" aria-hidden />
                </button>
              </li>
            ))}
            {uploading > 0 && <li className="px-1.5 py-0.5 text-xs text-muted-foreground">Đang tải {uploading} file…</li>}
          </ul>
        )}
        {showCheck && !room && (
          <div className="px-2 pb-2">
            <label htmlFor={`${id}-check`} className="sr-only">
              Lệnh kiểm
            </label>
            <Input
              id={`${id}-check`}
              value={check}
              onChange={(e) => setCheck(e.target.value)}
              maxLength={300}
              placeholder="Lệnh kiểm, các phòng chạy trong dự án (exit 0 = đạt), vd: pnpm test"
              className="h-7 font-mono text-xs max-sm:h-11 max-sm:text-base"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 pb-2">
          <Select value={targetValue(target)} onValueChange={(v) => setPicked(parseTarget(v))} disabled={projects.length === 0}>
            <SelectTrigger size="sm" className={cn("h-7 max-w-full min-w-0 gap-1.5 border-0 bg-muted/60 text-xs sm:max-w-[55%]", TOUCH, "max-sm:basis-full")} aria-label="Gửi tới">
              <SelectValue placeholder="Chưa có phòng" />
            </SelectTrigger>
            <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
              <SelectGroup>
                <SelectLabel>Mọi phòng</SelectLabel>
                {projects.map((p) => (
                  <SelectItem key={p.root} value={targetValue({ kind: "all", root: p.root })} className="text-xs">
                    Mọi phòng · {p.name} · {p.rooms.length} phòng
                  </SelectItem>
                ))}
                {projects.length > 1 && (
                  <SelectItem value={targetValue({ kind: "all", root: ALL_PROJECTS })} className="text-xs">
                    Mọi dự án · {allTotal} phòng
                  </SelectItem>
                )}
              </SelectGroup>
              {groups.map((g) => {
                const gl = leadOf(g.rooms);
                return (
                  <SelectGroup key={g.root}>
                    <SelectSeparator />
                    <SelectLabel>Một phòng · {g.name}</SelectLabel>
                    {g.rooms.map((r) => (
                      <SelectItem key={r.key} value={targetValue({ kind: "room", key: r.key })} className="text-xs">
                        {r.label}
                        <span className="text-muted-foreground">
                          {r.key === gl?.key && r.label.toLowerCase() !== "lead" ? " · lead" : ""}
                          {r.delivery === "inbox" ? " · inbox" : ""}
                          {r.waiting ? " · đang chờ anh" : ""}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
          {!room && (
            <label className={cn("flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors duration-150 hover:bg-muted motion-reduce:transition-none", TOUCH)}>
              <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} className="size-3.5 accent-primary max-sm:size-4" />
              Gửi ngay
            </label>
          )}
          {!room && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn("h-7 text-xs", TOUCH)}
              aria-expanded={showCheck}
              aria-controls={showCheck ? `${id}-check` : undefined}
              onClick={() => setShowCheck((v) => !v)}
            >
              <ListChecksIcon /> <span className="max-sm:sr-only">Lệnh kiểm</span>
            </Button>
          )}
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void attach([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn("h-7 text-xs", TOUCH)}
            disabled={disabled || files.length + uploading >= slots}
            title={`Ảnh, PDF hay file bất kỳ, tối đa ${slots} file, ${FILE_MAX_MB} MB mỗi file; dán ảnh thẳng vào ô cũng được. Phòng mở bằng Read.`}
            onClick={() => picker.current?.click()}
          >
            <PaperclipIcon /> <span className="max-sm:sr-only">Đính kèm</span>
          </Button>
          <Button type="submit" size="sm" className={cn("ml-auto", TOUCH, "max-sm:px-4")} disabled={disabled || busy || uploading > 0 || (!text.trim() && !allowEmpty)} aria-busy={busy}>
            {busy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden /> : room ? <SendIcon aria-hidden /> : <UsersIcon aria-hidden />}
            {/* Phones: a short visible label keeps the send button on the row with the other controls; the full name stays the accessible one. */}
            {busy ? (
              "Đang gửi…"
            ) : (
              <>
                <span aria-hidden className="sm:hidden">
                  Gửi
                </span>
                <span className="max-sm:sr-only">{room ? `Gửi ${room.label}` : "Gửi mọi phòng"}</span>
              </>
            )}
          </Button>
        </div>
      </div>
      {slashNote && (
        <p id={`${id}-slash`} role={plan.ok ? undefined : "alert"} className={cn("mt-1.5 text-xs font-medium", plan.ok ? "text-foreground" : "text-destructive")}>
          {slashNote}
        </p>
      )}
      {/* Phones: two lines; screen readers still get it whole (aria-describedby). */}
      <p id={`${id}-summary`} className="mt-1.5 text-xs text-muted-foreground max-sm:line-clamp-2">
        {summary}
        {room && sug?.room === room.key && ` Lead đọc một lần rồi chia việc cho ${sug.rooms - 1} phòng còn lại bằng \`8sync ccc msg\`.`}
      </p>
      {/* Mounted before the first send so screen readers announce the results when they arrive. */}
      <ul role="status" className="mt-1 space-y-0.5 text-xs empty:hidden">
        {last.map((l, i) => (
          <li key={i} className={l.ok ? "text-foreground" : "text-destructive"}>
            {l.text}
          </li>
        ))}
      </ul>
    </form>
  );
}
