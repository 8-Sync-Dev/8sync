import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { modelShort, roleOf } from "@/lib/roles";

/** Icon + VN label + model short name. Never colour alone. */
export function RoleBadge({ role, model, className }: { role: string | null | undefined; model?: string | null; className?: string }) {
  const r = roleOf(role);
  if (!r) return null;
  const Icon = (Icons as unknown as Record<string, LucideIcon>)[r.icon] ?? Icons.CircleIcon;
  const m = model ?? r.model;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs", className)}
      title={`${r.labelVi} · ${modelShort(m)}`}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span>{r.labelVi}</span>
      <span className="text-muted-foreground">· {modelShort(m)}</span>
    </span>
  );
}
