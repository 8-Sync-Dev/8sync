import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { modelShort, roleOf, ROLES } from "@/lib/roles";

// Resolved once at module load: the icon components must not be picked during render.
const ICON_BY_ROLE: Record<string, LucideIcon> = Object.fromEntries(
  ROLES.map((r) => [r.id, (Icons as unknown as Record<string, LucideIcon>)[r.icon] ?? Icons.CircleIcon]),
);

/** The lucide icon of a role (CircleIcon for an unknown one). */
export function RoleIcon({ role, className }: { role: string | null | undefined; className?: string }) {
  const Icon = ICON_BY_ROLE[role ?? ""] ?? Icons.CircleIcon;
  return <Icon aria-hidden className={cn("size-3 shrink-0", className)} />;
}

/** Icon + VN label + model short name. Never colour alone. */
export function RoleBadge({ role, model, className }: { role: string | null | undefined; model?: string | null; className?: string }) {
  const r = roleOf(role);
  if (!r) return null;
  const m = model ?? r.model;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs", className)}
      title={`${r.labelVi} · ${modelShort(m)}`}
    >
      <RoleIcon role={r.id} />
      <span>{r.labelVi}</span>
      <span className="text-muted-foreground">· {modelShort(m)}</span>
    </span>
  );
}
