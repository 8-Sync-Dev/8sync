---
description: "Loop /eccx-frontend on a goal until every acceptance criterion passes: criteria with check commands, evidence, learn each iteration, iteration/time/stuck caps"
argument-hint: "<goal> [--max-iter 8] [--max-min 90] [--release] [--dry-run]"
disable-model-invocation: true
---

# /eccx-loop-frontend — Frontend, looped until green

Goal: `$ARGUMENTS`. Level 4 like `/ship-loop`: owner-only; "dừng"/"stop" ends it at once. Defaults `--max-iter 8`, `--max-min 90`.

1. **Members.** Open `~/.claude/commands/eccx-frontend.md` (or the 8sync-kit plugin's `commands/`) and do its Select step for this goal.
2. **Criteria.** Write `su-code/ship/<slug>/PLAN.md`: acceptance criteria, each with ONE check command (exit 0 = pass; light and local, or a CI workflow name for heavy builds), plus three lines the ticks read: `Driver: /eccx-frontend`, `Members: <picks>`, `Release: yes|no` (yes only with `--release`). No criterion can get a command → say so and stop; never loop on taste. `--dry-run`: print PLAN and stop.
3. **Open the loop** exactly as `/ship-loop` A.2–A.4: `LOOP.md`, `<slug>` in `su-code/ship/ACTIVE`, `8sync ccc . goal`, `8sync ccc loop init <slug> --max-iter <N> --max-min <M>`, then `CronCreate` `*/5 * * * *` recurring `/ship-tick <slug>` so the loop survives turn ends, /compact and CI waits.
4. **Iterate** (this turn, then every `/ship-tick`), one red item per iteration:
   - **Pick:** red CI on the branch, else the first criterion without green evidence.
   - **Execute** with the `Members:` picks, as the Execute step of `eccx-frontend.md` scoped to that one criterion: a Workflow for >2 steps (same criterion carried over → `resumeFromRunId`), inline otherwise.
   - **Eval:** every criterion via `8sync ccc loop ev <slug> <C#> -- '<cmd>'`; no evidence line = not passed.
   - **Learn:** cause of a red check found → one dated line in `su-code/ship/<slug>/research.md`; an evidence-backed lesson → `trail note` or `/remember` (≤1 per iteration, none is fine).
   - **Tick:** all green → step 5, no tick. Else `8sync ccc loop tick --changed <n> --digest "<diff sha256 16 chars + last line of the first red check>"`; `continue` → next iteration; `stop:<reason>` or anything else → step 5.
   - **Stuck** (same digest twice, or the same check red after a fix): research before retrying (`/ship-tick` §3), then re-Select: add skipped members that fit the failure, `ecc:agent-introspection-debugging` when the loop itself misbehaves; record the change in `Members:`.
5. **Close** as `/ship-loop` D: all green → review + `8sync ccc risk` + skills `sec`, `rules`, `aup-audit` on the diff → CHANGELOG + commit on the feature branch; `Release: yes` → ONE `Ship` question, CI green on Windows, macOS and Linux before merge/tag. Stop or cap → brief ≤10 lines in LOOP.md, `8sync ccc loop done`, drop the `ACTIVE` line, `CronDelete` the `/ship-tick <slug>` job. Report: criteria + evidence, iterations/minutes used, lessons kept, open items.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.
