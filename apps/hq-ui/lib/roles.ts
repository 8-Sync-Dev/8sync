// Team roles: which model and kit agent a session of that role runs with.
// Shared by the UI (badges, assign dialog) and the server (spawn validation).
import { isOmpTeamRoom } from "./team-room";

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

/**
 * The omp team's model (`omp_model` of `8sync ccc auto status --json`, `<provider>/<model>[:level]`)
 * as a card label: "zai/glm-5.3" -> "GLM-5.3", "openai/gpt-5.6-sol" -> "GPT-5.6-sol", a Claude id ->
 * modelShort, anything else -> the model id after the slash. null/empty = omp's own default model.
 */
export function ompModelLabel(id: string | null | undefined): string {
  const raw = id?.trim();
  if (!raw) return "omp mặc định";
  const model = raw.slice(raw.lastIndexOf("/") + 1).split(":")[0] || raw;
  const fam = /^(glm|gpt)-(.+)$/i.exec(model);
  return fam ? `${fam[1].toUpperCase()}-${fam[2]}` : modelShort(model);
}

/**
 * The model label a room card shows: an omp team room (`omp-<role>`) always names its team's model
 * (ompModelLabel; null = omp's default), the owner's own omp session its model when known, a Claude
 * Code room its own (modelShort) or nothing when unknown.
 */
export function roomModelLabel(room: { model?: string | null; engine?: string | null; label: string }): string | null {
  if (room.engine === "omp" && isOmpTeamRoom(room.label)) return ompModelLabel(room.model);
  if (!room.model) return null;
  return room.engine === "omp" ? ompModelLabel(room.model) : modelShort(room.model);
}
