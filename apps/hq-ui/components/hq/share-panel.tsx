"use client";

import { Link2Icon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ACCESS_LABEL, GUEST_ROLES, type GuestRole } from "@/lib/access";
import type { InviteView } from "@/lib/server/invites";
import { cn } from "@/lib/utils";
import { AccessBadge } from "./access";
import { ErrorNote } from "./bits";
import { CopyButton } from "./copy-button";
import type { Api } from "./use-hq";
import { usePoll } from "./use-poll";

const POLL_MS = 30_000;
const DAYS = [1, 7, 30] as const;
/** Phones: every control is at least 44 px tall. */
const TOUCH = "max-sm:h-11 max-sm:min-w-11";
const ROLE_HINT: Record<GuestRole, string> = {
  viewer: "xem, tải media, chép caption",
  editor: "như Chỉ xem, thêm sửa trạng thái, caption, lịch đăng",
};

const when = (ms: number) => new Date(ms).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function stateText(x: InviteView): string {
  if (x.state === "revoked") return `đã thu hồi ${when(x.revoked!)}`;
  if (x.state === "expired") return `hết hạn ${when(x.expires)}`;
  return `dùng được đến ${when(x.expires)}`;
}

/**
 * Máy → "Chia sẻ" (owner only): a link that opens the Nội dung tab to someone outside, read only or
 * able to edit items, for 1, 7 or 30 days. HQ sends no mail: the owner copies the link (shown once,
 * HQ keeps only its hash) and sends it. Revoke shuts it at the guest's next request.
 */
export function SharePanel({ api, active }: { api: Api; active: boolean }) {
  const list = usePoll<{ invites: InviteView[]; public: boolean }>(api, "/api/invites", POLL_MS, active);
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<GuestRole>("viewer");
  const [days, setDays] = useState<(typeof DAYS)[number]>(7);
  const [github, setGithub] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ label: string; link: string; public: boolean } | null>(null);

  async function create() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ invite: InviteView; link: string; public: boolean }>("/api/invites", { method: "POST", body: { label, role, days, github: github.trim() || undefined } });
      setMade({ label: r.invite.label, link: r.link, public: r.public });
      setLabel("");
      setGithub("");
      list.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(x: InviteView) {
    if (!window.confirm(`Thu hồi link của «${x.label}»? Người đó mất quyền ngay ở lần bấm kế tiếp.`)) return;
    try {
      await api(`/api/invites?id=${x.id}`, { method: "DELETE" });
      toast.success(`Đã thu hồi link của ${x.label}`);
      list.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Mở riêng tab Nội dung cho người ngoài. HQ không gửi mail: tạo link, chép rồi gửi cho họ. Link chỉ hiện một lần.</p>
      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_7rem] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="grid gap-1 text-xs">
          Cho ai
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="email hoặc tên" maxLength={120} required className={TOUCH} />
        </label>
        <label className="grid gap-1 text-xs">
          Quyền
          <Select value={role} onValueChange={(v) => setRole(v as GuestRole)}>
            <SelectTrigger size="sm" className={cn("w-full text-xs", TOUCH)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GUEST_ROLES.map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {ACCESS_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs">
          Hết hạn sau
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as (typeof DAYS)[number])}>
            <SelectTrigger size="sm" className={cn("w-full text-xs", TOUCH)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d) => (
                <SelectItem key={d} value={String(d)} className="text-xs">
                  {d} ngày
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs sm:col-span-2">
          Chỉ tài khoản GitHub (tuỳ chọn)
          <Input value={github} onChange={(e) => setGithub(e.target.value)} placeholder="tên đăng nhập GitHub: họ phải đăng nhập GitHub mới vào được" autoComplete="off" spellCheck={false} className={TOUCH} />
        </label>
        <Button type="submit" size="sm" className={cn("text-xs", TOUCH)} disabled={busy || !label.trim()}>
          {busy ? <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Link2Icon aria-hidden />} Tạo link
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        {ACCESS_LABEL[role]}: {ROLE_HINT[role]}. Không thấy terminal, chat, nhật ký hay cài đặt.
      </p>

      {made && (
        <div role="status" className="space-y-1.5 rounded-md bg-muted px-3 py-2.5">
          <p className="text-xs font-medium">Link cho {made.label}: chép ngay, đóng trang là không xem lại được.</p>
          <div className="flex min-w-0 items-center gap-1">
            <code className="min-w-0 flex-1 truncate font-mono text-xs" title={made.link}>
              {made.link}
            </code>
            <CopyButton value={made.link} label={`Chép link cho ${made.label}`} className={TOUCH} />
          </div>
          {!made.public && <p className="text-xs text-muted-foreground">HQ chưa mở link công khai (8sync hq ui --public): link này chỉ mở được trên máy này.</p>}
        </div>
      )}

      {list.error && !list.data ? (
        <ErrorNote what="danh sách chia sẻ" error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : list.data.invites.length === 0 ? (
        <p className="text-xs text-muted-foreground">Chưa chia sẻ cho ai.</p>
      ) : (
        <ul className="divide-y border-t" aria-label="Các link đã chia sẻ">
          {list.data.invites.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
              <span className="min-w-0 truncate text-sm font-medium" title={x.label}>
                {x.label}
              </span>
              <AccessBadge role={x.role} />
              {x.github && <span className="font-mono text-xs text-muted-foreground">@{x.github}</span>}
              <span className={cn("text-xs", x.state === "active" ? "text-muted-foreground" : "text-destructive")}>{stateText(x)}</span>
              {x.state === "active" && (
                <Button type="button" size="sm" variant="ghost" className={cn("ml-auto h-7 text-xs text-destructive hover:text-destructive", TOUCH)} onClick={() => void revoke(x)}>
                  Thu hồi
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
