---
description: "Run a full Content plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-content — Content

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: articles, docs, papers, CVs, investor and business writing.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ecc:article-writing` — Long-form content, guides, blog posts, and tutorials with voice consistency
- `assp-skill` — Brand DNA + ASSP validation framework for 8 Sync Dev
- `ecc:brand-voice` — Build a source-derived writing style profile from real posts, essays, launch notes
- `ecc:content-engine` — Multi-platform content systems for X, LinkedIn, TikTok, YouTube, and newsletters
- `ecc:crosspost` — Multi-platform distribution across X, LinkedIn, Threads, and Bluesky
- `ecc:docs-governance` — Route broad documentation-governance requests to existing ECC skills and run an opt-in
- `ecc:investor-materials` — Pitch decks, financial models, and investor-facing documents
- `ecc:investor-outreach` — Investor pipeline management, outreach sequences, and follow-ups
- `ecc:living-docs-governance` — Keep a long-lived project's documentation from rotting by assigning existing project docs
- `research-paper` — Work a paper, claim, or benchmark end to end
- `super-pdf` — Generate beautiful A4 PDFs from an HTML design system, in two modes
- `ecc:x-api` — X (Twitter) API integration patterns and automation
