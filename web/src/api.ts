// Typed fetch wrappers for the 8sync harness web API. No `any` — every response
// is typed so the UI consumes a known shape.
//
// The backend serves an embedded SPA, so an unmatched /api/* path returns the
// index.html fallback with HTTP 200 (not a 404). We detect that (non-JSON body
// or json content-type missing) and throw a clean, human error so pages can
// render an honest "endpoint not ready yet" state instead of a JSON parse crash
// or raw HTML.

export type EngineStatus = { present: boolean; version: string; registered?: boolean; runner?: boolean };
export type Engines = {
  trail: EngineStatus;
  headroom: EngineStatus;
  mnemopi_on: boolean;
};
export type SkillEntry = {
  name: string;
  tier: "always" | "on-demand" | "off";
  source: string;
  global: boolean;
  local: boolean;
};
export type BenchReport = {
  upfront: number;
  deferred: number;
  a1_pass: boolean;
  a2_saved_pct: number;
  force_load_prefix: number;
  core_tok: number;
  spine_tok: number;
  naive_tok: number;
  spine_advice: string | null;
};
export type RoleScore = { role: string; pct: number; detail: string[] };
export type EvalReport = { overall: number; total: number; present: number; roles: RoleScore[] };
export type StateInfo = { project: string; profile: string; state_md: string };
export type WorkspaceInfo = { profiles: string[]; project: string; session: string };
export type TeamInfo = {
  roster: { type: string; role: string; skills: string }[];
  readiness: EvalReport | null;
};
export type Submodule = { name: string; path: string; url: string; initialized: boolean };

// Normalized context — the new backend field names. normalizeContext() maps the
// legacy shape onto this so the page never branches on which backend shipped.
export type CtxInfo = {
  usedTok: number;
  windowTok: number;
  pct: number;
  thresholdPct: number;
  willCompact: boolean;
  assumed: boolean; // true when the window is an assumption, not measured
  model: string;
  project: string;
  session: string;
  lastCompactAt: number | null;
  compactionObserved: boolean;
  stale?: boolean; // session idle/ended — snapshot, not a live run
  sessionAgeSecs?: number;
  note?: string;
};

export type McpServer = { name: string; command: string; args: string[]; type: string; present: boolean };
export type Rule = { scope: string; name: string; path: string; bytes: number };
export type MarketInstall = {
  type: "stdio" | "http" | "sse" | "skill" | "link";
  command?: string;
  args?: string[];
  url?: string;
  spec?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
};
export type MarketItem = {
  id: string;
  name: string;
  description: string;
  kind: "mcp" | "skill";
  source: string;
  stars: number;
  updated: string;
  url: string;
  new: boolean;
  install: MarketInstall;
};
export type MarketResponse = { kind: string; count: number; items: MarketItem[] };

// Curated knowledge — sindresorhus/awesome catalog + apply-to-project result.
export type KnowledgeEntry = { name: string; url: string; desc: string };
export type KnowledgeCategory = { name: string; count: number; entries: KnowledgeEntry[] };
export type KnowledgeCatalog = { source: string; categories: KnowledgeCategory[]; category_count: number; total: number };
export type KnowledgeApplyResult = { ok: boolean; added: number; path: string };
export type ProjectCreateResult = { ok: boolean; path: string; skills: { spec: string; ok: boolean }[]; mcp_added: number; knowledge_added: number };
export type WfKind = "step" | "subagent" | "tool";
export type WfData = { label: string; kind: WfKind; ref: string };
export type WfNode = { id: string; type?: string; position: { x: number; y: number }; data: WfData };
export type WfEdge = { id: string; source: string; target: string };
export type Workflow = { name?: string; nodes: WfNode[]; edges: WfEdge[] };
export type WorkflowExport = { ok: boolean; path: string; tool: string };

// Live `/auto` engine run — the real gsd-pi state.json the engine drives.
export type EngineTaskView = { id?: string; title: string; status: "pending" | "in_progress" | "done" | "blocked"; retries?: number };
export type EngineSliceView = { id?: string; title: string; tasks: EngineTaskView[] };
export type EngineRun = {
  active: boolean;
  goal?: string;
  updatedAt?: string;
  total?: number;
  done?: number;
  blocked?: number;
  current?: { slice: string; task: string; status: string } | null;
  slices?: EngineSliceView[];
};

