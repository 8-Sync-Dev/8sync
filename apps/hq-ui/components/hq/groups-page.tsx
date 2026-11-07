"use client";

import { UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Hq } from "./use-hq";
import { GroupThread } from "./bots/group-thread";
import { GroupsSection } from "./bots/groups-section";
import type { Roster } from "./bots/use-roster";

/**
 * Nhóm (owner 2026-11-07: Bots · Nhóm · Tìm · Thêm): the open group's thread; with none open, the
 * groups to pick from (the sidebar lists them too from md up) and "Nhóm mới".
 */
export function GroupsPage({
  hq,
  roster,
  groupId,
  mobile,
  onOpen,
  onBack,
  onNew,
}: {
  hq: Hq;
  roster: Roster;
  groupId: string | null;
  mobile: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  onNew: () => void;
}) {
  const group = roster.groups.find((g) => g.id === groupId) ?? null;
  if (group) return <GroupThread key={group.id} hq={hq} group={group} all={roster.all} mention={roster.mention} mobile={mobile} onBack={onBack} onGroups={roster.reloadGroups} />;
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-2xl space-y-4 px-3 py-4 sm:px-6">
        <p className="text-sm text-pretty text-muted-foreground">
          Một nhóm là vài bot cùng một cuộc trò chuyện: anh nhắn một lần, gọi bot bằng @, các bot trả lời nhau trong nhóm.
        </p>
        {roster.groups.length > 0 ? (
          <div className="rounded-xl border">
            <GroupsSection groups={roster.groups} all={roster.all} selected={null} onOpen={onOpen} onNew={onNew} />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl border px-4 py-5">
            <p className="font-medium">Chưa có nhóm nào.</p>
            <Button type="button" onClick={onNew} disabled={roster.all.length === 0} className="max-md:h-11">
              <UsersIcon aria-hidden /> Tạo nhóm
            </Button>
            {roster.all.length === 0 && <p className="text-xs text-muted-foreground">Cần ít nhất một bot đang chạy.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
