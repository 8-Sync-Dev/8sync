"use client";

import { FileIcon, FolderIcon, FolderUpIcon } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { applyPick, filterEntries, mentionAt, type Entry, type Mention } from "@/lib/mention";
import { cn } from "@/lib/utils";
import type { Api } from "./use-hq";

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
  /** Folder "@" paths start from (the project root or the room's cwd); null = no picker. */
  base: string | null;
  api: Api;
};

/**
 * A Textarea with an "@path" picker: it lists the folder ("@src/" one level down, "@../" one level
 * up, out of the project too; a folder keeps the list open). ↑/↓ choose, Enter or Tab picks, Esc
 * closes; a tap picks on a phone.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea({ value, onValueChange, base, api, onKeyDown, className, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current!, []);
  const [m, setM] = useState<Mention | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState(0);
  const listId = useRef(`mention-${Math.random().toString(36).slice(2)}`).current;

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

  const shown = m ? filterEntries(entries, m.prefix) : [];
  const count = shown.length;
  const open = count > 0;

  const sync = (text: string, caret: number) => {
    setM(base ? mentionAt(text, caret) : null);
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

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if ((e.key === "Enter" && !e.nativeEvent.isComposing) || e.key === "Tab") {
        e.preventDefault();
        pick(shown[Math.min(active, count - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setM(null);
        return;
      }
    }
    onKeyDown?.(e);
  }

  const optionClass = (i: number) => cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs", i === active && "bg-accent text-accent-foreground");

  return (
    <div className="relative">
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
        onBlur={() => setTimeout(() => setM(null), 120)}
      />
      {open && m && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`Tệp và thư mục trong ${m.dir || "./"}`}
          className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-full max-w-md overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
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
    </div>
  );
});
