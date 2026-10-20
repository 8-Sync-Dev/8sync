// Team roles: which model and kit agent a session of that role runs with.
// Shared by the UI (badges, assign dialog) and the server (spawn validation).
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type ModelId = (typeof MODELS)[number];
export type CostTier = "high" | "mid" | "low";

export const ROLE_IDS = ["rd", "plan", "architect", "fullstack", "ai", "tester", "reviewer", "quick"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** lucide-react icon names a role may use; components/hq/role-badge.tsx maps each one to its component. */
export type RoleIconName = "FlaskConical" | "ClipboardList" | "Blocks" | "Code" | "Sparkles" | "FlaskRound" | "ScanSearch" | "Zap";

export type Role = {
  id: RoleId;
  labelVi: string;
  icon: RoleIconName;
  model: ModelId;
  /** 8sync kit agent that does this work */
  agentHint: "researcher" | "pm" | "architect" | "task" | "qa" | "reviewer" | "quick-task";
  costTier: CostTier;
};

export const ROLES: readonly Role[] = [
  { id: "rd", labelVi: "R&D (nghiên cứu)", icon: "FlaskConical", model: "claude-opus-5-5", agentHint: "researcher", costTier: "high" },
  { id: "plan", labelVi: "Plan (lập kế hoạch)", icon: "ClipboardList", model: "claude-opus-5-5", agentHint: "pm", costTier: "high" },
  { id: "architect", labelVi: "Architect", icon: "Blocks", model: "claude-opus-5-5", agentHint: "architect", costTier: "high" },
  { id: "fullstack", labelVi: "Fullstack", icon: "Code", model: "claude-sonnet-5-5", agentHint: "task", costTier: "mid" },
  { id: "ai", labelVi: "AI", icon: "Sparkles", model: "claude-sonnet-5-5", agentHint: "task", costTier: "mid" },
  { id: "tester", labelVi: "Tester", icon: "FlaskRound", model: "claude-haiku-5-5", agentHint: "qa", costTier: "low" },
  { id: "reviewer", labelVi: "Reviewer", icon: "ScanSearch", model: "claude-sonnet-5-5", agentHint: "reviewer", costTier: "mid" },
  { id: "quick", labelVi: "Quick", icon: "Zap", model: "claude-haiku-5-5", agentHint: "quick-task", costTier: "low" },
];

export function isRoleId(v: unknown): v is RoleId {
  return typeof v === "string" && (ROLE_IDS as readonly string[]).includes(v);
}

export function isModelId(v: unknown): v is ModelId {
  return typeof v === "string" && (MODELS as readonly string[]).includes(v);
}

export function roleOf(id: unknown): Role | undefined {
  return ROLES.find((r) => r.id === id);
}

/** "claude-opus-5-5" -> "Opus 5.5" */
export function modelShort(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}
