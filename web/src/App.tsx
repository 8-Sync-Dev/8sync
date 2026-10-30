import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  EndpointMissingError,
  type SkillEntry,
  type Engines,
  type ModelConfig,
  type ModelRole,
  type WfData,
  type WfKind,
  type WfNode,
  type WfEdge,
  type MarketItem,
} from "./api";
import { Markdown } from "./markdown";
import { NavIcon, LogoMark, Glyph } from "./icons";
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, Handle, Position,
  useNodesState, useEdgesState,
  type Node, type Edge, type Connection, type NodeTypes, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layered } from "./layout";

type Page =
  | "state" | "context" | "models" | "skills" | "memory" | "rules"
  | "engines" | "mcp" | "submodules"
  | "bench" | "eval" | "team" | "workspaces" | "workflow" | "marketplace" | "knowledge";

const NAV_GROUPS: { label: string; items: { id: Page; label: string }[] }[] = [
  { label: "Session", items: [{ id: "state", label: "State" }, { id: "context", label: "Context" }] },
  { label: "Configure", items: [{ id: "models", label: "Models" }, { id: "skills", label: "Skills" }, { id: "memory", label: "Memory" }, { id: "rules", label: "Rules" }] },
  { label: "Runtime", items: [{ id: "engines", label: "Engines" }, { id: "mcp", label: "MCP" }, { id: "submodules", label: "Submodules" }] },
  { label: "Discover", items: [{ id: "marketplace", label: "Marketplace" }, { id: "knowledge", label: "Knowledge" }] },
  { label: "Quality", items: [{ id: "bench", label: "Bench" }, { id: "eval", label: "Readiness" }, { id: "team", label: "Team" }] },
  { label: "Projects", items: [{ id: "workspaces", label: "Workspaces" }] },
  { label: "Build", items: [{ id: "workflow", label: "Workflow" }] },
];

const MEMORY_FILES = ["STATE", "KNOWLEDGE", "PLAYBOOKS", "DECISIONS", "PROJECT", "NOTES"] as const;

// Known model shorthands surfaced as quick-pick options in the Models page.
const MODEL_HINTS = ["opus", "glm", "haiku", "codex"] as const;

const ROLE_HINTS: Record<string, string> = {
  default: "fallback", plan: "planning", smol: "cheap calls", slow: "deep", vision: "images",
};
const TASK_HINTS: Record<string, string> = {
  plan: "thinking", review: "thinking", debug: "thinking", code: "mechanical", trivial: "mechanical",
};

