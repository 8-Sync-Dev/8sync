---
description: "Run a full cross-category plan for a goal using every relevant ECC + 8sync skill across the eccx categories"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-full — route a goal across every relevant category

Goal: `$ARGUMENTS` (`--dry-run` = stop after the merged plan).

1. **Route.** From the categories below pick EVERY one relevant to the goal (default to inclusion); one line of why per pick.
2. **Select.** For each pick open `~/.claude/commands/eccx-<cat>.md` (or the 8sync-kit plugin's `commands/`) and do its Select step on its member lists. Merge into one deduplicated set.
3. **Plan.** One numbered plan (research → design → build → verify → ship/distribute); each step names its skills/agents/commands and its check. `--dry-run`: print it and stop.
4. **Execute** as ONE Workflow (this command opts in; load `workflow-authoring` first): `phase()` per plan stage, `pipeline()` by default, each agent prompt names only its picked member files, `effort: 'low'` on mechanical stages, every code stage ends with the project's real build/type-check/lint/tests (`ecc:verification-loop`). Stopped mid-run → re-run with `resumeFromRunId`. A goal of ≤2 small steps → do it inline, no Workflow.
5. **Learn.** Last stage: one agent records only evidence-backed lessons (cause, fix, what was ruled out) via `/remember` or `trail note`; none → skip.
6. **Report** (short): categories used, members used/skipped, checks run + results, lessons kept, open risks.

## Categories (skills/agents/commands)
- `core` — Core: harness basics: standards, learning, compaction, always-on rules (16/0/3)
- `workflow` — Workflow: plan, build, test, review, refactor, ship — the engineering loop (64/18/41)
- `ai-agent` — AI Agent: agent harnesses, loops, evals, prompts, context and token economy (50/8/26)
- `security` — Security: security review, scanning, hardening, compliance, crypto (23/2/2)
- `research` — Research: deep research, papers, literature, replication, remote compute (20/1/0)
- `frontend` — Frontend: UI, design systems, React/Vue/Next, a11y, motion, web quality (37/7/8)
- `backend` — Backend: APIs, databases, infra, deploy, Node/.NET/PHP, Encore/Eino, Rust (49/11/3)
- `python` — Python: Python, Django, FastAPI, PyTorch, ML engineering (12/6/2)
- `golang` — Go: Go patterns, testing, build and review (4/2/3)
- `jvm` — JVM: Java, Kotlin, Spring, Quarkus, Android/Compose (17/4/4)
- `swift` — Swift: Swift, SwiftUI, Apple platforms (5/2/0)
- `cpp` — C++: C++, CUDA kernels, x86/SIMD performance (2/2/3)
- `perl` — Perl: Perl patterns, security, testing (2/0/0)
- `industry` — Industry: supply chain, logistics, energy, healthcare, documents (16/1/0)
- `content` — Content: articles, docs, papers, CVs, investor and business writing (12/0/0)
- `specialized` — Specialized: operator tools, media, desks, homelab, niche domains (40/5/1)
- `ads` — Ads & Marketing: campaigns, ads, social, SEO, brand, content distribution, lead gen (32/2/1)
- `game` — Game & 3D: three.js, R3F, GSAP/3D web, Unreal/Blender, game assets (3/0/0)

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.
