---
name: eccx-swift
description: "Run a full Swift plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-swift — Swift

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: Swift, SwiftUI, Apple platforms.

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
- `ios-icon-gen` — Generate iOS app icons as PNG imagesets for Xcode asset catalogs
- `swift-actor-persistence` — Actor-based persistence patterns for Swift applications
- `swift-concurrency-6-2` — Swift 6.2 concurrency: actors, sendable, and structured concurrency
- `swift-protocol-di-testing` — Protocol-based dependency injection for testable Swift code
- `swiftui-patterns` — SwiftUI declarative UI patterns, navigation, and state management

## Agents
- `swift-build-resolver` — Swift/Xcode build, compilation, and dependency error resolution specialist
- `swift-reviewer` — Expert Swift code reviewer specializing in protocol-oriented design, value semantics, ARC memory