// Deep-linkable routing: `?page=engines` (or `/engines`) selects the initial
// page so `8sync shot http://127.0.0.1:8731/?page=engines` captures that view
// (nav is in-memory, so without this a headless load always renders State).
const ALL_PAGES: Page[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
function pageFromUrl(): Page {
  const q = new URLSearchParams(window.location.search).get("page");
  const cand = q ?? window.location.pathname.replace(/^\/+/, "");
  return (ALL_PAGES as string[]).includes(cand) ? (cand as Page) : "state";
}
export default function App() {
  const [page, setPageState] = useState<Page>(pageFromUrl);
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    window.history.replaceState(null, "", p === "state" ? "." : `?page=${p}`);
  }, []);
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand">
          <span className="brand-mark"><LogoMark /></span>
          <span className="brand-text">
            <span className="brand-name">8sync</span>
            <span className="brand-sub">harness</span>
          </span>
        </div>
        <ProjectSwitcher />
        <div className="nav-scroll">
          {NAV_GROUPS.map((g) => (
            <div className="nav-section" key={g.label}>
              <div className="nav-section-label">{g.label}</div>
              {g.items.map((n) => (
                <button
                  key={n.id}
                  className="nav-item"
                  onClick={() => setPage(n.id)}
                  aria-current={page === n.id ? "page" : undefined}
                >
                  <span className="nav-ico"><NavIcon name={n.id} /></span>
                  <span className="nav-label">{n.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="side-foot">
          <span className="live-dot" aria-hidden="true" />
          agent-team dashboard
        </div>
      </nav>
      <main className="main">
        <div className="main-inner">
          {page === "state" && <StatePage />}
          {page === "context" && <ContextPage />}
          {page === "models" && <ModelsPage />}
          {page === "skills" && <SkillsPage />}
          {page === "memory" && <MemoryPage />}
          {page === "rules" && <RulesPage />}
          {page === "engines" && <EnginesPage />}
          {page === "mcp" && <McpPage />}
          {page === "submodules" && <SubmodulesPage />}
          {page === "bench" && <BenchPage />}
          {page === "eval" && <EvalPage />}
          {page === "team" && <TeamPage />}
          {page === "workspaces" && <WorkspacesPage />}
          {page === "workflow" && <WorkflowPage />}
          {page === "marketplace" && <MarketplacePage />}
          {page === "knowledge" && <KnowledgePage />}
        </div>
      </main>
    </div>
  );
}

// ── Project switcher (sidebar-top, persistent) ────────────────────────────
// Lists every omp project with a status dot (green = active, dim = off).
// Selecting one POSTs activate + invalidates every query so pages refetch in
// the new project's context. The menu uses position: fixed to escape the
// sidebar's overflow:auto clipping.
function ProjectSwitcher() {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const ws = useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces, staleTime: 8000 });
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const trigRef = useRef<HTMLButtonElement>(null);

  const activate = useMutation({
    mutationFn: (path: string) => api.activateProject(path),
    onSuccess: () => qc.invalidateQueries(),
  });

  useLayoutEffect(() => {
    if (!open || !trigRef.current) return;
    const r = trigRef.current.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".proj-menu") && !t.closest(".proj-trigger")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = projects.data ?? [];
  // Prefer the project matching the current cwd (what State/Context show), else
  // the backend's first "active". Keeps the trigger label consistent with the
  // page content even when several projects report active.
  const currentPath = ws.data?.project;
  const current = list.find((p) => p.current) ?? (currentPath ? list.find((p) => p.path === currentPath) : null) ?? list.find((p) => p.active) ?? null;
  const currentName = current?.name ?? (currentPath ? currentPath.split("/").pop() : null) ?? "no project";
  const missing = projects.error instanceof EndpointMissingError;

  return (
    <div className="proj-switch">
      <button
        ref={trigRef}
        className="proj-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={current?.path ?? currentPath ?? "Select project"}
      >
        <span className="proj-ic"><Glyph name="folder" /></span>
        <span className="proj-name">{currentName}</span>
        <span className="proj-chev"><Glyph name="chevron" /></span>
      </button>
      {open && coords && (
        <div className="proj-menu" role="listbox" style={coords}>
          <div className="proj-menu-head">omp projects</div>
          <div className="proj-menu-list">
            {missing ? (
              <div style={{ padding: "4px 6px" }}><EndpointMissing endpoint="/api/projects" /></div>
            ) : projects.isLoading ? (
              <div style={{ padding: "12px 14px" }} className="muted">Loading…</div>
            ) : list.length === 0 ? (
              <div style={{ padding: "12px 14px" }} className="muted">No projects found.</div>
            ) : (
              list.map((p) => (
                <button
                  key={p.path}
                  className={`proj-item ${current && p.path === current.path ? "active" : ""}`}
                  onClick={() => { activate.mutate(p.path); setOpen(false); }}
                  disabled={activate.isPending}
                  title={p.path}
                >
                  <span className={`dot ${p.active ? "on" : "off"}`} />
                  <span className="proj-item-main">
                    <span className="proj-item-name">{p.name}</span>
                    <span className="proj-item-path">{p.path}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared scaffolding + interaction states ───────────────────────────────
function Page({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2>{title}</h2>
          {sub ? <p className="sub">{sub}</p> : null}
        </div>
        {action ? <div className="page-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card" aria-busy="true" aria-live="polite">
      <div className="skeleton">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="skeleton-row" key={i}>
            <span className="skel" style={{ width: `${68 - i * 9}%` }} />
            <span className="skel skel-tag" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Type guard — keeps EndpointMissingError narrowing live at call sites.
function isMissing(e: unknown): boolean {
  return e instanceof EndpointMissingError;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="card state-msg state-error" role="alert">
      <span className="state-ico" aria-hidden="true">!</span>
      <div>
        <strong>Couldn’t load this</strong>
        <p className="mono">{message}</p>
      </div>
    </div>
  );
}

// Honest "endpoint not ready" banner — used when the backend route isn't live.
function EndpointMissing({ endpoint }: { endpoint: string }) {
  return (
    <div className="card missing state-msg">
      <span className="state-ico" aria-hidden="true"><Glyph name="alert" /></span>
      <div>
        <strong>Waiting on the backend</strong>
        <p>{endpoint} isn’t live in the running server yet. The screen fills in automatically once it ships; nothing to do here.</p>
      </div>
    </div>
  );
}

function EmptyState({ title, hint, icon }: { title: string; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card empty">
      <span className="empty-orb" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {hint ? <p className="muted">{hint}</p> : null}
    </div>
  );
}

// Compact k-formatting for token counts (the magic 1k boundary).
function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
}

// ── State (markdown rendered) ─────────────────────────────────────────────
function StatePage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["state"], queryFn: api.state });
  return (
    <Page
      title="State"
      sub={data ? <span>Project memory snapshot · <span className="mono">{data.project}</span> · profile {data.profile}</span> : "Live plan from agents/STATE.md, rewritten at each phase boundary."}
    >
      {isLoading ? <Loading rows={6} /> : error ? <ErrorState message={(error as Error).message} /> : !data ? <Loading /> : (
        <div className="card">
          {data.state_md ? <Markdown source={data.state_md} /> : (
            <EmptyState title="No STATE.md yet" hint="agents/STATE.md is empty. It fills in once the harness writes a plan." />
          )}
        </div>
      )}
    </Page>
  );
}

// ── Context (honest about assumed window + willCompact) ───────────────────
function ContextPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["context"],
    queryFn: api.context,
    refetchInterval: 4000,
  });
  if (isLoading) return <Page title="Context" sub="Live omp session token usage."><Loading rows={3} /></Page>;
  if (error) return <Page title="Context" sub="Live omp session token usage."><ErrorState message={(error as Error).message} /></Page>;
  if (!data) return <Page title="Context"><EmptyState title="No context data" /></Page>;
  const d = data;
  const pct = Math.min(d.pct, 100);
  const near = d.pct >= d.thresholdPct - 10;
  const over = d.willCompact;
  const stale = Boolean(d.stale);
  const barColor = over ? (stale ? "var(--warn)" : "var(--err)") : near ? "var(--warn)" : "var(--accent)";
  const headroom = Math.max(0, d.thresholdPct - d.pct);
  return (
    <Page
      title="Context"
      sub="Live omp session token usage. The window is the active model's real context window (or an estimate if the model isn't in omp's catalog)."
    >
      <div className="card">
        <div className="gauge-head">
          <span className="big">{fmt(d.usedTok)} / {fmt(d.windowTok)} tok</span>
          <span className="gauge-pct" style={{ color: barColor }}>{d.pct}%</span>
        </div>
        <div className="gauge" role="progressbar" aria-valuenow={Math.round(d.pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="gauge-fill" style={{ width: `${pct}%`, background: barColor }} />
          <div className="gauge-mark" title={`compact at ${d.thresholdPct}%`} style={{ left: `${d.thresholdPct}%` }} />
        </div>
        <p className="gauge-note">
          {d.assumed && <span className="tag warn" style={{ marginRight: 8 }}>assumed window</span>}
          {stale && <span className="tag info" style={{ marginRight: 8 }}>idle snapshot</span>}
          compact at <strong>{d.thresholdPct}%</strong> ({fmt((d.thresholdPct * d.windowTok) / 100)} tok) ·{" "}
          {over ? (
            <span className={stale ? "warn" : "err"}>over threshold — compacts on next turn</span>
          ) : (
            <span>{headroom}% headroom</span>
          )}
        </p>
        {d.compactionObserved && d.lastCompactAt != null && (
          <p className="gauge-observed">
            <span className="tag ok"><Glyph name="check" /> compaction observed</span>
            <span className="muted">last fired near {fmt(d.lastCompactAt)} tok</span>
          </p>
        )}
        {d.note && <p className="gauge-note faint">{d.note}</p>}
      </div>
      <div className="card">
        <div className="card-title">Session</div>
        <div className="kv"><span className="kv-k">model</span><span className="kv-v mono">{d.model || "—"}</span></div>
        <div className="kv"><span className="kv-k">project</span><span className="kv-v mono">{d.project || "—"}</span></div>
        <div className="kv"><span className="kv-k">session</span><span className="kv-v mono">{d.session || "—"}</span></div>
      </div>
    </Page>
  );
}

// ── Models (new) — inline-editable role/task routing ──────────────────────
function ModelsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["models"], queryFn: api.models });
  const setMut = useMutation({
    mutationFn: (v: { section: "roles" | "tasks"; key: string; value: string }) =>
      api.modelSet(v.section, v.key, v.value),
    onSuccess: (updated: ModelConfig) => qc.setQueryData(["models"], updated),
  });

  if (isLoading) return <Page title="Models" sub="Which model each task runs on."><Loading rows={5} /></Page>;
  if (error) {
    return (
      <Page title="Models" sub="Which model each task runs on.">
        {isMissing(error) ? <EndpointMissing endpoint="/api/models" /> : <ErrorState message={(error as Error).message} />}
      </Page>
    );
  }
  if (!data) return <Page title="Models"><EmptyState title="No model config" /></Page>;

  const roleOrder: ModelRole[] = ["default", "plan", "smol", "slow", "vision"];
  const roles = roleOrder.filter((r) => data.roles[r] !== undefined || r === "default");
  const classes = data.classes ?? ["plan", "review", "debug", "code", "trivial"];
  return (
    <Page
      title="Models"
      sub={<>Routing config at <code>{data.path || "~/.config/8sync/models.toml"}</code>. Thinking work goes to Opus; mechanical work to GLM.</>}
    >
      <div className="card">
        <div className="card-title">Routing philosophy</div>
        <div className="model-philosophy">
          <div className="model-track">
            <span className="model-track-label">thinking</span>
            <span className="model-track-models">
              <span className="tag accent">plan</span>
              <span className="tag accent">review</span>
              <span className="tag accent">debug</span>
              <span className="muted">→</span>
              <span className="tag accent">opus</span>
            </span>
          </div>
          <div className="model-track">
            <span className="model-track-label">mechanical</span>
            <span className="model-track-models">
              <span className="tag">code</span>
              <span className="tag">edit</span>
              <span className="tag">default</span>
              <span className="tag">trivial</span>
              <span className="muted">→</span>
              <span className="tag">glm</span>
            </span>
          </div>
        </div>
        <p className="hint faint">Quick picks: opus · glm · haiku · codex. Changes write to the config immediately.</p>
      </div>

      <div className="models-grid">
        <div className="card">
          <div className="card-title">Roles</div>
          <div className="model-table">
            {roles.map((r) => (
              <ModelRow
                key={r}
                name={r}
                hint={ROLE_HINTS[r]}
                value={data.roles[r] ?? ""}
                saving={setMut.isPending && setMut.variables?.section === "roles" && setMut.variables?.key === r}
                onChange={(v) => setMut.mutate({ section: "roles", key: r, value: v })}
              />
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Tasks by class</div>
          <div className="model-table">
            {classes.map((cls) => (
              <ModelRow
                key={cls}
                name={cls}
                hint={TASK_HINTS[cls] ?? "per-class"}
                value={data.tasks[cls] ?? ""}
                saving={setMut.isPending && setMut.variables?.section === "tasks" && setMut.variables?.key === cls}
                onChange={(v) => setMut.mutate({ section: "tasks", key: cls, value: v })}
              />
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}

function ModelRow({ name, hint, value, saving, onChange }: {
  name: string; hint?: string; value: string; saving: boolean; onChange: (v: string) => void;
}) {
  const opts = Array.from(new Set([...MODEL_HINTS, value].filter(Boolean) as string[]));
  return (
    <div className="model-row">
      <div className="model-key">
        <span className="model-key-name">{name}</span>
        {hint ? <span className="model-key-hint">{hint}</span> : null}
      </div>
      <div className="model-val">
        <select className="model-select" value={value} onChange={(e) => onChange(e.target.value)} disabled={saving}>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {saving && <span className="model-saving">saving…</span>}
      </div>
    </div>
  );
}

// ── Skills ─────────────────────────────────────────────────────────────────
function SkillsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["skills"], queryFn: api.skills });
  const toggle = useMutation({
    mutationFn: (v: { name: string; when: SkillEntry["tier"] }) => api.toggleSkill(v.name, v.when),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
  const cycle = (t: SkillEntry["tier"]): SkillEntry["tier"] =>
    t === "always" ? "on-demand" : t === "on-demand" ? "off" : "always";
  const [spec, setSpec] = useState("");
  const add = useMutation({
    mutationFn: (s: string) => api.skillAdd(s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["skills"] }); setSpec(""); },
  });
  const update = useMutation({
    mutationFn: () => api.skillUpdate(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<"all" | SkillEntry["tier"]>("all");
  const filtered = (data ?? []).filter((s) => {
    if (tier !== "all" && s.tier !== tier) return false;
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return s.name.toLowerCase().includes(needle) || (s.source ?? "").toLowerCase().includes(needle);
  });
  return (
    <Page
      title="Skills"
      sub="Click a tier chip to cycle always → on-demand → off."
      action={
        data && data.length > 0 ? (
          <div className="skills-toolbar">
            <input
              className="mono"
              placeholder={`Filter ${data.length} skills…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
              <option value="all">all tiers</option>
              <option value="always">always</option>
              <option value="on-demand">on-demand</option>
              <option value="off">off</option>
            </select>
          </div>
        ) : undefined
      }
    >
      <div className="card">
        <div className="toolbar">
          <input
            className="grow"
            placeholder="Import skill — github URL, gh:owner/repo, path:/abs/dir, or builtin:name"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && spec) add.mutate(spec); }}
            aria-label="skill spec"
          />
          <button className="primary" disabled={!spec || add.isPending} onClick={() => add.mutate(spec)}>
            {add.isPending ? "Adding…" : "Import"}
          </button>
          <button disabled={update.isPending} onClick={() => update.mutate()} title="git pull --ff-only every registered skill">
            {update.isPending ? "Updating…" : "Update all"}
          </button>
        </div>
        {add.isError ? <p className="hint hint-err">Import failed: {(add.error as Error).message}</p> : null}
        {add.isSuccess ? <p className="hint hint-ok">Imported. Toggle its tier below.</p> : null}
      </div>
      {isLoading ? <Loading rows={6} /> : error ? <ErrorState message={(error as Error).message} /> : !data ? <Loading /> : data.length === 0 ? (
        <EmptyState title="No skills registered" hint="Add a skill spec to make it loadable from the harness." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No skills match" hint={`Nothing matches "${q}" in ${tier === "all" ? "any tier" : tier}.`} />
      ) : (
        <div className="card list">
          <p className="muted list-count">{filtered.length} of {data.length} skills</p>
          {filtered.map((s) => (
            <div className="row" key={s.name}>
              <div className="row-main">
                <div className="row-title mono">{s.name}</div>
                <div className="row-meta mono">{s.source || "—"}{s.global ? " · global" : ""}{s.local ? " · project" : ""}</div>
              </div>
              <button
                className={`tag tag-btn ${s.tier === "always" ? "ok" : s.tier === "off" ? "muted" : "accent"}`}
                onClick={() => toggle.mutate({ name: s.name, when: cycle(s.tier) })}
                disabled={toggle.isPending}
                title="Cycle tier"
              >
                {s.tier}
              </button>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

// ── Memory (edit + markdown preview) ──────────────────────────────────────
function MemoryPage() {
  const [file, setFile] = useState<(typeof MEMORY_FILES)[number]>("STATE");
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["memory", file],
    queryFn: () => api.memory(file),
  });
  if (data && data.content !== draft && draft === "") setDraft(data.content);
  const save = useMutation({
    mutationFn: (content: string) => api.saveMemory(file, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory", file] }),
  });
  return (
    <Page
      title="Memory"
      sub="The project memory spine (agents/*.md). Writes are sandboxed — no path escape."
      action={
        <button className={preview ? "ghost" : ""} onClick={() => setPreview((p) => !p)}>
          {preview ? "Edit" : "Preview"}
        </button>
      }
    >
      <div className="card">
        <div className="toolbar">
          <label className="field">
            <span className="field-label">File</span>
            <select value={file} onChange={(e) => { setFile(e.target.value as typeof file); setDraft(""); }}>
              {MEMORY_FILES.map((f) => <option key={f} value={f}>{f}.md</option>)}
            </select>
          </label>
          {!preview && (
            <button className="primary" disabled={save.isPending || isLoading} onClick={() => save.mutate(draft)}>
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
        {preview ? (
          draft.trim() ? <div style={{ marginTop: 12 }}><Markdown source={draft} /></div> : <p className="muted" style={{ marginTop: 12 }}>Nothing to preview.</p>
        ) : (
          <textarea value={isLoading ? "Loading…" : draft} onChange={(e) => setDraft(e.target.value)} aria-label={`${file}.md`} spellCheck={false} />
        )}
        {save.isSuccess && <p className="hint hint-ok">Saved {file}.md.</p>}
        {save.isError && <p className="hint hint-err">Save failed: {(save.error as Error).message}</p>}
      </div>
    </Page>
  );
}

// ── Engines ──────────────────────
function EnginesPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["engines"], queryFn: api.engines });
  const engines: { key: keyof Omit<Engines, "mnemopi_on">; label: string; hint: string }[] = [
    { key: "trail", label: "trail", hint: "code map for agents (ask/grep/skeleton/callers)" },
    { key: "headroom", label: "headroom", hint: "token compression" },
  ];
  return (
    <Page title="Engines" sub="Token-opt + code-map stack. Absent engines fall back to slow grep/read.">
      <EngineRunBoard />
      {isLoading || !data ? <Loading rows={4} /> : error ? <ErrorState message={(error as Error).message} /> : (
        <div className="grid">
          {engines.map((e) => {
            const st = data[e.key];
            return (
              <div className="card tile" key={e.key}>
                <div className="tile-head">
                  <strong>{e.label}</strong>
                  <span className={`tag ${st.present ? "ok" : "warn"}`}>
                    {st.present ? (st.version ? `on ${st.version}` : "on") : "off"}
                  </span>
                </div>
                <p className="tile-hint">{e.hint}</p>
              </div>
            );
          })}
          <div className="card tile">
            <div className="tile-head">
              <strong>mnemopi memory</strong>
              <span className={`tag ${data.mnemopi_on ? "ok" : "warn"}`}>{data.mnemopi_on ? "on" : "off"}</span>
            </div>
            <p className="tile-hint">long-term recall / retain</p>
          </div>
        </div>
      )}
    </Page>
  );
}

// ── Live /auto engine run (real .cache/8sync/engine/state.json, not demo) ──
function EngineRunBoard() {
  const { data } = useQuery({ queryKey: ["engine-run"], queryFn: api.engine, refetchInterval: 4000 });
  if (!data) return null;
  if (!data.active) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="tile-head"><strong>/auto engine</strong><span className="tag warn">idle</span></div>
        <p className="tile-hint">No active run. Start one in omp with <code>/auto &lt;goal&gt;</code> — this board mirrors the real <code>.cache/8sync/engine/state.json</code>.</p>
      </div>
    );
  }
  const total = data.total ?? 0, done = data.done ?? 0, blocked = data.blocked ?? 0;
  const pct = total > 0 ? Math.round((done * 100) / total) : 0;
  const icon = (s: string) => (s === "done" ? "✓" : s === "in_progress" ? "▸" : s === "blocked" ? "✗" : "○");
  const cls = (s: string) => (s === "done" ? "ok" : s === "blocked" ? "warn" : "");
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="tile-head">
        <strong>/auto engine — live run</strong>
        <span className="tag ok">{done}/{total} done{blocked ? ` · ${blocked} blocked` : ""}</span>
      </div>
      {data.goal && <p className="tile-hint" style={{ marginTop: 0 }}>{data.goal}</p>}
      <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.08)", overflow: "hidden", margin: "8px 0" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "#7c5cff" }} />
      </div>
      {data.current && (
        <p className="tile-sub">▸ current: <strong>{data.current.task}</strong> <span className="tag">{data.current.slice}</span></p>
      )}
      {(data.slices ?? []).map((s) => (
        <div key={s.id ?? s.title} style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, margin: "6px 0 4px" }}>{s.title}</div>
          {s.tasks.map((t) => (
            <div key={t.id ?? t.title} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0", fontSize: 13 }}>
              <span className={`tag ${cls(t.status)}`}>{icon(t.status)}</span>
              <span>{t.title}{t.retries ? ` · ${t.retries} retries` : ""}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Bench ──────────────────────────────────────────────────────────────────
function BenchPage() {
  const { data, error, refetch, isFetching } = useQuery({ queryKey: ["bench"], queryFn: api.bench });
  const seg = (label: React.ReactNode, tok: number) => {
    const pct = data && data.upfront > 0 ? Math.round((tok / data.upfront) * 100) : 0;
    return (
      <div className="row">
        <span>{label}</span>
        <span className="meter">
          <span className="bar"><span style={{ width: `${pct}%` }} /></span>
          <span className="pct meter-val-wide mono">~{tok} tok · {pct}%</span>
        </span>
      </div>
    );
  };
  return (
    <Page
      title="Bench"
      sub="Per-session context budget — what the repo puts in front of the agent every session (skills come from the global ECC plugin)."
      action={
        <button className="primary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Running…" : "Re-run"}
        </button>
      }
    >
      {error ? <ErrorState message={(error as Error).message} /> : null}
      {isFetching && !data ? <Loading rows={5} /> : null}
      {data ? (
        <>
          {data.spine_advice ? (
            <div className="card list">
              <div className="row"><span className="tag warn">spine</span><span>{data.spine_advice}</span></div>
            </div>
          ) : null}
          <div className="card list">
            <div className="row row-total">
              <strong>Upfront <span className="muted">(paid every session)</span></strong>
              <span className="pct mono">~{data.upfront} tok</span>
            </div>
            {seg("8sync block", data.force_load_prefix)}
            {seg(<>Memory spine <span className="muted">(agents/*.md)</span></>, data.spine_tok)}
          </div>
          <div className="card list">
            <div className="row"><span>A1 stable-prefix (KV-cache)</span><span className={`tag ${data.a1_pass ? "ok" : "warn"}`}>{data.a1_pass ? "pass" : "fail"}</span></div>
          </div>
        </>
      ) : null}
    </Page>
  );
}

// ── Readiness (eval) ───────────────────────────────────────────────────────
function EvalPage() {
  const { data, error, refetch, isFetching } = useQuery({ queryKey: ["eval"], queryFn: api.evalProject, enabled: false });
  return (
    <Page
      title="Readiness"
      sub="Agent-team capability coverage on this project (deterministic, not output quality)."
      action={
        <button className="primary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Scoring…" : "Score readiness"}
        </button>
      }
    >
      {error ? <ErrorState message={(error as Error).message} /> : null}
      {isFetching && !data ? <Loading rows={6} /> : null}
      {!data && !isFetching && !error ? (
        <EmptyState title="Not scored yet" hint="Run the score to see per-role coverage for this project." />
      ) : null}
      {data ? (
        <div className="card list">
          <div className="row row-total"><strong>Overall</strong><span className="pct">{data.overall}% <span className="muted">({data.present}/{data.total})</span></span></div>
          {data.roles.map((r) => (
            <div className="row" key={r.role}>
              <span className="mono row-role">{r.role}</span>
              <span className="meter">
                <span className="bar"><span style={{ width: `${r.pct}%` }} /></span>
                <span className="pct meter-val">{r.pct}%</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Page>
  );
}

// ── Workspaces ─────────────────────────────────────────────────────────────
function WorkspacesPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces });
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const activate = useMutation({
    mutationFn: (profile: string) => api.activateWorkspace(profile),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  return (
    <Page
      title="Workspaces"
      sub={<>omp profiles + current project. Activate records the choice (advisory — run omp with <code>--profile</code> in that dir to isolate).</>}
      action={<button className="primary" onClick={() => setCreating(true)}><Glyph name="plus" /> New project</button>}
    >
      {creating ? <NewProjectModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); qc.invalidateQueries(); }} /> : null}
      {isLoading ? <Loading rows={4} /> : error ? <ErrorState message={(error as Error).message} /> : !data ? (
        <EmptyState title="No workspace data" />
      ) : (
        <>
          <div className="card">
            <div className="kv"><span className="kv-k">current project</span><span className="kv-v mono">{data.project || "—"}</span></div>
            <div className="kv"><span className="kv-k">session</span><span className="kv-v mono">{data.session || "—"}</span></div>
          </div>
          <div className="card">
            <div className="card-title">Profiles</div>
            {data.profiles.length === 0 ? <p className="muted">No profiles defined.</p> : (
              <div className="list">
                {data.profiles.map((p) => (
                  <div className="row" key={p}>
                    <span className="mono">{p}</span>
                    <button className="primary" onClick={() => activate.mutate(p)} disabled={activate.isPending}>Activate</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Page>
  );
}

// ── New project modal (scaffold + MCP + knowledge) ─────────────────────────
function toggleInSet<T>(set: (u: (s: Set<T>) => Set<T>) => void, v: T) {
  set((s) => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  });
}

function ModalSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="modal-sec">
      <button className="modal-sec-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Glyph name="chevron" />
        <span>{title}</span>
        {count > 0 ? <span className="tag accent">{count}</span> : null}
      </button>
      {open ? <div className="modal-sec-body">{children}</div> : null}
    </div>
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [mcp, setMcp] = useState<Map<string, string>>(new Map());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const mcpQ = useQuery({ queryKey: ["mp", "mcp", "", "top"], queryFn: () => api.marketplace("mcp", "", "top") });
  const knQ = useQuery({ queryKey: ["knowledge", ""], queryFn: () => api.knowledge("") });
  const create = useMutation({
    mutationFn: () => {
      const knowledge = (knQ.data?.categories ?? [])
        .filter((c) => cats.has(c.name))
        .flatMap((c) => c.entries.map((e) => ({ name: e.name, url: e.url, desc: e.desc, category: c.name })));
      return api.projectCreate({
        name: name.trim(),
        mcp: [...mcp].map(([n, spec]) => ({ name: n, spec })),
        knowledge,
      });
    },
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const mcpSpec = (it: MarketItem): string => {
    const i = it.install;
    if (i.command) return [i.command, ...(i.args ?? [])].join(" ");
    if (i.url) return i.url;
    return i.spec ?? "";
  };
  const done = create.isSuccess && create.data;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Create project" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>New project</strong>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {done ? (
          <>
            <div className="modal-body">
              <div className="empty">
                <strong>Created ✓</strong>
                <span className="muted mono">{create.data.path}</span>
                <span className="muted">
                  {create.data.mcp_added} MCP · {create.data.knowledge_added} knowledge links
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <span className="muted hint-inline">Switched the dashboard to it.</span>
              <button className="primary" onClick={onCreated}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <div className="field">
                <span className="field-label">Project name</span>
                <input type="text" placeholder="my-new-project" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <span className="hint-inline muted mono">~/Projects/{name.trim() || "<name>"}</span>
              </div>
              <ModalSection title="MCP tools" count={mcp.size}>
                {(mcpQ.data?.items ?? []).slice(0, 24).map((it) => {
                  const on = mcp.has(it.name);
                  return (
                    <label className={`kn-entry${on ? " on" : ""}`} key={it.id}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setMcp((m) => { const n = new Map(m); if (on) n.delete(it.name); else n.set(it.name, mcpSpec(it)); return n; })}
                      />
                      <span className="kn-entry-main">
                        <span className="kn-entry-name">{it.name}</span>
                        <span className="kn-entry-desc">{it.description}</span>
                      </span>
                    </label>
                  );
                })}
              </ModalSection>
              <ModalSection title="Knowledge (by category)" count={cats.size}>
                {(knQ.data?.categories ?? []).map((c) => (
                  <label className={`kn-entry${cats.has(c.name) ? " on" : ""}`} key={c.name}>
                    <input type="checkbox" checked={cats.has(c.name)} onChange={() => toggleInSet(setCats, c.name)} />
                    <span className="kn-entry-main">
                      <span className="kn-entry-name">{c.name}</span>
                      <span className="kn-entry-desc">{c.count} resources</span>
                    </span>
                  </label>
                ))}
              </ModalSection>
            </div>
            <div className="modal-foot">
              {create.error ? <span className="hint-err">{(create.error as Error).message}</span>
                : <span className="muted hint-inline">Scaffolds AGENTS.md + su-code memory + selected extras.</span>}
              <div className="row-actions">
                <button onClick={onClose}>Cancel</button>
                <button className="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                  {create.isPending ? "Creating…" : "Create project"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Team ───────────────────────────────────────────────────────────────────
function TeamPage() {
  const { data, error, refetch, isFetching } = useQuery({ queryKey: ["team"], queryFn: api.team, enabled: false });
  return (
    <Page
      title="Team"
      sub="omp subagent roster + per-project readiness."
      action={<button className="primary" onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Loading…" : "Load team"}</button>}
    >
      {error ? <ErrorState message={(error as Error).message} /> : null}
      {isFetching && !data ? <Loading rows={5} /> : null}
      {!data && !isFetching && !error ? (
        <EmptyState title="Team not loaded" hint="Load the roster to see each subagent’s role and skills." />
      ) : null}
      {data ? (
        <div className="card list">
          <div className="row row-total"><strong>Readiness</strong><span className="pct">{data.readiness ? `${data.readiness.overall}%` : "—"}</span></div>
          {data.roster.map((r) => (
            <div className="row" key={r.type}>
              <div className="row-main">
                <div className="row-title mono">{r.type}</div>
                <div className="row-meta">{r.role}</div>
              </div>
              <span className="mono row-skills">{r.skills}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Page>
  );
}

// ── Submodules ─────────────────────────────────────────────────────────────
function SubmodulesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["submodules"], queryFn: api.submodules });
  const [url, setUrl] = useState("");
  const add = useMutation({
    mutationFn: (u: string) => api.submoduleAdd(u),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["submodules"] }); setUrl(""); },
  });
  const pull = useMutation({ mutationFn: (p: string) => api.submodulePull(p), onSuccess: () => qc.invalidateQueries({ queryKey: ["submodules"] }) });
  const remove = useMutation({ mutationFn: (p: string) => api.submoduleRemove(p), onSuccess: () => qc.invalidateQueries({ queryKey: ["submodules"] }) });
  return (
    <Page title="Submodules" sub="Reference repos. Add, pull, or remove.">
      <div className="card">
        <div className="toolbar">
          <input type="text" placeholder="https://github.com/owner/repo" value={url} onChange={(e) => setUrl(e.target.value)} className="grow" aria-label="submodule URL" />
          <button className="primary" disabled={!url || add.isPending} onClick={() => add.mutate(url)}>Add</button>
          <button onClick={() => refetch()}>Refresh</button>
        </div>
        {add.isError ? <p className="hint hint-err">Add failed: {(add.error as Error).message}</p> : null}
      </div>
      {isLoading ? <Loading rows={3} /> : error ? <ErrorState message={(error as Error).message} /> : data && data.length === 0 ? (
        <EmptyState title="No submodules" hint="Paste a repo URL above to add a reference submodule." />
      ) : data && data.length > 0 ? (
        <div className="card list">
          {data.map((s) => (
            <div className="row" key={s.path}>
              <div className="row-main">
                <div className="row-title mono">{s.name}</div>
                <div className="row-meta mono">{s.url}</div>
              </div>
              <span className="row-actions">
                <span className={`tag ${s.initialized ? "ok" : "warn"}`}>{s.initialized ? "init" : "deinit"}</span>
                <button onClick={() => pull.mutate(s.path)} disabled={pull.isPending}>Pull</button>
                <button className="danger" onClick={() => remove.mutate(s.path)} disabled={remove.isPending}>Remove</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Page>
  );
}

// ── MCP ────────────────────────────────────────────────────────────────────
function McpPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["mcp"], queryFn: api.mcp });
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const add = useMutation({
    mutationFn: () => api.mcpAdd({ name, spec }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mcp"] }); setName(""); setSpec(""); },
  });
  const remove = useMutation({ mutationFn: (n: string) => api.mcpRemove(n), onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp"] }) });
  return (
    <Page
      title="MCP servers"
      sub={<>From <code>~/.omp/agent/mcp.json</code>. omp loads these each session. Browse more in <b>Marketplace</b>.</>}
    >
      <div className="card">
        <div className="toolbar">
          <input type="text" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} aria-label="server name" style={{ maxWidth: 160 }} />
          <input
            className="grow"
            placeholder="Install — `npx -y pkg`, `uvx pkg`, or an https remote URL"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name && spec) add.mutate(); }}
            aria-label="mcp spec"
          />
          <button className="primary" disabled={!name || !spec || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? "Installing…" : "Install"}
          </button>
        </div>
        {add.isError ? <p className="hint hint-err">Install failed: {(add.error as Error).message}</p> : null}
        {add.isSuccess ? <p className="hint hint-ok">Installed{add.data?.note ? ` — ${add.data.note}` : ". omp loads it next session."}</p> : null}
      </div>
      {isLoading ? <Loading rows={3} /> : error ? <ErrorState message={(error as Error).message} /> : !data || data.servers.length === 0 ? (
        <EmptyState title="No MCP servers registered" hint="Install one above, or browse the Marketplace." />
      ) : (
        <div className="card list">
          {data.servers.map((s) => (
            <div className="row" key={s.name}>
              <div className="row-main">
                <div className="row-title mono">{s.name}</div>
                <div className="row-meta mono">{s.command} {s.args.join(" ")}</div>
              </div>
              <span className={`tag ${s.present ? "ok" : "warn"}`}>{s.present ? "present" : "missing"} · {s.type}</span>
              <button className="danger" onClick={() => remove.mutate(s.name)} disabled={remove.isPending}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

// ── Rules ──────────────────────────────────────────────────────────────────
function RulesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["rules"], queryFn: api.rules });
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<"project" | "global">("project");
  const add = useMutation({
    mutationFn: () => api.ruleAdd(name, content, scope),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules"] }); setName(""); setContent(""); },
  });
  const del = useMutation({ mutationFn: (p: string) => api.ruleDelete(p), onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }) });
  const [importSrc, setImportSrc] = useState("");
  const imp = useMutation({
    mutationFn: () => api.ruleImport(importSrc, scope),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules"] }); setImportSrc(""); },
  });
  return (
    <Page title="Rules" sub={<>omp rule files (<code>.omp/rules/*.md</code> project, <code>~/.omp/agent/rules/*.md</code> global).</>}>
      <div className="card">
        <div className="toolbar">
          <input type="text" placeholder="rule-name" value={name} onChange={(e) => setName(e.target.value)} className="grow" aria-label="rule name" />
          <label className="field">
            <span className="field-label">Scope</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as "project" | "global")}>
              <option value="project">project</option>
              <option value="global">global</option>
            </select>
          </label>
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Rule content (markdown)…" className="textarea-sm" aria-label="rule content" spellCheck={false} />
        <div className="toolbar toolbar-split">
          <span className="muted hint-inline">Type a rule inline, or import from a folder/GitHub below.</span>
          <button className="primary" disabled={!content || add.isPending} onClick={() => add.mutate()}>Add rule</button>
        </div>
        {add.isError ? <p className="hint hint-err">Add failed: {(add.error as Error).message}</p> : null}
      </div>
      <div className="card">
        <div className="toolbar">
          <input
            className="grow"
            placeholder="Import rules from a folder path or GitHub repo (.md/.mdc; prefers a rules/ subdir)"
            value={importSrc}
            onChange={(e) => setImportSrc(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && importSrc) imp.mutate(); }}
            aria-label="rule import source"
          />
          <button className="primary" disabled={!importSrc || imp.isPending} onClick={() => imp.mutate()}>
            {imp.isPending ? "Importing…" : "Import"}
          </button>
        </div>
        {imp.isError ? <p className="hint hint-err">Import failed: {(imp.error as Error).message}</p> : null}
        {imp.isSuccess ? <p className="hint hint-ok">Imported {imp.data?.imported ?? 0} rule file(s) into {scope}.</p> : null}
      </div>
      {isLoading ? <Loading rows={3} /> : error ? <ErrorState message={(error as Error).message} /> : data && data.length === 0 ? (
        <EmptyState title="No rules yet" hint="Add a project or global rule with the form above." />
      ) : data && data.length > 0 ? (
        <div className="card list">
          {data.map((r) => (
            <div className="row" key={r.path}>
              <div className="row-main">
                <div className="row-title mono">{r.name}</div>
                <div className="row-meta mono">{r.scope} · {r.bytes} B</div>
              </div>
              <button className="danger" onClick={() => del.mutate(r.path)} disabled={del.isPending}>Delete</button>
            </div>
          ))}
        </div>
      ) : null}
    </Page>
  );
}

// ── Workflow (react-flow editor + sample templates) ────────────────────────
// Node = one workflow step (skill / subagent / tool call). Export generates a
// standalone omp extension registering a model-callable `<name>_run` tool.
const WF_KIND_LABEL: Record<WfKind, string> = { step: "skill", subagent: "subagent", tool: "tool" };
let wfCounter = 0;

function makeWfNode(kind: WfKind): Node<WfData> {
  wfCounter += 1;
  return {
    id: `n${Date.now()}_${wfCounter}`,
    type: "wf",
    position: { x: 80 + Math.round(Math.random() * 160), y: 80 + Math.round(Math.random() * 120) },
    data: { label: `New ${WF_KIND_LABEL[kind]}`, kind, ref: "" },
  };
}

function WfNodeView({ data }: NodeProps<Node<WfData>>) {
  const color = data.kind === "subagent" ? "var(--accent-bright)" : data.kind === "tool" ? "var(--warn)" : "var(--ok)";
  return (
    <div className="wf-node" style={{ borderColor: color }}>
      <Handle type="target" position={Position.Top} />
      <div className="wf-node-kind" style={{ color }}>{WF_KIND_LABEL[data.kind]}</div>
      <div className="wf-node-label">{data.label}</div>
      {data.ref ? <div className="wf-node-ref">{data.ref}</div> : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

// react-flow's NodeTypes is invariant over the Node generic; cast through unknown.
const wfNodeTypes = { wf: WfNodeView } as unknown as NodeTypes;

// ── Marketplace (discover + install skills / MCP from external registries) ───
function MarketplacePage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"mcp" | "skill">("mcp");
  const [sort, setSort] = useState<"top" | "new">("top");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["marketplace", kind, search, sort],
    queryFn: () => api.marketplace(kind, search, sort),
  });
  const install = useMutation({
    mutationFn: async (it: MarketItem): Promise<{ ok: boolean }> => {
      if (it.kind === "skill") return api.skillAdd(it.install.spec ?? it.url);
      const i = it.install;
      if (i.type === "stdio") return api.mcpAdd({ name: it.name, command: i.command, args: i.args, type: "stdio", env: i.env });
      return api.mcpAdd({ name: it.name, url: i.url, type: i.type, headers: i.headers });
    },
    onSuccess: (_r, it) => qc.invalidateQueries({ queryKey: [it.kind === "skill" ? "skills" : "mcp"] }),
  });
  const [justInstalled, setJustInstalled] = useState<string>("");
  const doInstall = (it: MarketItem) => {
    if (it.install.type === "link") { window.open(it.url, "_blank", "noopener"); return; }
    install.mutate(it, { onSuccess: () => setJustInstalled(it.id) });
  };
  const items = data?.items ?? [];
  return (
    <Page
      title="Marketplace"
      sub={<>Discover &amp; install <b>MCP servers</b> and <b>skills</b> from public registries — one click into this project.</>}
      action={
        <div className="mk-toolbar">
          <div className="seg">
            <button className={kind === "mcp" ? "seg-on" : ""} onClick={() => setKind("mcp")}>MCP</button>
            <button className={kind === "skill" ? "seg-on" : ""} onClick={() => setKind("skill")}>Skills</button>
          </div>
          <div className="seg">
            <button className={sort === "top" ? "seg-on" : ""} onClick={() => setSort("top")}>Top</button>
            <button className={sort === "new" ? "seg-on" : ""} onClick={() => setSort("new")}>New</button>
          </div>
        </div>
      }
    >
      <div className="card">
        <div className="toolbar">
          <input
            className="grow"
            placeholder={kind === "mcp" ? "Search MCP servers (official · smithery · glama · mcp.so)…" : "Search skills on GitHub…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setSearch(draft.trim()); }}
            aria-label="marketplace search"
          />
          <button className="primary" onClick={() => setSearch(draft.trim())}>Search</button>
          {search ? <button onClick={() => { setDraft(""); setSearch(""); }}>Clear</button> : null}
        </div>
        <p className="muted list-count">
          {isLoading || isFetching ? "Loading…" : `${items.length} ${kind === "mcp" ? "servers" : "skills"}${search ? ` for “${search}”` : ""}`}
        </p>
      </div>
      {error ? <ErrorState message={(error as Error).message} /> : isLoading ? <Loading rows={6} /> : items.length === 0 ? (
        <EmptyState title="Nothing found" hint="Try a different search, or switch MCP/Skills." />
      ) : (
        <div className="mk-grid">
          {items.map((it) => {
            const done = justInstalled === it.id;
            const isLink = it.install.type === "link";
            const label = it.kind === "skill" ? "Download" : isLink ? "Open ↗" : "Install";
            return (
              <div className="mk-card" key={`${it.source}:${it.id}`}>
                <div className="mk-head">
                  <a className="mk-name" href={it.url} target="_blank" rel="noopener">{it.name}</a>
                  <div className="mk-badges">
                    <span className="tag src">{it.source}</span>
                    {it.new ? <span className="tag ok">new</span> : null}
                    {it.stars > 0 ? <span className="tag muted">★ {it.stars.toLocaleString()}</span> : null}
                  </div>
                </div>
                <p className="mk-desc">{it.description || "—"}</p>
                <div className="mk-foot">
                  <span className="tag muted mono">{it.install.type}</span>
                  <button
                    className={done ? "" : "primary"}
                    disabled={install.isPending && install.variables?.id === it.id}
                    onClick={() => doInstall(it)}
                  >
                    {done ? "✓ Added" : install.isPending && install.variables?.id === it.id ? "…" : label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}

// ── Knowledge (curated sindresorhus/awesome) ────────────────────────────────
// Auto-fetched "awesome list of awesome lists": browse categories, search,
// select high-signal entries, save them into the active project's
// su-code/REFERENCES.md so the agent can consult them.
type KnSel = { name: string; url: string; desc: string; category: string };

function KnowledgePage() {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Map<string, KnSel>>(new Map());
  const [saved, setSaved] = useState("");
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["knowledge", search],
    queryFn: () => api.knowledge(search),
  });
  const apply = useMutation({
    mutationFn: () => api.knowledgeApply([...sel.values()]),
    onSuccess: (r) => { setSaved(`Saved ${r.added} → ${r.path}`); setSel(new Map()); },
  });
  const cats = data?.categories ?? [];
  const toggle = (category: string, e: { name: string; url: string; desc: string }) =>
    setSel((m) => {
      const n = new Map(m);
      if (n.has(e.url)) n.delete(e.url);
      else n.set(e.url, { name: e.name, url: e.url, desc: e.desc, category });
      return n;
    });
  const selectCat = (c: (typeof cats)[number], on: boolean) =>
    setSel((m) => {
      const n = new Map(m);
      for (const e of c.entries) {
        if (on) n.set(e.url, { name: e.name, url: e.url, desc: e.desc, category: c.name });
        else n.delete(e.url);
      }
      return n;
    });
  return (
    <Page
      title="Knowledge"
      sub={<>Curated from <b>sindresorhus/awesome</b> — pick high-signal resources, save them into this project's <code>su-code/REFERENCES.md</code>.</>}
      action={
        <button className="ghost" disabled={isFetching}
          onClick={async () => { await api.knowledge(search, true); refetch(); }}>
          <Glyph name="refresh" /> Refresh
        </button>
      }
    >
      <div className="card">
        <div className="toolbar">
          <input className="grow" placeholder="Search resources (e.g. rust, react, security)…"
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setSearch(draft.trim()); }} aria-label="knowledge search" />
          <button className="primary" onClick={() => setSearch(draft.trim())}>Search</button>
          {search ? <button onClick={() => { setDraft(""); setSearch(""); }}>Clear</button> : null}
        </div>
        <p className="muted list-count">
          {isLoading || isFetching ? "Loading…" : `${data?.total ?? 0} resources · ${data?.category_count ?? 0} categories${search ? ` for “${search}”` : ""}`}
        </p>
      </div>

      {error ? <ErrorState message={(error as Error).message} />
        : isLoading ? <Loading rows={6} />
        : cats.length === 0 ? <EmptyState title="Nothing found" hint="Try another search term, or Refresh." />
        : (
        <div className="kn-list">
          {cats.map((c) => {
            const allOn = c.entries.length > 0 && c.entries.every((e) => sel.has(e.url));
            return (
              <div className="card kn-cat" key={c.name}>
                <div className="kn-cat-head">
                  <strong>{c.name}</strong>
                  <span className="muted mono">{c.count}</span>
                  <button className="link" onClick={() => selectCat(c, !allOn)}>{allOn ? "clear" : "select all"}</button>
                </div>
                <div className="kn-entries">
                  {c.entries.map((e) => (
                    <label className={`kn-entry${sel.has(e.url) ? " on" : ""}`} key={e.url}>
                      <input type="checkbox" checked={sel.has(e.url)} onChange={() => toggle(c.name, e)} />
                      <span className="kn-entry-main">
                        <a className="kn-entry-name" href={e.url} target="_blank" rel="noopener" onClick={(ev) => ev.stopPropagation()}>{e.name}</a>
                        {e.desc ? <span className="kn-entry-desc">{e.desc}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sel.size > 0 ? (
        <div className="kn-bar">
          <span className="kn-bar-count">{sel.size} selected</span>
          <div className="row-actions">
            <button onClick={() => setSel(new Map())}>Clear</button>
            <button className="primary" disabled={apply.isPending} onClick={() => { setSaved(""); apply.mutate(); }}>
              {apply.isPending ? "Saving…" : "Save to project"}
            </button>
          </div>
        </div>
      ) : null}
      {saved ? <p className="hint hint-ok">{saved}</p> : null}
      {apply.error ? <p className="hint hint-err">{(apply.error as Error).message}</p> : null}
    </Page>
  );
}

function WorkflowPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("demo");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WfData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selId, setSelId] = useState<string | null>(null);

  const list = useQuery({ queryKey: ["workflows"], queryFn: api.workflows });
  const templates = useQuery({ queryKey: ["wf-templates"], queryFn: api.workflowTemplates });
  const saveMut = useMutation({
    mutationFn: (v: { name: string; nodes: WfNode[]; edges: WfEdge[] }) => api.workflowSave(v.name, v.nodes, v.edges),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });
  const exportMut = useMutation({ mutationFn: (n: string) => api.workflowExport(n) });

  const selected = nodes.find((n) => n.id === selId) ?? null;
  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge(c, eds)), [setEdges]);
  const addNode = (kind: WfKind) => setNodes((ns) => [...ns, makeWfNode(kind)]);
  const updateSel = (patch: Partial<WfData>) => {
    if (!selected) return;
    setNodes((ns) => ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };
  const loadGraph = (g: { nodes?: WfNode[]; edges?: WfEdge[] } | null) => {
    if (!g) return;
    setNodes((g.nodes ?? []).map((x) => ({ id: x.id, type: "wf", position: x.position, data: x.data })));
    setEdges(g.edges ?? []);
    setSelId(null);
  };
  const load = async (n: string) => { setName(n); loadGraph(await api.workflowGet(n)); };
  const autoLayout = () => {
    const pos = layered(
      nodes.map((n) => ({ id: n.id, width: 184, height: 74 })),
      edges.map((e) => ({ source: e.source, target: e.target })),
      "DOWN",
    );
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
  };
  const save = () => {
    const wfNodes: WfNode[] = nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }));
    const wfEdges: WfEdge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
    saveMut.mutate({ name, nodes: wfNodes, edges: wfEdges });
  };

  return (
    <Page title="Workflow" sub="Visual agent workflow. Export generates a model-callable omp extension tool.">
      <div className="wf-toolbar card">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="mono" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <span className="wf-toolbar-spacer" />
        <button onClick={() => addNode("step")}>+ Skill step</button>
        <button onClick={() => addNode("subagent")}>+ Subagent</button>
        <button onClick={() => addNode("tool")}>+ Tool call</button>
        <button onClick={autoLayout}>Auto-layout</button>
        <button className="primary" onClick={save} disabled={saveMut.isPending}>Save workflow</button>
        <button onClick={() => exportMut.mutate(name)} disabled={exportMut.isPending}>Export to omp</button>
      </div>
      {exportMut.data ? (
        <p className="hint hint-ok mono">exported → {exportMut.data.path} (tool: {exportMut.data.tool})</p>
      ) : saveMut.data ? (
        <p className="hint hint-ok mono">saved → {saveMut.data.path}</p>
      ) : null}
      <div className="wf-layout">
        <div className="wf-canvas card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={wfNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelId(n.id)}
            fitView
            minZoom={0.2}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
        <div className="wf-side card">
          <h3>Edit node</h3>
          {selected ? (
            <>
              <label className="field">
                <span className="field-label">Label</span>
                <input className="mono" value={selected.data.label} onChange={(e) => updateSel({ label: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Kind</span>
                <select value={selected.data.kind} onChange={(e) => updateSel({ kind: e.target.value as WfKind })}>
                  <option value="step">skill</option>
                  <option value="subagent">subagent</option>
                  <option value="tool">tool</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Ref (skill / tool / subagent id)</span>
                <input className="mono" value={selected.data.ref} onChange={(e) => updateSel({ ref: e.target.value })} />
              </label>
            </>
          ) : (
            <p className="muted wf-empty">Select a node to edit, or add one from the toolbar.</p>
          )}
          <h3>Templates</h3>
          {templates.error instanceof EndpointMissingError ? (
            <p className="wf-empty">Templates endpoint not live yet.</p>
          ) : templates.isLoading ? (
            <p className="wf-empty">Loading…</p>
          ) : (templates.data ?? []).length === 0 ? (
            <p className="wf-empty">(none)</p>
          ) : (
            <ul className="wf-list">
              {templates.data?.map((t) => (
                <li key={t.name}><button className="link" onClick={() => { setName(t.name); loadGraph(t); }}>{t.name}</button></li>
              ))}
            </ul>
          )}
          <h3>Saved workflows</h3>
          {list.isLoading ? <p className="wf-empty">Loading…</p> : (
            <ul className="wf-list">
              {(list.data ?? []).length === 0 ? <li className="wf-empty">(none yet)</li> : list.data?.map((n) => (
                <li key={n}><button className="link" onClick={() => load(n)}>{n}</button></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Page>
  );
}
