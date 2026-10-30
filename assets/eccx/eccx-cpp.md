---
name: eccx-cpp
description: "Run a full C++ plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-cpp — C++

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: C++, CUDA kernels, x86/SIMD performance.

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
- `cpp-coding-standards` — C++ Core Guidelines: modern, safe, and idiomatic practices
- `cpp-testing` — GoogleTest, CTest, coverage, and sanitizer configuration

## Agents
- `cpp-build-resolver` — C++ build, CMake, and compilation error resolution specialist
- `cpp-reviewer` — Expert C++ code reviewer specializing in memory safety, modern C++ idioms, concurrency

## Commands
- `cpp-build` — Fix C++ build errors, CMake issues, and linker problems incrementally
- `cpp-review` — Comprehensive C++ code review for memory safety, modern C++
- `cpp-test` — Enforce TDD workflow for C++. Write GoogleTest tests first, then implement
