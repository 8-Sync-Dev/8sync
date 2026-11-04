"use client";

import { EyeIcon, PencilIcon } from "lucide-react";
import { createContext, useContext } from "react";
import { ACCESS_LABEL, type AccessRole, type GuestRole } from "@/lib/access";
import { cn } from "@/lib/utils";

/** Who is looking at the views: the owner (HqApp) or a guest of a "Chia sẻ" link (GuestApp). The server enforces it; this only hides what would answer 403. */
export const AccessContext = createContext<AccessRole>("owner");
export const useAccess = () => useContext(AccessContext);

/** "Chỉ xem" / "Sửa nội dung": the guest's role, always in sight. */
export function AccessBadge({ role, className }: { role: GuestRole; className?: string }) {
  const Icon = role === "viewer" ? EyeIcon : PencilIcon;
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium", role === "viewer" ? "bg-muted text-foreground" : "border-primary/40 bg-primary/10 text-foreground", className)}>
      <Icon aria-hidden className="size-3" />
      {ACCESS_LABEL[role]}
    </span>
  );
}
