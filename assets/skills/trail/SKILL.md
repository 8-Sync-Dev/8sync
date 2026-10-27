---
name: trail
description: Use this skill on EVERY question that touches code — "where is X defined", "who calls Y", "how does Z work", "what breaks if I change W", "outline this file", "map this repo". STEP 0 of the 8sync harness — ask the code map (`trail`, deterministic tree-sitter, no model call) BEFORE grep / find / Read.
---

# trail — code map for agents (STEP 0, before grep)

`trail` (npm `@trailhq/trail-code`) parses the repo with tree-sitter into a ranked symbol/call graph and answers structure questions in one call, with exact `file:line`. It never calls a model for these commands; telemetry is off (`8sync trail` does it).

## 1. Commands

| Need | Call |
|---|---|
| Understand / locate ("how does auth work", "where is X defined") | `trail ask "<question>"` (add `--source` to inline the code at each hit) |
| Regex search, hits grouped by enclosing symbol | `trail grep <pattern>` (`-i`, `--fixed`, `--in <path>`) |
| API surface of one file before editing it | `trail skeleton <file>` |
| Who calls X / blast radius | `trail callers <symbol>` (`--depth N\|all`) |
| What X calls | `trail callers <symbol> --direction out` |
| Orient in an unknown repo | `trail map` |
| Save a durable lesson (decision, dead end) | `trail note --title "<topic>" -m "<what/why>" --touches <file#Symbol>` |
| Check the branch diff against saved lessons | `trail check` |
| Health / stats | `trail status` |

Cite hits as `path:line` exactly as printed.

## 2. Rules

- Structure question → `trail ask|grep|skeleton|callers|map` first. `Read` a whole file only when you are about to EDIT it (read-before-edit).
- Use trail to **locate**, then read the narrow slice. Never `Read` a file over ~200 lines without `trail skeleton` first.
- Learned something the next session must know (why X, what failed)? `trail note` it. Notes live in `.trail/learnings/` and are shared through git.
- Plain-text lookup on non-code (logs, configs, build output) → single-file `grep` is fine.

## 3. Setup and refresh

- One-time per repo: `8sync trail` (installs trail if missing with `npm i -g @trailhq/trail-code --ignore-scripts`, turns telemetry off, runs `trail init` for Claude Code only — no global hooks, no statusline). Every repo under a folder: `8sync trail --all <ROOT> [--dry-run]`.
- The graph is a regenerable cache (`.trail/cache/`, git-ignored). Stale or empty answers → `trail build` (`--check` only reports drift). `trail ask/grep/callers` also refresh on demand unless `--no-refresh`.
- `.trail/` (hook shim, learnings) and `.claude/settings.json` are meant to be committed; `.trail/cache/` and `.trail/statusline.cjs` are not.
- `8sync trail status` shows whether trail is installed and which repo is wired; `8sync trail off` removes the repo wiring (`trail uninstall`).
