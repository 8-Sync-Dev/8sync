---
name: eccx-content
description: "Run a full Content plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-content — Content

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: articles, docs, papers, CVs, investor and business writing.

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
- `article-writing` — Long-form content, guides, blog posts, and tutorials with voice consistency
- `skill://assp-skill` — Brand DNA + ASSP validation framework for 8 Sync Dev
- `brand-voice` — Build a source-derived writing style profile from real posts, essays, launch notes
- `content-engine` — Multi-platform content systems for X, LinkedIn, TikTok, YouTube, and newsletters
- `crosspost` — Multi-platform distribution across X, LinkedIn, Threads, and Bluesky
- `docs-governance` — Route broad documentation-governance requests to existing ECC skills and run an opt-in
- `investor-materials` — Pitch decks, financial models, and investor-facing documents
- `investor-outreach` — Investor pipeline management, outreach sequences, and follow-ups
- `living-docs-governance` — Keep a long-lived project's documentation from rotting by assigning existing project docs
- `skill://research-paper` — Work a paper, claim, or benchmark end to end
- `skill://super-pdf` — Generate beautiful A4 PDFs from an HTML design system, in two modes
- `x-api` — X (Twitter) API integration patterns and automation
