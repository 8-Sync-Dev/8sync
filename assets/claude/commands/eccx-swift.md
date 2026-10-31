---
description: "Run a full Swift plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-swift — Swift

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: Swift, SwiftUI, Apple platforms.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ecc:ios-icon-gen` — Generate iOS app icons as PNG imagesets for Xcode asset catalogs
- `ecc:swift-actor-persistence` — Actor-based persistence patterns for Swift applications
- `ecc:swift-concurrency-6-2` — Swift 6.2 concurrency: actors, sendable, and structured concurrency
- `ecc:swift-protocol-di-testing` — Protocol-based dependency injection for testable Swift code
- `ecc:swiftui-patterns` — SwiftUI declarative UI patterns, navigation, and state management

## Agents
- `ecc:swift-build-resolver` — Swift/Xcode build, compilation, and dependency error resolution specialist
- `ecc:swift-reviewer` — Expert Swift code reviewer specializing in protocol-oriented design, value semantics, ARC memory
