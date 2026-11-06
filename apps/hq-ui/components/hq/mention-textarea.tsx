"use client";

import { FileIcon, FolderIcon, FolderUpIcon, SlashIcon } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { applyCommand, applyPick, filterCommands, filterEntries, mentionAt, slashAt, type Entry, type Mention, type Slash, type SlashCommand } from "@/lib/mention";
import { cn } from "@/lib/utils";
import type { Api } from "./use-hq";

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
  /** Folder "@" paths start from (the project root or the room's cwd); null = no picker. */
  base: string | null;
  api: Api;
  /** The "/command" picker (omp and Claude commands); off for a shell, where "/" starts a path. */
  commands?: boolean;
};

/**
 * A Textarea with an "@path" picker: it lists the folder ("@src/" one level down, "@../" one level
 * up, out of the project too; a folder keeps the list open), and a "/command" picker at the start
 * or after a space (omp and Claude commands, GET /api/commands). ↑/↓ choose, Enter or Tab picks, Esc
 * closes; a tap picks on a phone.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea({ value, onValueChange, base, api, commands = true, onKeyDown, className, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current!, []);
  const [m, setM] = useState<Mention | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState(0);
  const [sl, setSl] = useState<Slash | null>(null);
  // Loaded on the first "/" typed, then kept (the server caches the list 30 s).
  const [cmds, setCmds] = useState<SlashCommand[] | null>(null);
  const listId = useRef(`mention-${Math.random().toString(36).slice(2)}`).current;

  // Grows with its lines: CSS `field-sizing: content` where supported (Chromium), else measured here
  // (Safari, Firefox: the phone link). The className's max-h caps it; past that it scrolls.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [value]);

  // One listing per folder typed; the prefix only filters.
  const dirKey = m && base ? `${base}\0${m.dir}` : null;
  useEffect(() => {
    if (!dirKey || !base || !m) return;
    const ac = new AbortController();
    const q = new URLSearchParams({ base, path: m.dir });
    api<{ entries: Entry[] }>(`/api/fs?${q}`, { signal: ac.signal })
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dirKey carries base + dir
  }, [dirKey]);

  const wantCmds = sl != null && cmds == null;
  useEffect(() => {
    if (!wantCmds) return;
    const ac = new AbortController();
    api<{ commands: SlashCommand[] }>("/api/commands", { signal: ac.signal })
      .then((r) => setCmds(r.commands))
      .catch(() => {
        if (!ac.signal.aborted) setCmds([]);
      });
    return () => ac.abort();
  }, [wantCmds, api]);

  const cmdShown = sl && cmds ? filterCommands(cmds, sl.prefix) : [];
  const slash = cmdShown.length > 0;
  const shown = m && !slash ? filterEntries(entries, m.prefix) : [];
  const count = slash ? cmdShown.length : shown.length;
  const open = count > 0;

  const sync = (text: string, caret: number) => {
    setM(base ? mentionAt(text, caret) : null);
    setSl(commands ? slashAt(text, caret) : null);
    setActive(0);
  };

  const place = (text: string, caret: number) => {
    onValueChange(text);
    requestAnimationFrame(() => {
      const el = inner.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      sync(text, caret);
    });
  };

  const pick = (e: Entry) => {
    if (!m) return;
    const r = applyPick(value, m, e);
    place(r.text, r.caret);
    if (!r.open) setM(null);
  };

  const pickCmd = (c: SlashCommand) => {
    if (!sl) return;
    const r = applyCommand(value, sl, c);
    place(r.text, r.caret);
    setSl(null);
  };

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if ((e.key === "Enter" && !e.nativeEvent.isComposing) || e.key === "Tab") {
        e.preventDefault();
        const i = Math.min(active, count - 1);
        if (slash) pickCmd(cmdShown[i]);
        else pick(shown[i]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setM(null);
        setSl(null);
        return;
      }
    }
    onKeyDown?.(e);
  }

  const optionClass = (i: number) => cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs", i === active && "bg-accent text-accent-foreground");
  // Above the box. On a phone the box sits in the composer dock, a scrolling sheet that clips an
  // absolute popover at its top edge (owner 2026-11-06: "gợi ý bị khuất"), so there the list is in the
  // flow above the box and the sheet grows; touch rows are taller.
  const listClass =
    "z-50 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md max-sm:mb-2 max-sm:max-h-[min(40dvh,18rem)] max-sm:[&_[role=option]]:min-h-10 sm:absolute sm:bottom-full sm:left-0 sm:mb-1 sm:max-w-md";

  return (
    <div className="relative flex flex-col">
      {open && slash && sl && (
        <ul id={listId} role="listbox" aria-label="Lệnh" className={listClass}>
          <li aria-hidden className="px-2 py-1 font-mono text-[11px] text-muted-foreground">
            /{sl.prefix} · ↑↓ chọn · Enter/Tab · Esc đóng
          </li>
          {cmdShown.map((c, i) => (
            <li
              key={`${c.source}:${c.name}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={optionClass(i)}
              onMouseDown={(ev) => {
                ev.preventDefault();
                pickCmd(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <SlashIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="shrink-0 font-mono">{c.name}</span>
              {c.description && <span className="min-w-0 truncate text-muted-foreground">{c.description}</span>}
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground uppercase">{c.source}</span>
            </li>
          ))}
        </ul>
      )}
      {open && !slash && m && (
        <ul id={listId} role="listbox" aria-label={`Tệp và thư mục trong ${m.dir || "./"}`} className={listClass}>
          <li aria-hidden className="px-2 py-1 font-mono text-[11px] text-muted-foreground">
            @{m.dir || "./"} · ↑↓ chọn · Enter/Tab · ../ lên một cấp
          </li>
          {shown.map((e, i) => (
            <li
              key={`${e.dir ? "d" : "f"}:${e.name}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn(optionClass(i), "font-mono")}
              onMouseDown={(ev) => {
                ev.preventDefault();
                pick(e);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {e.name === ".." ? <FolderUpIcon className="size-3.5 shrink-0" aria-hidden /> : e.dir ? <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="truncate">
                {e.name}
                {e.dir && e.name !== ".." ? "/" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        {...rest}
        ref={inner}
        value={value}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={keys}
        onClick={(e) => sync(value, e.currentTarget.selectionStart ?? value.length)}
        onBlur={() =>
          setTimeout(() => {
            setM(null);
            setSl(null);
          }, 120)
        }
      />
    </div>
  );
});
