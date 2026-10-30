---
name: eccx-research
description: "Run a full Research plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-research — Research

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: deep research, papers, literature, replication, remote compute.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `<ECC>` = 8sync's pinned ECC checkout `~/.cache/8sync/ecc/` (made by `8sync harness`), else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.
- Skills: `skill://<name>` = 8sync skill; plain name = ECC skill: `skill://<name>` if it resolves, else read `<ECC>/skills/<name>/SKILL.md`.
- Agents: spawn a `task` subagent whose prompt opens with the role file `<ECC>/agents/<agent>.md`.
- Commands: read `<ECC>/commands/<cmd>.md` and follow it with that step's arguments.
- A member that does not resolve: skip it, say so.

## Skills
- `skill://autoresearch` — Owner-started, bounded experiment loop against a measurable target
- `benchmark-methodology` — Score a scoped competitor set into comparable profile cards: nine weighted dimensions
- `competitive-platform-analysis` — Identifying, categorising, and score-filtering a competitor set before any benchmarking begins
- `competitive-report-structure` — Assemble scored competitor profile cards (from benchmark-methodology) into a decision-grade competitive report
- `data-scraper-agent` — Build a fully automated AI-powered data collection agent for any public source
- `deep-research` — Multi-source research using firecrawl and exa MCPs with cited reports
- `skill://deep-research-web` — Web research without extra MCPs (no firecrawl/exa needed)
- `documentation-lookup` — Use up-to-date library and framework docs via Context7 MCP instead of training
- `exa-search` — Exa neural search integration for semantic web retrieval
- `iterative-retrieval` — Multi-round retrieval patterns for building comprehensive context
- `skill://last30days` — "research <topic> recently", "what's trending on Reddit/X/YouTube about Y", pre-meeting/pre-call briefings, "last
- `market-research` — Market analysis, competitive intelligence, and industry research
- `osint-investigation` — Sparse-clue OSINT investigation methodology for extracting overlooked leads, connecting fragmented
- `skill://remote-compute` — Run research, replication, or benchmark code somewhere other than the bare host
- `research-ops` — Evidence-first current-state research workflow for ECC. Use when the user wants fresh
- `skill://research-paper` — Work a paper, claim, or benchmark end to end
- `scientific-pkg-gget` — Gget CLI and Python workflow for quick genomic database queries, sequence lookup
- `scientific-thinking-literature-review` — Systematic literature-review workflow for academic, biomedical, technical, and scientific topics, including search
- `scientific-thinking-scholar-evaluation` — Structured scholarly-work evaluation for papers, proposals, literature reviews, methods sections, evidence quality
- `search-first` — Search-first patterns for grounding responses in retrieved context

## Agents
- `docs-lookup` — When the user asks how to use a library, framework, or API