// Project switcher. `current` = the project the dashboard is viewing; `active` =
// current OR used within 2h (green dot).
export type ProjectEntry = {
  name: string;
  path: string;
  current?: boolean;
  active: boolean;
  lastModified?: number | null;
};

// Model routing config. roles = named slots; tasks = {class: model} keyed by
// class. Philosophy: thinking (plan/review/debug) → Opus; mechanical
// (code/edit/default/trivial) → GLM.
export type ModelRole = "default" | "plan" | "smol" | "slow" | "vision";
export type ModelTask = "plan" | "review" | "debug" | "code" | "trivial";
export type ModelConfig = {
  path: string;
  roles: Partial<Record<ModelRole, string>>;
  tasks: Partial<Record<string, string>>;
  classes?: string[];
};

// Error thrown when a backend endpoint is not implemented yet (SPA fallback).
export class EndpointMissingError extends Error {
  endpoint: string;
  constructor(endpoint: string) {
    super(
      `Backend is still building ${endpoint}. This screen will light up once the ` +
        `route ships — no action needed here.`,
    );
    this.endpoint = endpoint;
    this.name = "EndpointMissingError";
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  // SPA fallback: backend returns 200 + index.html for unknown /api paths. A
  // missing endpoint therefore looks like a successful HTML response.
  const ct = r.headers.get("content-type") ?? "";
  const looksLikeHtml = ct.includes("text/html") || !ct.includes("json");
  if (r.ok && looksLikeHtml) {
    const text = await r.text();
    if (text.trimStart().startsWith("<")) throw new EndpointMissingError(url);
    return JSON.parse(text) as T;
  }
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => r.statusText)}`);
  return (await r.json()) as T;
}

const POST_JSON = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/// Map any context response shape (legacy or new) onto the normalized CtxInfo.
/// `assumed` defaults to true when absent — the window is an assumption until a
/// backend reports a measured one, and the page must not imply false precision.
export function normalizeContext(raw: Record<string, unknown>): CtxInfo {
  const num = (v: unknown, d = 0): number =>
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) || d : d;
  const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
  const usedTok = num(raw.usedTok ?? raw.used);
  const windowTok = num(raw.windowTok ?? raw.window, 1_000_000);
  const thresholdPct = num(raw.thresholdPct ?? raw.threshold_pct, 50);
  const willCompact =
    raw.willCompact != null ? Boolean(raw.willCompact) : Boolean(raw.over_threshold);
  const assumed = raw.assumed != null ? Boolean(raw.assumed) : true;
  return {
    usedTok,
    windowTok,
    pct: num(raw.pct, windowTok > 0 ? (usedTok * 100) / windowTok : 0),
    thresholdPct,
    willCompact,
    assumed,
    model: str(raw.model),
    project: str(raw.project),
    session: str(raw.session),
    lastCompactAt:
      raw.lastCompactAt != null
        ? num(raw.lastCompactAt)
        : raw.last_compact_at != null
          ? num(raw.last_compact_at)
          : null,
    compactionObserved: Boolean(raw.compaction_observed ?? raw.compactionObserved),
    stale: raw.stale != null ? Boolean(raw.stale) : undefined,
    sessionAgeSecs: raw.sessionAgeSecs != null ? num(raw.sessionAgeSecs) : undefined,
    note: str(raw.note) || undefined,
  };
}

export const api = {
  state: () => json<StateInfo>("/api/state"),
  skills: () => json<SkillEntry[]>("/api/skills"),
  toggleSkill: (name: string, when: SkillEntry["tier"]) =>
    json<{ name: string; tier: SkillEntry["tier"] }>("/api/skills/toggle", POST_JSON({ name, when })),
  skillAdd: (spec: string) => json<{ ok: boolean; log: string }>("/api/skills/add", POST_JSON({ spec })),
  skillUpdate: (name?: string) => json<{ ok: boolean; log: string }>("/api/skills/update", POST_JSON({ name })),
  memory: (file: string) => json<{ file: string; content: string }>(`/api/memory/${file}`),
  saveMemory: (file: string, content: string) =>
    json<{ ok: boolean }>("/api/memory/" + file, POST_JSON({ content })),
  engines: () => json<Engines>("/api/engines"),
  engine: () => json<EngineRun>("/api/engine"),
  bench: () => json<BenchReport>("/api/bench"),
  evalProject: () => json<EvalReport>("/api/eval"),
  workspaces: () => json<WorkspaceInfo>("/api/workspaces"),
  activateWorkspace: (profile?: string, project?: string) =>
    json<unknown>("/api/workspaces/activate", POST_JSON({ profile, project })),
  team: () => json<TeamInfo>("/api/team"),
  submodules: () => json<Submodule[]>("/api/submodules"),
  submoduleAdd: (url: string, path?: string) =>
    json<{ ok: boolean; path: string }>("/api/submodules/add", POST_JSON({ url, path })),
  submodulePull: (path: string) => json<{ ok: boolean }>("/api/submodules/pull", POST_JSON({ path })),
  submoduleRemove: (path: string) =>
    json<{ ok: boolean }>("/api/submodules/remove", POST_JSON({ path })),
  context: () => json<Record<string, unknown>>("/api/context").then(normalizeContext),
  mcp: () => json<{ servers: McpServer[] }>("/api/mcp"),
  rules: () => json<Rule[]>("/api/rules"),
  ruleAdd: (name: string, content: string, scope?: string) =>
    json<{ ok: boolean; path: string }>("/api/rules/add", POST_JSON({ name, content, scope })),
  ruleDelete: (path: string) => json<{ ok: boolean }>("/api/rules/delete", POST_JSON({ path })),
  workflows: () => json<string[]>("/api/workflows"),
  workflowGet: (name: string) => json<Workflow>(`/api/workflows/${encodeURIComponent(name)}`),
  workflowSave: (name: string, nodes: WfNode[], edges: WfEdge[]) =>
    json<{ ok: boolean; path: string }>(`/api/workflows/${encodeURIComponent(name)}`, POST_JSON({ nodes, edges })),
  workflowDelete: (name: string) =>
    json<{ ok: boolean }>(`/api/workflows/${encodeURIComponent(name)}`, { method: "DELETE" }),
  workflowExport: (name: string) =>
    json<WorkflowExport>(`/api/workflows/${encodeURIComponent(name)}/export`, { method: "POST" }),

  // ── New endpoints (backend ships these in parallel; FE degrades cleanly) ──
  projects: () => json<ProjectEntry[]>("/api/projects"),
  activateProject: (path: string) =>
    json<unknown>("/api/workspaces/activate", POST_JSON({ project: path })),
  models: () => json<ModelConfig>("/api/models"),
  modelSet: (section: "roles" | "tasks", key: string, value: string) =>
    json<ModelConfig>("/api/models", POST_JSON({ section, key, value })),
  // Templates arrive wrapped: [{ name, graph: { name, nodes, edges } }]. Unwrap.
  workflowTemplates: () =>
    json<{ name: string; graph: Workflow }[]>("/api/workflows/templates").then((ts) =>
      ts.map((t) => ({ ...t.graph, name: t.name })),
    ),

  // ── Marketplace (discover + install skills / MCP from external registries) ──
  marketplace: (kind: "mcp" | "skill", search = "", sort: "top" | "new" = "top") =>
    json<MarketResponse>(
      `/api/marketplace?kind=${kind}&sort=${sort}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  mcpAdd: (body: { name: string; command?: string; args?: string[]; type?: string; url?: string; spec?: string; env?: Record<string, string>; headers?: Record<string, string> }) =>
    json<{ ok: boolean; name: string; note: string }>("/api/mcp/add", POST_JSON(body)),
  mcpRemove: (name: string) => json<{ ok: boolean; removed: boolean }>("/api/mcp/remove", POST_JSON({ name })),
  ruleImport: (source: string, scope?: string) =>
    json<{ ok: boolean; imported: number; files: string[] }>("/api/rules/import", POST_JSON({ source, scope })),

  // ── Curated knowledge (sindresorhus/awesome) ──
  knowledge: (search = "", refresh = false) =>
    json<KnowledgeCatalog>(
      `/api/knowledge?${refresh ? "refresh=1&" : ""}${search ? `search=${encodeURIComponent(search)}` : ""}`,
    ),
  knowledgeApply: (items: (KnowledgeEntry & { category: string })[], project?: string) =>
    json<KnowledgeApplyResult>("/api/knowledge/apply", POST_JSON({ items, project })),

  // ── Create project (scaffold + skills + mcp + knowledge) ──
  projectCreate: (body: {
    name?: string;
    path?: string;
    skills?: string[];
    mcp?: { name: string; spec: string }[];
    knowledge?: (KnowledgeEntry & { category: string })[];
  }) =>
    json<ProjectCreateResult>("/api/projects/create", POST_JSON(body)),
};
