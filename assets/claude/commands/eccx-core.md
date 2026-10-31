---
description: "Run a full Core plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-core — Core

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: harness basics: standards, learning, compaction, always-on rules.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `8sync-cli` — .md or CLAUDE.md mentions 8sync, or a su-code/ folder exists)
- `ecc:coding-standards` — Universal coding standards and best practices for TypeScript, JavaScript, React, and Node.js
- `ecc:configure-ecc` — Interactive installer for selecting and installing skills and rules
- `consolidate` — Dọn memory của repo
- `ecc:continuous-learning` — Extract reusable patterns from sessions and save as learned skills
- `ecc:continuous-learning-v2` — Instinct-based learning with confidence scoring and project-scoped instincts
- `ecc:ecc-guide` — Answer questions about ECC by reading the live repo surface
- `ecc:ecc-recipes` — Map a described workflow to the right ECC command group with run-order
- `image-routing` — To decide between text and image representation
- `karpathy-guidelines` — . It enforces Andrej Karpathy-style engineering discipline
- `ponytail` — Forces the laziest solution that actually works, simplest, shortest, most minimal
- `remember` — Ghi MỘT bài học có bằng chứng vào memory của repo (su-code/KNOWLEDGE.md)
- `rules` — Luật Anthropic + quy tắc 8 Sync
- `ecc:strategic-compact` — Manual context compaction at logical intervals to preserve context across task phases
- `taste-output` — Overrides default LLM truncation behavior
- `trail` — "where is X defined", "who calls Y", "how does Z work", "what

## Commands
- `/ecc:auto-update` — Pull the latest ECC repo changes and reinstall the current managed targets
- `/ecc:ecc-guide` — Navigate ECC's current agents, skills, commands, hooks, install profiles, and docs
- `/ecc:project-init` — Detect a project's stack and produce a dry-run ECC onboarding plan using
