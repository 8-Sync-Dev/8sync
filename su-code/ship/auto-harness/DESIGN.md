# DESIGN — five graded auto commands for ccc (official Claude Code)

Source of truth for the implementation. Everything runs inside official Claude Code through skills, hooks, agents and `8sync` verbs. No `bypassPermissions`, no proxy, no re-implemented agent loop.

## Level table

| Level | Command | Scope | Plan | Checks | Loop | Checkpoints (owner) | Stop |
|---|---|---|---|---|---|---|---|
| 1 | `/do <việc>` | one small change | none (read what it touches) | lint + the test module it touches | no | none | one pass; reports what it did |
| 2 | `/ship <việc>` | one feature/bug | /planning | build/test/lint on CI, UAT, reviewer, /sec (+/rules, /aup-audit when triggered) | no | Ship question only with `--release` | commit; release gated |
| 3 | `/ship-auto <việc>` | one feature/bug, through release | /planning | same as /ship | no | ONE `Ship` AskUserQuestion (grant) | PR → CI → merge → tag → release → install → monitor |
| 4 | `/ship-loop <mục tiêu>` | a goal with acceptance criteria | /planning writes criteria as checks | each iteration: implement → run checks → fix | yes: iterate until every criterion passes | ONE `Ship` question at the end (if `--release`) | criteria all green, iteration cap (default 12), wall clock cap (default 90 min), stuck digest ×2, owner "dừng" |
| 5 | `/autopilot [backlog]` | many items, unattended | per item via /ship-loop | per item | yes: item after item | ONE `Ship` question per batch (end of day or N green PRs) | backlog empty, caps (items/day, hours), owner stop; survives /compact via `su-code/ship/ACTIVE` |

Common rails at every level: guard deny rules (destructive, secrets, force-push), watchdog pressure → no new parallel agents, heavy builds on CI, StopFailure record + resume note, task-list stop gate, `/sec` on every diff before commit, `/rules` + `/aup-audit` when the diff touches auth/OAuth/data collection/messaging/third-party tools.

## Stop conditions (level 4/5) — stronger than omp's goal loop
- **Done only with evidence**: a criterion is "pass" only after its check command ran and exited 0 in this iteration (recorded in `su-code/ship/<slug>/LOOP.md`: iteration, command, exit, 1-line output). No self-declared done.
- **Stuck**: the same (tool name + first 80 chars of input) digest for two consecutive iterations, or no file changed in an iteration → stop with a brief.
- **Caps**: `--max-iter N` (12), `--max-min M` (90), per-item for autopilot `--max-items K` (5/day). Claude Code's Stop-hook continuation cap is 8 per chain, so an iteration never relies on more than one Stop block; the loop re-enters through the skill, not the hook.
- **Owner stop**: "dừng"/"stop" in a message ends the loop at once (gate already honours it).

## Mechanism (Claude Code features only)
- Skills with `disable-model-invocation: true` for levels 3–5 (only the owner starts them).
- Loop state in files (`LOOP.md`, `STATE.md`) so /compact and resume keep the thread (session-start digest already puts `ACTIVE` first).
- Iteration driver: the internal loop in the skill body plus a TaskCreate rail (one task "Loop <slug>" kept in_progress so the kit stop gate holds the loop). **Claude Code's built-in `/goal`** is an optional owner-run reinforcement (official: a session-scoped Stop hook with a small-model evaluator checks the condition after every turn; works in `claude -p "/goal …"`; condition ≤ 4,000 chars; the evaluator cannot run tools, so the condition must be provable from transcript output). `/ship-loop` composes the goal condition from the acceptance criteria + "every check command ran this iteration and exited 0" + the caps clause, and keeps `LOOP.md` as the evidence ledger. The kit's native stop gate (task list) stays as a second rail. Anthropic's `ralph-wiggum` plugin is the fallback pattern, not the primary (its max_iterations defaults to unlimited and its hook has no session check).
- `8sync ccc loop init|tick|status|done|ls` (Rust, tiny) holds caps and the content-hash digest so stuck detection costs microseconds; the Stop-hook continuation cap (8, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) is left at default.
- Headless runs (`/autopilot` via `claude -p`): always pass `--permission-mode auto`, `--max-turns`, and `--max-budget-usd` (client-side estimate, can overshoot); auto mode pauses after 3 consecutive / 20 total classifier blocks, and in `-p` a blocked action is skipped, not fatal — so each item ends with a verification pass before the Ship question.
- Model routing like plan-yolo: plan on the session model (Opus), implementation through `task` (Sonnet) / `quick-task` (Haiku) subagents when files are disjoint.
- Autopilot picks items from: open GitHub issues with acceptance criteria (label `ccc`/`8sync`), `su-code/STATE.md` Next, `failure:` lines without a guard; never from another session's lane (`8sync ccc . ls`, ListAgents).

## Explicitly not copied from omp
- yolo passing destructive bash; secrets redaction off; no iteration/wall-clock cap.

## Assumptions (auto mode, 2026-10-13)
- Defaults: max-iter 12, max-min 90, autopilot 5 items/day.
- `/do` never commits; `/ship` commits; 3–5 push/PR/merge only through the Ship grant.
