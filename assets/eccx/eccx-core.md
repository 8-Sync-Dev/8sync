---
name: eccx-core
description: "Run a full Core plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-core — Core

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: harness basics: standards, learning, compaction, always-on rules.

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
- `skill://8sync-cli` — .md or CLAUDE.md mentions 8sync, or a su-code/ folder exists)
- `coding-standards` — Universal coding standards and best practices for TypeScript, JavaScript, React, and Node.js
- `configure-ecc` — Interactive installer for selecting and installing skills and rules
- `continuous-learning` — Extract reusable patterns from sessions and save as learned skills
- `continuous-learning-v2` — Instinct-based learning with confidence scoring and project-scoped instincts
- `ecc-guide` — Answer questions about ECC by reading the live repo surface
- `ecc-recipes` — Map a described workflow to the right ECC command group with run-order
- `skill://image-routing` — To decide between text and image representation
- `skill://karpathy-guidelines` — . It enforces Andrej Karpathy-style engineering discipline
- `skill://ponytail` — Forces the laziest solution that actually works, simplest, shortest, most minimal
- `strategic-compact` — Manual context compaction at logical intervals to preserve context across task phases
- `skill://taste-output` — Overrides default LLM truncation behavior
- `skill://trail` — "where is X defined", "who calls Y", "how does Z work", "what

## Commands
- `auto-update` — Pull the latest ECC repo changes and reinstall the current managed targets
- `ecc-guide` — Navigate ECC's current agents, skills, commands, hooks, install profiles, and docs
- `project-init` — Detect a project's stack and produce a dry-run ECC onboarding plan using
