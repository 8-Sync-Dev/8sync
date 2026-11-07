"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChiefConfig, ChiefView } from "@/lib/server/chief";
import { cn } from "@/lib/utils";
import { ErrorNote } from "./bits";
import { Switch } from "./machine-view";
import type { Hq } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 30_000;
/** Phones: every control is at least 44 px tall. */
const TOUCH = "max-sm:h-11 max-sm:min-w-11";
const STATUS: Record<string, string> = { running: "đang làm", idle: "rảnh", needs_input: "chờ anh", ended: "đã đóng" };

const roomText = (r: ChiefView["rooms"][number]) => `${r.label}${r.project && r.project.toLowerCase() !== r.label.toLowerCase() ? ` · ${r.project}` : ""}`;

/**
 * "Chief of Staff" (tab Máy): the one room the owner talks to. HQ hands it the owner's words with the
 * live rooms and the rule to route work, follow up and come back only for a decision (POST /api/chief/ask).
 */
export function ChiefPanel({ api, active }: { api: Hq["api"]; active: boolean }) {
  const p = usePoll<ChiefView>(api, "/api/chief", POLL_MS, active);
  const [saving, setSaving] = useState(false);
  const v = p.data;
  const cfg = v?.cfg;
  const roomGone = !!cfg?.room && !v?.live;
  const chief = v?.rooms.find((r) => r.id === cfg?.room);

  async function save(patch: Partial<ChiefConfig>) {
    setSaving(true);
    try {
      await api("/api/chief", { method: "PUT", body: patch });
      p.reload();
    } catch (e) {
      toast.error("Chưa lưu được", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="may-chief" className="space-y-2.5 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="may-chief" className="text-sm font-semibold">
          Chief of Staff
        </h2>
        {cfg && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{cfg.on && !roomGone ? "Đang bật" : "Đang tắt"}</span>
            <Switch on={cfg.on} busy={saving} disabled={!cfg.room || (roomGone && !cfg.on)} label="Bật Chief of Staff" onChange={(on) => void save({ on })} />
          </div>
        )}
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        Một phòng làm trưởng nhóm: anh chỉ cần nhắn phòng này. HQ gửi kèm danh sách các phòng đang mở; Chief chia việc cho đúng phòng, theo dõi, kiểm kết quả và chỉ quay lại khi cần anh quyết.
      </p>
      {p.error && !v && <ErrorNote what="Chief of Staff" error={p.error} onRetry={p.reload} />}
      {!v && !p.error && <Skeleton className="h-16 rounded-md" />}
      {cfg && v && (
        <div className="space-y-2">
          <label className="block max-w-md space-y-1 text-xs">
            <span className="text-muted-foreground">Phòng Chief</span>
            <Select value={cfg.room ?? ""} onValueChange={(room) => void save({ room })} disabled={saving}>
              <SelectTrigger className={cn("w-full", TOUCH)} aria-label="Phòng Chief of Staff">
                <SelectValue placeholder={v.rooms.length ? "Chọn phòng" : "Chưa có phòng nào đang mở"} />
              </SelectTrigger>
              <SelectContent>
                {roomGone && cfg.room && (
                  <SelectItem value={cfg.room} disabled>
                    Phòng đã chọn không còn mở
                  </SelectItem>
                )}
                {v.rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {roomText(r)}
                    <span className="text-muted-foreground">· {STATUS[r.status] ?? r.status}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <p className="text-xs leading-snug text-muted-foreground">
            {roomGone
              ? "Phòng Chief đã đóng: chọn phòng khác."
              : !cfg.room
                ? "Chọn một phòng để bật."
                : cfg.on
                  ? `Tin anh gửi cho ${chief ? roomText(chief) : "Chief"} kèm danh sách ${Math.max(0, v.rooms.length - 1)} phòng còn lại.`
                  : "Đã chọn phòng, bật công tắc để dùng."}
          </p>
        </div>
      )}
    </section>
  );
}
