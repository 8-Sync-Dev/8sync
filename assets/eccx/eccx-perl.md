---
name: eccx-perl
description: "Run a full Perl plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-perl — Perl

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: Perl patterns, security, testing.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `<ECC>` = 8sync's ECC checkout `~/.cache/8sync/ecc/` (tracks upstream: `8sync harness` + a 6-hourly background refresh), else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.
- Skills: `skill://<name>` loads any skill: `skill://` refs are 8sync's, plain names ECC's (8sync mirrors ECC into omp). Not found → read `<ECC>/skills/<name>/SKILL.md`.
- Agents: a `task` subagent whose assignment opens with "read the role file `<ECC>/agents/<agent>.md` first"; independent agents/steps → ONE `task` call with several `tasks[]` (parallel).
- Commands: run `/ecc-<cmd>` with that step's arguments; not found → read `<ECC>/commands/<cmd>.md` and follow it.
- A member that does not resolve: skip it, say so.
- A skill in your session's skill list that fits the goal but is missing below (ECC updated since this list) is eligible too.

## Skills
- `perl-patterns` — Modern Perl patterns, Moose, and best practices
- `perl-testing` — Perl testing with Test2, TAP, and coverage tools
