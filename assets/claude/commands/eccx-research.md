---
description: "Run a full Research plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-research — Research

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: deep research, papers, literature, replication, remote compute.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** as ONE Workflow (this command opts in; load `workflow-authoring` first): `phase()` per plan stage, `pipeline()` by default, each agent prompt names only its picked member files, `effort: 'low'` on mechanical stages, every code stage ends with the project's real build/type-check/lint/tests (`ecc:verification-loop`). Stopped mid-run → re-run with `resumeFromRunId`. A goal of ≤2 small steps → do it inline, no Workflow.
5. **Learn.** Last stage: one agent records only evidence-backed lessons (cause, fix, what was ruled out) via `/remember` or `trail note`; none → skip.
6. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `autoresearch` — Owner-started, bounded experiment loop against a measurable target
- `ecc:benchmark-methodology` — Score a scoped competitor set into comparable profile cards: nine weighted dimensions
- `ecc:competitive-platform-analysis` — Identifying, categorising, and score-filtering a competitor set before any benchmarking begins
- `ecc:competitive-report-structure` — Assemble scored competitor profile cards (from benchmark-methodology) into a decision-grade competitive report
- `ecc:data-scraper-agent` — Build a fully automated AI-powered data collection agent for any public source
- `ecc:deep-research` — Multi-source research using firecrawl and exa MCPs with cited reports
- `deep-research-web` — Web research without extra MCPs (no firecrawl/exa needed)
- `ecc:documentation-lookup` — Use up-to-date library and framework docs via Context7 MCP instead of training
- `ecc:exa-search` — Exa neural search integration for semantic web retrieval
- `ecc:iterative-retrieval` — Multi-round retrieval patterns for building comprehensive context
- `last30days` — "research <topic> recently", "what's trending on Reddit/X/YouTube about Y", pre-meeting/pre-call briefings, "last
- `ecc:market-research` — Market analysis, competitive intelligence, and industry research
- `ecc:osint-investigation` — Sparse-clue OSINT investigation methodology for extracting overlooked leads, connecting fragmented
- `remote-compute` — Run research, replication, or benchmark code somewhere other than the bare host
- `ecc:research-ops` — Evidence-first current-state research workflow for ECC. Use when the user wants fresh
- `research-paper` — Work a paper, claim, or benchmark end to end
- `ecc:scientific-pkg-gget` — Gget CLI and Python workflow for quick genomic database queries, sequence lookup
- `ecc:scientific-thinking-literature-review` — Systematic literature-review workflow for academic, biomedical, technical, and scientific topics, including search
- `ecc:scientific-thinking-scholar-evaluation` — Structured scholarly-work evaluation for papers, proposals, literature reviews, methods sections, evidence quality
- `ecc:search-first` — Search-first patterns for grounding responses in retrieved context

## Agents
- `ecc:docs-lookup` — When the user asks how to use a library, framework, or API
