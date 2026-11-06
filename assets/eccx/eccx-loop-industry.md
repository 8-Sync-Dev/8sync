---
name: eccx-loop-industry
description: "Loop /eccx-industry on a goal until every acceptance criterion passes: criteria with check commands, engine verify gates, evidence, iteration/time/stuck caps; auto-merge + auto-release when green"
argument-hint: "<goal> [--max-iter 8] [--max-min 90] [--no-release] [--dry-run]"
---

# /eccx-loop-industry — Industry, looped until green

Goal: `$ARGUMENTS`. Owner-only; "dừng"/"stop" ends it at once. Defaults `--max-iter 8` (omp auto-continues a session at most 8 times in a row, so never more), `--max-min 90`.

1. **Members.** Open `~/.omp/agent/commands/eccx-industry.md` and do its Select step for this goal.
2. **Criteria.** Write `su-code/ship/<slug>/PLAN.md`: acceptance criteria, each with ONE check command (exit 0 = pass; light and local, or a CI workflow name for heavy builds), plus `Driver: /eccx-industry`, `Members: <picks>`, `Release: yes|no` (yes unless `--no-release`). No criterion can get a command → say so and stop; never loop on taste. `--dry-run`: print PLAN and stop.
3. **Open the loop.** `<slug>` line in `su-code/ship/ACTIVE`; `8sync ccc loop init <slug> --max-iter <N> --max-min <M>`; then `engine_plan` FIRST (it arms the run-to-done continuation): goal = the goal, one slice per criterion, each task's `verify` = that criterion's check command, `maxRetries` 2. Mirror the criteria into `todo`.
4. **Iterate**, one red item per iteration, without yielding between them:
   - **Pick:** red CI on the branch first, else `engine_next`.
   - **Execute** with the `Members:` picks, as the Execute step of `eccx-industry.md` scoped to that one task; independent steps → one `task` call with several `tasks[]`.
   - **Eval:** `engine_verify` on the task, then `8sync ccc loop ev <slug> <C#> -- '<cmd>'` for the evidence line; green → `engine_advance` (`commit: true` only on a feature branch). No evidence line = not passed.
   - **Learn:** cause of a red check found → one dated line in `su-code/ship/<slug>/research.md`; an evidence-backed lesson → `trail note` (≤1 per iteration, none is fine).
   - **Tick:** all green → step 5, no tick. Else `8sync ccc loop tick --changed <n> --digest "<diff sha256 16 chars + last line of the first red check>"`; `continue` → next iteration; `stop:<reason>` or anything else → step 5.
   - **Stuck** (same digest twice, or a task BLOCKED by `engine_verify`): research the failure before retrying, then re-Select: add skipped members that fit it, `/ecc-agent-introspection-debugging` when the loop itself misbehaves; record the change in `Members:`.
5. **Close.** All green → review the diff (`security-review`, `skill://aup-audit`) → CHANGELOG + commit on the feature branch → PR, CI green on Windows, macOS and Linux, squash-merge, then the repo's own release path (`Release: no` stops at merge; never on red CI), remove worktree + branch. Only irreversible, prod-data, billing, security-policy or prod-deploy choices go to the owner (ONE `ask`). Stop or cap → brief ≤10 lines in LOOP.md, `8sync ccc loop done <slug>`, drop the `ACTIVE` line. Report: criteria + evidence, iterations/minutes used, lessons kept, open items. 8 continuations used with work left → say so; the owner resumes with `/eccx-loop-industry <slug>` (re-read PLAN/LOOP, skip step 2).

## How to call members
- `<ECC>` = 8sync's ECC checkout `~/.cache/8sync/ecc/` (tracks upstream: `8sync harness` + a 6-hourly background refresh), else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.
- Skills: `skill://<name>` loads any skill: `skill://` refs are 8sync's, plain names ECC's (8sync mirrors ECC into omp). Not found → read `<ECC>/skills/<name>/SKILL.md`.
- Agents: a `task` subagent whose assignment opens with "read the role file `<ECC>/agents/<agent>.md` first"; independent agents/steps → ONE `task` call with several `tasks[]` (parallel).
- Commands: run `/ecc-<cmd>` with that step's arguments; not found → read `<ECC>/commands/<cmd>.md` and follow it.
- A member that does not resolve: skip it, say so.
- A skill in your session's skill list that fits the goal but is missing below (ECC updated since this list) is eligible too.
