---
description: "Clear running time-loops (/eccx-loop-<cat>, /ship-loop): stop the tick cron, close loop state, keep evidence — no review, no ship"
argument-hint: "<slug>|all [--reason <why>]"
disable-model-invocation: true
---

# /eccx-clear — clear a running time-loop

`$ARGUMENTS` — a loop `<slug>`, or `all`. Owner-only, Level 4 like `/ship-loop`. Clears ONLY: no review, no ship, no new work. `su-code/ship/<slug>/` (PLAN.md, LOOP.md) stays as evidence.

1. **Pick.** No slug → read `su-code/ship/ACTIVE` + `8sync ccc loop ls`. None → say so, done. Several → list one line each `slug · iter/max · min/max` (`8sync ccc loop status <slug>`) and ask ONE question. `all` → steps 2–4 for every ACTIVE slug.
2. **Stop the waker.** `CronList` → `CronDelete` every `/ship-tick <slug>` job; `/goal clear` if that slug's goal is still set.
3. **Close state.** `8sync ccc loop status <slug>` → brief ≤10 lines into `su-code/ship/<slug>/LOOP.md` (why cleared, criteria green/red + last evidence, iters/minutes used, open items if the owner resumes later) → `8sync ccc loop done <slug> --reason "<why>"` → remove the `<slug>` line from `su-code/ship/ACTIVE`. Never delete `su-code/ship/<slug>/`; never touch git.
4. **Report** ≤6 lines: each cleared loop (slug · iters used · green/red · cron deleted · `done` exit 0) + what is still in ACTIVE.

Rails: only loops listed in ACTIVE; no `8sync ccc cancel` unless the owner typed it; every "deleted/done" claim shows its command output.
