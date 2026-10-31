#!/usr/bin/env python3
"""Generate the shipped `/eccx-<category>` orchestrator commands.

One command per ECC web category (https://ecc.tools/skills) plus `ads`, `game`
and the cross-category router `full`. Each lists EVERY member of its category
(ECC skills/agents/commands + the skills 8sync bundles) as one compact line, and
tells the agent to pick all that apply, load them on demand, plan, execute with
verification, and report.

Inputs (committed, so the default run is deterministic and offline):
  scripts/eccx/ecc-snapshot.json   ECC members: name, ecc.tools category, install
                                   modules, short purpose
  assets/skills/*/SKILL.md         8sync-bundled skills (both harnesses)
  assets/claude/skills/*/SKILL.md  8sync Claude Code kit skills (Claude only)
Outputs:
  assets/claude/commands/eccx-*.md  Claude Code (`8sync ccc kit` + the 8sync-kit plugin)
  assets/eccx/eccx-*.md             omp (deployed bare to ~/.omp/agent/commands/)

  python scripts/eccx-gen.py                       regenerate from the snapshot
  python scripts/eccx-gen.py --refresh DIR [--catalog JSON]
      rebuild the snapshot from an ECC plugin dir (newest
      ~/.claude/plugins/cache/ecc/ecc/<ver>/) and, optionally, a fresh ecc.tools
      catalog export ({"items": [{id, type, category, desc}]}); without
      --catalog the web categories already in the snapshot are kept.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "scripts", "eccx", "ecc-snapshot.json")
BUNDLED = os.path.join(ROOT, "assets", "skills")
KIT = os.path.join(ROOT, "assets", "claude", "skills")
OUT = {"cc": os.path.join(ROOT, "assets", "claude", "commands"), "omp": os.path.join(ROOT, "assets", "eccx")}
MAX_BYTES = 13 * 1024

CATS = {  # id: (title, scope)
    "core": ("Core", "harness basics: standards, learning, compaction, always-on rules"),
    "workflow": ("Workflow", "plan, build, test, review, refactor, ship — the engineering loop"),
    "ai-agent": ("AI Agent", "agent harnesses, loops, evals, prompts, context and token economy"),
    "security": ("Security", "security review, scanning, hardening, compliance, crypto"),
    "research": ("Research", "deep research, papers, literature, replication, remote compute"),
    "frontend": ("Frontend", "UI, design systems, React/Vue/Next, a11y, motion, web quality"),
    "backend": ("Backend", "APIs, databases, infra, deploy, Node/.NET/PHP, Encore/Eino, Rust"),
    "python": ("Python", "Python, Django, FastAPI, PyTorch, ML engineering"),
    "golang": ("Go", "Go patterns, testing, build and review"),
    "jvm": ("JVM", "Java, Kotlin, Spring, Quarkus, Android/Compose"),
    "swift": ("Swift", "Swift, SwiftUI, Apple platforms"),
    "cpp": ("C++", "C++, CUDA kernels, x86/SIMD performance"),
    "perl": ("Perl", "Perl patterns, security, testing"),
    "industry": ("Industry", "supply chain, logistics, energy, healthcare, documents"),
    "content": ("Content", "articles, docs, papers, CVs, investor and business writing"),
    "specialized": ("Specialized", "operator tools, media, desks, homelab, niche domains"),
    "ads": ("Ads & Marketing", "campaigns, ads, social, SEO, brand, content distribution, lead gen"),
    "game": ("Game & 3D", "three.js, R3F, GSAP/3D web, Unreal/Blender, game assets"),
    "full": ("Cross-category", "router: picks every relevant category and merges their plans"),
}
NOTES = {"backend": "Rust (rust-*) sits here: the ECC web catalog has no Rust category."}

# 8sync skills -> categories (first = primary). Every bundled/kit skill MUST be listed: a new
# skill fails the run until someone files it.
BUNDLED_CATS = {
    "8sync-cli": ["core"], "ai-microservice-design": ["ai-agent", "backend"], "assp-skill": ["ads", "content"],
    "aup-audit": ["security"], "autoresearch": ["research", "ai-agent"], "branch-sync": ["workflow"],
    "deep-research-web": ["research"], "encore-deploy": ["backend", "golang"], "encore-eino-go": ["backend", "golang"],
    "feature": ["workflow"], "full-flow": ["workflow"], "image-gen": ["ads", "game"], "image-routing": ["core"],
    "impeccable": ["frontend"], "karpathy-guidelines": ["core"], "last30days": ["research", "ads"],
    "locate-anything": ["specialized"], "nextjs-app": ["frontend"], "ponytail": ["core"],
    "remote-compute": ["research"], "research-paper": ["research", "content"], "senior-frontend": ["frontend"],
    "senior-security": ["security"], "social-growth": ["ads"], "super-pdf": ["content"],
    "taste-brutalist": ["frontend"], "taste-minimalist": ["frontend"], "taste-output": ["core"],
    "taste-redesign": ["frontend"], "taste-skill": ["frontend"], "taste-soft": ["frontend"],
    "tauri-v2": ["backend", "frontend"], "trail": ["core"], "zai-vision": ["specialized"],
}
KIT_CATS = {  # Claude Code kit only
    "autopilot": ["workflow"], "clean": ["specialized"], "consolidate": ["core"], "do": ["workflow"],
    "harden": ["security"], "planning": ["workflow"], "remember": ["core"], "rules": ["core", "security"],
    "sec": ["security"], "ship": ["workflow"], "ship-auto": ["workflow"], "ship-loop": ["workflow"],
    "ship-tick": ["workflow"], "sysdesign": ["backend", "workflow"], "ui-ux": ["frontend"],
}

# ECC overrides: name -> categories (first = primary). Applied before the rule classifier.
ECC_OVERRIDE = {
    "blender-motion-state-inspection": ["game", "specialized"],
    "product-capability": ["workflow"],
    "ecc-tools-cost-audit": ["ai-agent"], "cost-tracking": ["ai-agent"], "token-card": ["ai-agent"],
    "github-ops": ["workflow"], "jira-integration": ["workflow"], "project-flow-ops": ["workflow"],
    "terminal-ops": ["workflow"], "repo-scan": ["security"], "mcp-dependency-review": ["security"],
    "i18n-sync": ["frontend"], "bengali-nlp": ["specialized"], "regex-vs-llm-structured-text": ["specialized"],
    "flutter-dart-code-review": ["frontend"], "dart-flutter-patterns": ["frontend"],
    "windows-desktop-e2e": ["workflow"], "browser-qa": ["workflow", "frontend"], "ui-demo": ["specialized", "ads"],
    "ios-icon-gen": ["swift"], "unified-memory": ["ai-agent"], "knowledge-ops": ["specialized"],
    "ml-adoption-playbook": ["python"], "mle-workflow": ["python"], "recsys-pipeline-architect": ["python"],
    "data-scraper-agent": ["ai-agent", "research"], "benchmark": ["workflow", "frontend"],
    "visa-doc-translate": ["industry"], "nutrient-document-processing": ["specialized"],
    "llm-trading-agent-security": ["security"], "defi-amm-security": ["security"], "evm-token-decimals": ["security"],
    "nodejs-keccak256": ["security"], "esign-field-placement": ["industry"], "master-agreement-generator": ["industry"],
    "counterparty-channel-discipline": ["specialized"], "operator-approval-loop": ["specialized"],
    "mcp-server-patterns": ["backend", "ai-agent"], "hexagonal-architecture": ["backend"], "contract-first": ["backend"],
    "council": ["workflow"], "council-multi-model": ["workflow"], "santa-method": ["workflow"],
    "dev-team": ["workflow"], "team-agent-orchestration": ["ai-agent"], "team-builder": ["ai-agent"],
    "email-ops": ["specialized"], "messages-ops": ["specialized"], "google-workspace-ops": ["specialized"],
    "customer-billing-ops": ["specialized"], "finance-billing-ops": ["specialized"],
    "connections-optimizer": ["ads"], "lead-intelligence": ["ads"], "social-graph-ranker": ["ads"],
    "social-publisher": ["ads"], "brand-discovery": ["ads"], "brand-voice": ["ads", "content"],
    "competitive-platform-analysis": ["ads", "research"], "competitive-report-structure": ["ads", "research"],
    "marketing-campaign": ["ads"], "seo": ["ads", "frontend"], "taste": ["specialized", "ads"],
    "taste-application": ["specialized", "ads"], "taste-distillation": ["specialized", "ads"],
    "tasteforge-video": ["specialized", "ads"], "manim-video": ["specialized", "ads"],
    "remotion-video-creation": ["specialized", "ads"], "motion-advanced": ["frontend", "game"],
    "motion-foundations": ["frontend"], "motion-patterns": ["frontend"], "generating-python-installer": ["python"],
    "prediction-market-oracle-research": ["specialized"], "prediction-market-risk-review": ["specialized"],
    "healthcare-cdss-patterns": ["industry"], "healthcare-emr-patterns": ["industry"],
    "healthcare-eval-harness": ["industry"], "healthcare-phi-compliance": ["industry", "security"],
    "hipaa-compliance": ["industry", "security"], "docs-governance": ["content", "workflow"],
    "living-docs-governance": ["content", "workflow"], "code-tour": ["workflow"], "codebase-onboarding": ["workflow"],
    "agent-sort": ["ai-agent"], "skill-scout": ["ai-agent"], "skill-comply": ["ai-agent"],
    "skill-host-compat": ["ai-agent"], "rules-distill": ["ai-agent"], "hookify-rules": ["ai-agent"],
    "config-gc": ["ai-agent"], "ck": ["ai-agent"], "deepseek-harness-setup": ["ai-agent"], "ecc-guide": ["core"],
    "ecc-recipes": ["core"], "growth-log": ["workflow"], "error-handling": ["backend", "workflow"],
    "intent-driven-development": ["workflow"], "inherit-legacy-style": ["workflow"],
    "benchmark-methodology": ["research", "ads"], "data-throughput-accelerator": ["backend"],
    "latency-critical-systems": ["backend"], "nasiko-control-plane": ["ai-agent"],
    "recursive-decision-ledger": ["ai-agent"], "loop-design-check": ["ai-agent"],
}
AGENT_CAT = {
    "marketing-agent": "ads", "seo-specialist": "ads", "a11y-architect": "frontend", "typescript-reviewer": "frontend",
    "rag-pipeline-reviewer": "ai-agent", "agent-evaluator": "ai-agent", "conversation-analyzer": "ai-agent",
    "gan-evaluator": "ai-agent", "gan-generator": "ai-agent", "gan-planner": "ai-agent", "mle-reviewer": "python",
    "pytorch-build-resolver": "python", "homelab-architect": "backend", "network-architect": "backend",
    "network-config-reviewer": "backend", "network-troubleshooter": "backend", "healthcare-reviewer": "industry",
    "bengali-reviewer": "specialized", "docs-lookup": "research", "spec-miner": "workflow",
    "performance-optimizer": "workflow", "harmonyos-app-resolver": "specialized", "php-reviewer": "backend",
    "ruby-reviewer": "backend", "csharp-reviewer": "backend", "fsharp-reviewer": "backend",
    "dart-build-resolver": "frontend", "flutter-reviewer": "frontend",
    "opensource-forker": "specialized", "opensource-packager": "specialized", "opensource-sanitizer": "security",
}
CMD_CAT = {
    "marketing-campaign": "ads", "astra-review": "workflow", "auto-update": "core", "cost-report": "ai-agent",
    "ecc-guide": "core", "feature-dev": "workflow", "jira": "workflow", "pr": "workflow", "prune": "ai-agent",
    "project-init": "core", "plan-canvas": "workflow", "plan-prd": "workflow", "santa-loop": "workflow",
    "security-scan": "security", "skill-health": "ai-agent", "skill-host-compat": "ai-agent", "token-card": "ai-agent",
    "review-pr": "workflow", "gan-build": "ai-agent", "gan-design": "frontend", "fastapi-review": "python",
    "flutter-build": "frontend", "flutter-review": "frontend", "flutter-test": "frontend",
    "react-build": "frontend", "react-review": "frontend", "react-test": "frontend", "vue-review": "frontend",
    "cpp-build": "cpp", "cpp-review": "cpp", "cpp-test": "cpp", "issue-review": "workflow",
}
ADS_MODULES = {"business-content", "social-distribution", "media-generation"}
STOP = {"a", "an", "and", "or", "the", "to", "of", "for", "with", "via", "in", "on", "by", "from", "into", "its",
        "their", "your", "at", "as", "that", "since", "&"}


def rules_category(name, modules):
    has = lambda *ws: any(re.search(r"(^|-)" + w, name) for w in ws)
    mods = set(modules)
    if "supply-chain-domain" in mods or has("logistics", "customs", "energy", "healthcare", "hipaa", "carrier", "inventory", "production-scheduling", "quality-nonconformance", "returns"):
        return "industry"
    if has("perl"):
        return "perl"
    if has("cpp"):
        return "cpp"
    if has("swift") or "swift-apple" in mods:
        return "swift"
    if has("python", "django", "fastapi", "pytorch") or "machine-learning" in mods:
        return "python"
    if has("golang", "go"):
        return "golang"
    if has("java", "kotlin", "spring", "springboot", "jpa", "android", "compose", "quarkus", "mybatis", "gradle"):
        return "jvm"
    if has("rust"):
        return "backend"
    if has("react", "vue", "next", "nuxt", "vite", "angular", "motion", "design", "ui", "ux", "accessibility", "a11y", "frontend", "liquid", "make-interfaces"):
        return "frontend"
    if "security" in mods or has("security", "safety", "gateguard"):
        return "security"
    if has("api", "db", "database", "postgres", "mysql", "redis", "clickhouse", "prisma", "docker", "kubernetes", "deploy", "node", "nest", "laravel", "dotnet", "csharp", "fsharp", "bun", "rails", "tinystruct") or {"database", "devops-infra"} & mods:
        return "backend"
    if "research-apis" in mods or has("research", "search", "scientific", "literature", "osint"):
        return "research"
    if has("orch", "tdd", "verification", "e2e", "git", "review", "refactor", "plan", "blueprint"):
        return "workflow"
    if has("agent", "agentic", "llm", "prompt", "eval", "loop", "context", "token", "claude", "harness", "autonomous", "skill", "hermes", "nanoclaw", "openclaw") or "agentic-patterns" in mods:
        return "ai-agent"
    if {"workflow-quality", "optimization-workflows", "documentation-test-regression", "documentation-change-impact", "documentation-context", "orchestration"} & mods:
        return "workflow"
    if "business-content" in mods:
        return "content"
    return "specialized"


def short(desc, words=12):
    d = (desc or "").strip().strip('"').strip("'")
    if d in (">", ">-", "|", ""):
        return ""
    d = d.replace("`", "")
    d = re.sub(r"^(Use (this skill )?(when|for|whenever|to|in|on|before|after|during)\b[^,—:.]*[,—:]?\s*)", "", d, flags=re.I) or d
    d = re.split(r"(?<=[a-z0-9)])\. |\s[—–]\s|; ", d)[0]
    out = " ".join(d.split()[:words]).rstrip(",;:.—-(")
    out = re.sub(r"\s*\([^)]*$", "", out)
    return out[:1].upper() + out[1:]


def clip(text, maxw):
    w = text.split()[:maxw]
    while len(w) > 1 and (w[-1].lower().strip(",;:") in STOP or w[-1].endswith(",")):
        w.pop()
    return " ".join(w).rstrip(",;:.—-(")


def frontmatter(path):
    """(name, description) from a SKILL.md / agent / command frontmatter."""
    try:
        t = open(path, encoding="utf-8", errors="replace").read(8000)
    except OSError:
        return "", ""
    m = re.match(r"^---\s*\n(.*?)\n---", t.replace("\r\n", "\n"), re.S)
    if not m:
        return "", ""
    fm = m.group(1)
    n = re.search(r"^name:[ \t]*(.*)$", fm, re.M)
    d = re.search(r"^description:[ \t]*(.*)$", fm, re.M)
    v = d.group(1).strip() if d else ""
    if d and v in (">", ">-", "|", "|-", ""):  # block scalar
        buf = []
        for ln in fm[d.end():].splitlines()[1:]:
            if not ln.startswith((" ", "\t")):
                break
            buf.append(ln.strip())
        v = " ".join(buf)
    return (n.group(1).strip().strip('"').strip("'") if n else ""), v.strip('"').strip("'")


def listdir(p):
    try:
        return sorted(os.listdir(p))
    except OSError:
        return []


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")


# ------------------------------------------------------------------ snapshot
def refresh(plugin, catalog_path):
    plugin = plugin.rstrip("/\\")
    old = json.load(open(SNAP, encoding="utf-8")) if os.path.isfile(SNAP) else {}
    if catalog_path:
        items = json.load(open(catalog_path, encoding="utf-8"))["items"]
        web = {(i["type"], i["id"]): i for i in items}
    else:
        web = {}
        for kind, typ in (("skills", "skill"), ("agents", "agent"), ("commands", "command")):
            for n, e in old.get(kind, {}).items():
                if e.get("web"):
                    web[(typ, n)] = {"category": e["web"], "desc": e.get("web_desc", "")}
    modules = {}
    mf = os.path.join(plugin, "manifests", "install-modules.json")
    for m in json.load(open(mf, encoding="utf-8")).get("modules", []) if os.path.isfile(mf) else []:
        for p in m.get("paths", []):
            parts = p.replace("\\", "/").split("/")
            if len(parts) >= 2 and parts[0] == "skills":
                modules.setdefault(parts[1], set()).add(m["id"])
    snap = {"source": f"ECC plugin {os.path.basename(plugin)} + ecc.tools/skills catalog", "skills": {}, "agents": {}, "commands": {}}
    for kind, typ, path in (("skills", "skill", lambda n: f"{plugin}/skills/{n}/SKILL.md"),
                            ("agents", "agent", lambda n: f"{plugin}/agents/{n}.md"),
                            ("commands", "command", lambda n: f"{plugin}/commands/{n}.md")):
        names = ([d for d in listdir(plugin + "/skills") if os.path.isfile(path(d))] if kind == "skills"
                 else [f[:-3] for f in listdir(f"{plugin}/{kind}") if f.endswith(".md")])
        for n in names:
            w = web.get((typ, n))
            e = {"purpose": short(w["desc"]) if w and w.get("desc") else short(frontmatter(path(n))[1])}
            if w:
                e["web"] = w["category"]
                if w.get("desc"):
                    e["web_desc"] = w["desc"]
            if kind == "skills":
                e["modules"] = sorted(modules.get(n, ()))
            snap[kind][n] = e
    write_json(SNAP, snap)
    print(f"snapshot: {len(snap['skills'])} skills, {len(snap['agents'])} agents, {len(snap['commands'])} commands -> {os.path.relpath(SNAP, ROOT)}")


# ------------------------------------------------------------------ members
def classify(snap):
    members = {c: {"skills": {}, "agents": {}, "commands": {}} for c in CATS if c != "full"}

    def add(cat, kind, name, purpose, src):
        assert cat in members, (name, cat)
        members[cat][kind][(name, src)] = purpose

    for s, e in snap["skills"].items():
        mods, w = e.get("modules", []), e.get("web")
        if s in ECC_OVERRIDE:
            cats = list(ECC_OVERRIDE[s])
            if w and w not in cats:
                cats = [w] + cats[:1]
        else:
            cats = [w or rules_category(s, mods)]
            if (ADS_MODULES & set(mods) or cats[0] == "content") and "ads" not in cats:
                cats.append("ads")
        for c in cats[:2]:
            add(c, "skills", s, e["purpose"], "ecc")
    for a, e in snap["agents"].items():
        c = e.get("web") or AGENT_CAT.get(a)
        if not c:
            c = "workflow" if re.match(r"(code-|comment-|commit-|pr-|silent-|type-design|refactor|tdd|e2e|build-error|planner|architect|doc-)", a) else rules_category(a, [])
        add(c, "agents", a, e["purpose"], "ecc")
    for k, e in snap["commands"].items():
        c = e.get("web") or CMD_CAT.get(k)
        if not c:
            c = ("workflow" if re.match(r"(epic-|orch-|prp-)", k) else
                 "ai-agent" if re.match(r"(hookify|instinct-)", k) else rules_category(k, []))
        add(c, "commands", k, e["purpose"], "ecc")

    for src, base, table in (("8sync", BUNDLED, BUNDLED_CATS), ("kit", KIT, KIT_CATS)):
        dirs = [d for d in listdir(base) if os.path.isfile(os.path.join(base, d, "SKILL.md"))]
        missing = sorted(set(dirs) - set(table))
        stray = sorted(set(table) - set(dirs))
        if missing or stray:
            sys.exit(f"eccx-gen: file every {os.path.relpath(base, ROOT)} skill in the category table — unfiled {missing}, gone {stray}")
        for d in dirs:
            name, desc = frontmatter(os.path.join(base, d, "SKILL.md"))
            for c in table[d]:
                add(c, "skills", name or d, short(desc), src)
    return members


# ------------------------------------------------------------------ render
ECC_DIR = ("`<ECC>` = 8sync's pinned ECC checkout `~/.cache/8sync/ecc/` (made by `8sync harness`), "
           "else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.")
HOW = {
    "cc": ("- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. "
           "`<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).\n"
           "- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so."),
    "omp": ("- " + ECC_DIR + "\n"
            "- Skills: `skill://<name>` = 8sync skill; plain name = ECC skill: `skill://<name>` if it resolves, else read `<ECC>/skills/<name>/SKILL.md`.\n"
            "- Agents: spawn a `task` subagent whose prompt opens with the role file `<ECC>/agents/<agent>.md`.\n"
            "- Commands: read `<ECC>/commands/<cmd>.md` and follow it with that step's arguments.\n"
            "- A member that does not resolve: skip it, say so."),
}


def run_steps(h, vl, n):
    """The Execute (+ Learn on Claude Code) steps, numbered from `n`; returns (text, next n)."""
    if h == "omp":
        return (f"{n}. **Execute** step by step with `{vl}` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.\n"), n + 1
    return (f"{n}. **Execute** as ONE Workflow (this command opts in; load `workflow-authoring` first): `phase()` per plan stage, `pipeline()` by default, "
            "each agent prompt names only its picked member files, `effort: 'low'` on mechanical stages, every code stage ends with the project's real "
            f"build/type-check/lint/tests (`{vl}`). Stopped mid-run → re-run with `resumeFromRunId`. A goal of ≤2 small steps → do it inline, no Workflow.\n"
            f"{n + 1}. **Learn.** Last stage: one agent records only evidence-backed lessons (cause, fix, what was ruled out) via `/remember` or `trail note`; none → skip.\n"), n + 2


def ref(h, kind, name, src):
    if kind == "skills":
        if h == "cc":
            return "ecc:" + name if src == "ecc" else name
        return name if src == "ecc" else "skill://" + name
    if kind == "agents":
        return "ecc:" + name if h == "cc" else name
    return ("/ecc:" if h == "cc" else "") + name


def head(h, c, desc):
    lines = ["---"]
    if h == "omp":
        lines.append(f"name: eccx-{c}")
    lines += [f"description: \"{desc}\"", "argument-hint: \"<goal> [--dry-run]\""]
    if h == "cc":
        lines.append("disable-model-invocation: true")
    return "\n".join(lines) + "\n---\n\n"


def rows(h, m, kind, maxw):
    out, seen = [], set()
    for (name, src), purpose in sorted(m[kind].items()):
        if h == "omp" and src == "kit":
            continue  # Claude Code kit skills are not deployed to omp
        r = ref(h, kind, name, src)
        if r in seen:
            continue
        seen.add(r)
        out.append(f"- `{r}` — {clip(purpose, maxw)}" if purpose else f"- `{r}`")
    return out


def body(h, c, members, maxw):
    title, scope = CATS[c]
    vl = "ecc:verification-loop" if h == "cc" else "verification-loop"
    if c == "full":
        cmd = ("`~/.claude/commands/eccx-<cat>.md` (or the 8sync-kit plugin's `commands/`)" if h == "cc"
               else "`~/.omp/agent/commands/eccx-<cat>.md`")
        idx = []
        for k, (t, s) in CATS.items():
            if k == "full":
                continue
            n = [len(rows(h, members[k], kind, maxw)) for kind in ("skills", "agents", "commands")]
            idx.append(f"- `{k}` — {t}: {s} ({n[0]}/{n[1]}/{n[2]})")
        return (head(h, c, "Run a full cross-category plan for a goal using every relevant ECC + 8sync skill across the eccx categories")
                + "# /eccx-full — route a goal across every relevant category\n\n"
                "Goal: `$ARGUMENTS` (`--dry-run` = stop after the merged plan).\n\n"
                "1. **Route.** From the categories below pick EVERY one relevant to the goal (default to inclusion); one line of why per pick.\n"
                f"2. **Select.** For each pick open {cmd} and do its Select step on its member lists. Merge into one deduplicated set.\n"
                "3. **Plan.** One numbered plan (research → design → build → verify → ship/distribute); each step names its skills/agents/commands and its check. `--dry-run`: print it and stop.\n"
                + (f"4. **Execute** step by step. Read each skill just before its step, never all up front. Follow `{vl}`: run the project's real build/type-check/lint/tests after every code step; fix before moving on.\n"
                   "5. **Report** (short): categories used, members used/skipped, checks run + results, open risks.\n\n" if h == "omp" else
                   run_steps(h, vl, 4)[0] + "6. **Report** (short): categories used, members used/skipped, checks run + results, lessons kept, open risks.\n\n")
                + "## Categories (skills/agents/commands)\n" + "\n".join(idx) + "\n\n"
                "## How to call members\n" + HOW[h] + "\n")
    out = [head(h, c, f"Run a full {title} plan for a goal using every relevant ECC + 8sync skill in this category"),
           f"# /eccx-{c} — {title}\n\n",
           "Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).\n",
           f"Scope: {scope}.", (" " + NOTES[c]) if c in NOTES else "", "\n\n",
           "1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.\n",
           "2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.\n",
           "3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.\n",
           run_steps(h, vl, 4)[0],
           f"{run_steps(h, vl, 4)[1]}. **Report** (short): what changed, checks + results, members skipped, open risks.\n\n",
           "## How to call members\n", HOW[h], "\n"]
    for kind, label in (("skills", "Skills"), ("agents", "Agents"), ("commands", "Commands")):
        r = rows(h, members[c], kind, maxw)
        if r:
            out.append(f"\n## {label}\n" + "\n".join(r) + "\n")
    return "".join(out)


def generate():
    snap = json.load(open(SNAP, encoding="utf-8"))
    members = classify(snap)
    for h, d in OUT.items():
        os.makedirs(d, exist_ok=True)
        want = set()
        for c in CATS:
            for maxw in (12, 10, 8, 6):  # shrink purposes until the file fits the budget
                text = body(h, c, members, maxw)
                if len(text.encode("utf-8")) <= MAX_BYTES:
                    break
            else:
                sys.exit(f"eccx-gen: {h} eccx-{c} is {len(text.encode('utf-8'))} B even at 6-word purposes")
            p = os.path.join(d, f"eccx-{c}.md")
            want.add(os.path.basename(p))
            with open(p, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            print(f"{h:3} eccx-{c:12} {len(text.encode('utf-8')):6} B  purposes<={maxw}w")
        for f in listdir(d):  # a dropped category leaves no stale file behind
            if f.startswith("eccx-") and f.endswith(".md") and f not in want:
                os.remove(os.path.join(d, f))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    a = sys.argv[1:]
    if a[:1] == ["--refresh"]:
        if len(a) < 2:
            sys.exit(__doc__)
        cat = a[a.index("--catalog") + 1] if "--catalog" in a else None
        refresh(a[1], cat)
    elif a:
        sys.exit(__doc__)
    generate()


if __name__ == "__main__":
    main()
