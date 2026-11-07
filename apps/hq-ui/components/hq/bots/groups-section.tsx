"use client";

import { CheckIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Bot } from "@/lib/bots";
import type { Group, GroupsView } from "@/lib/server/groups";
import type { Room } from "@/lib/server/office";
import { cn } from "@/lib/utils";
import type { Hq } from "../use-hq";
import { BotAvatar } from "./bot-avatar";
import { GroupAvatar } from "./group-avatar";

/**
 * "Nhóm" (under the bot roster, and the Nhóm page): one row per group (stacked faces, name, who is
 * in it) and "Nhóm mới". A row opens the group's thread (components/hq/bots/group-thread.tsx).
 */
export function GroupsSection({
  groups,
  all,
  selected,
  onOpen,
  onNew,
}: {
  groups: Group[];
  all: Bot<Room>[];
  selected: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const byId = new Map(all.map((b) => [b.room.name, b]));
  return (
    <section aria-label="Nhóm bot" className="py-1">
      <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
        <h3 className="text-xs font-medium text-muted-foreground">Nhóm</h3>
        <Button type="button" size="sm" variant="ghost" onClick={onNew} className="h-7 px-2 text-xs max-md:h-11">
          <UsersIcon aria-hidden /> Nhóm mới
        </Button>
      </div>
      {groups.length > 0 && (
        <ul aria-label="Nhóm">
          {groups.map((g) => {
            const faces = g.members.map((id) => ({ key: byId.get(id)?.key ?? id, status: byId.get(id)?.status ?? ("idle" as const) }));
            const names = g.members.map((id) => byId.get(id)?.display ?? "ngủ").join(", ");
            return (
              <li key={g.id}>
                <button
                  type="button"
                  data-group={g.id}
                  onClick={() => onOpen(g.id)}
                  aria-current={g.id === selected ? "true" : undefined}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left outline-none transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset motion-reduce:transition-none max-md:min-h-[64px]",
                    g.id === selected && "bg-muted",
                  )}
                >
                  <GroupAvatar emoji={g.emoji} faces={faces} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold tracking-tight">{g.name}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={names}>
                      {g.members.length} bot · {names}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** "Nhóm mới": a name and the live bots to put in it (PUT /api/groups). */
export function NewGroupDialog({ hq, open, onOpenChange, all, onCreated }: { hq: Hq; open: boolean; onOpenChange: (o: boolean) => void; all: Bot<Room>[]; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const ok = name.trim().length > 0 && picked.length > 0;

  async function create() {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const r = await hq.api<GroupsView & { group: Group }>("/api/groups", { method: "PUT", body: { group: { name: name.trim(), members: picked } } });
      onCreated(r.group.id);
      setName("");
      setPicked([]);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nhóm mới</DialogTitle>
          <DialogDescription>Trong nhóm, anh @ bot nào thì bot đó nhận việc; các bot nhắn nhau tối đa 3 hop mỗi lượt.</DialogDescription>
        </DialogHeader>
        <form
          id="new-group"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="space-y-1.5"
        >
          <label htmlFor="group-name" className="text-sm font-medium">
            Tên nhóm
          </label>
          <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder="Ví dụ: Nội dung tuần này" autoComplete="off" className="max-md:h-11" />
        </form>
        <fieldset className="min-h-0 space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium">
            Bot trong nhóm <span className="font-normal text-muted-foreground tabular">· đã chọn {picked.length}</span>
          </legend>
          {all.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có bot nào đang mở.</p>
          ) : (
            <ul className="max-h-[min(50dvh,20rem)] space-y-0.5 overflow-y-auto rounded-lg border p-1">
              {all.map((b) => {
                const on = picked.includes(b.room.name);
                return (
                  <li key={b.key}>
                    <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/70 has-focus-visible:ring-2 has-focus-visible:ring-ring/60 max-md:min-h-11", on && "bg-muted")}>
                      <input type="checkbox" checked={on} onChange={() => toggle(b.room.name)} className="peer sr-only" />
                      <span aria-hidden className={cn("grid size-4 shrink-0 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                        {on && <CheckIcon className="size-3" />}
                      </span>
                      <BotAvatar id={b.key} status={b.status} size={24} />
                      <span className="min-w-0 truncate font-medium">{b.display}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="max-md:h-11">
            Huỷ
          </Button>
          <Button type="submit" form="new-group" disabled={!ok || busy} className="max-md:h-11">
            Tạo nhóm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
