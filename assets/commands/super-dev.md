---
name: sx-super-dev
argument-hint: '<goal> | resume | status | ship'
description: Full product lifecycle in one command — research (feynman/web) → plan → parallel build → adversarial review → deep UAT with real capture → release → CI/CD + published-artifact verification. Use for anything shippable; small single-concern edits belong in /sx-auto.
---

# /sx-super-dev — research → build → prove → ship

`$ARGUMENTS`: `<goal>` = start · `resume` = continue saved plan · `status` = report · `ship` = jump to Phase 5 for already-green work.

You own the whole lifecycle. `/sx-auto` runs a plan; this runs a **product**. Obey `~/.omp/agent/APPEND_SYSTEM.md` (code-intel first, always-on skills).

**The rule that governs every phase: your own "done" is not evidence.** A phase ends when something *outside your judgement* agrees — a test, a gate, a fresh reviewer, a published artifact you re-downloaded. Never yield between phases.

---

## Phase 0 — Ground (cheap, always)

1. Read `su-code/STATE.md` and the `failure:` entries in `su-code/KNOWLEDGE.md`. Those are traps already paid for; re-paying is the most expensive mistake available.
2. Map the code with **trail** (`trail map` / `trail ask`) — never `grep`-and-read-everything.
3. `git log --oneline -15` + `su-code/DECISIONS.md` for intent behind current shape.
4. `read su-code/PROJECT.md` for stack, entrypoints and the REAL build/test/lint commands. Those exact commands become the verify gate; do not invent your own.

## Phase 1 — Research (never skip on anything unfamiliar)

Unknowns get resolved before the plan, not during the build.
- Codebase unknowns → code-intel (Phase 0 tools).
- Domain / library / API unknowns → **feynman** skills (`deep-research`, `research-paper`) + `web_search`; `last30days` when recency matters (a 2023 answer about a 2026 API is a liability).
- Read the actual source of a dependency before assuming its behaviour. `librarian` subagent for anything non-trivial.

Write conclusions into `su-code/STATE.md` under `## Assumptions`, each with its source. An assumption with no source is a guess wearing a costume.

**Gate:** every unknown is either answered or explicitly listed as an accepted risk. Then continue.

## Phase 2 — Plan (own this yourself)

Decompose the goal into slices with real acceptance criteria. **Never delegate the top-level decomposition** — a planning subagent starts blank and knows less than you do.

- Large / multi-phase → drive the `feature` skill (`su-code/planning/<slug>/`).
- Otherwise → `engine_plan` with slices, atomic tasks, and each task's `verify` set to the project's real lint/test/build.
- Decide cross-slice contracts NOW (interfaces, schemas, file ownership) and write them down. Contracts settled late become merge conflicts.
- Smallest-first. Each task must be independently verifiable.

## Phase 3 — Build (parallel where the work is genuinely parallel)

- Independent slices → one `task` batch, fanned out. State the shared contract in the batch `context`; tell every agent to SKIP build/test/lint (concurrent cargo/npm runs deadlock on the target lock) and that you run the gate once at the end.
- Dependent work → `engine_next` → implement → `engine_verify` → `engine_advance`.
- Prefer targeted edits over whole-file rewrites.
- Two identical verify failures = warning, three = BLOCKED. On block: write a `failure:` line to `su-code/KNOWLEDGE.md`, then change approach — never retry the same fix a third time.
- Fix causes. Suppressing a warning, widening a type, or special-casing an input is not a fix.

## Phase 4 — Prove it (the phase everyone cuts, and the reason releases break)

Four independent checks. All four, in order, and **repeat 4.1–4.3 until two consecutive rounds are clean** — the first clean round is usually luck.

**4.1 Full suite.** The whole thing, not the tests you touched. Then ask what the change could break that has no test, and add exactly those.

**4.2 Adversarial review — parallel, independent, fresh context.** Launch together:
- `reviewer` on the full `git diff <base>..HEAD` against the goal and the acceptance criteria;
- `security-reviewer` on anything touching auth, input parsing, subprocess/argv, file writes, network, credentials, CI, or generated config.

Give them the DoD, the constraints, and what is already known-open so they hunt for what you missed. **Reviewers routinely find release-breaking defects the author cannot see** — treat a clean review as suspicious and a P0 as normal. Fix findings at the source, then re-review the fix.

**4.3 UAT — be the user, not the author.** Role-play a real person doing the real task, on the real artifact. Author-testing follows the happy path by muscle memory; a user does not.
- Web/UI → drive it in the **browser** tool: click, type, submit, navigate. Screenshot each meaningful state and *look* at it. Desktop app → launch with its remote-debug port and point the same tool at it.
- CLI → run it from a **clean environment** (fresh `HOME`/config/cache, empty PATH prefix), never your warm dev shell.
- Adversarial passes: empty input, huge input, wrong types, no network, no permissions, cancel mid-way, run it twice (idempotence), run two at once.
- Capture evidence as you go — screenshots, exact command + exact output. "I tested it" is not a result; a pasted transcript is.

**4.4 Hygiene.** `8sync harness audit`; update `CHANGELOG.md`, `su-code/STATE.md`, and `su-code/KNOWLEDGE.md` (`validated:` / `failure:`). Distil any multi-step procedure that worked into `su-code/PLAYBOOKS.md` with a `When:` index. Delete scaffolding, dead code, and superseded docs — a fix that leaves its scaffolding behind is half a fix.

## Phase 5 — Ship

1. **Version and tag must agree.** Bump the manifest in the same commit that cuts the CHANGELOG section. A binary reporting the old version under a new tag tells every up-to-date user "update available" forever and re-downloads on every check. Assert it in CI, not in your head.
2. Full gate one final time: build · full suite · typecheck · lint · size/perf budget.
3. Secret scan before the commit exists, not after.
4. Commit explaining **why**, with the evidence. Do not `push`, tag, or open a PR unless the user asked — if they did, say what you are about to publish first.

## Phase 6 — CI/CD and the published artifact

Local green proves nothing about what users receive.

1. Watch the pipeline to completion. `--exit-status` on a watch command can report the *watcher's* status — re-read the run's real conclusion.
2. On failure, read the failing job's log and fix the **cause**. A platform-specific failure is usually a real portability bug (line endings, path separators, missing tool), not "flaky CI".
3. **Verify the published artifact, not your build:** install it the way a new user would, from the public URL, into a clean prefix. Check the version it reports, verify its checksum against the release metadata, and exercise the primary flow once.
4. Confirm the docs a newcomer lands on actually match what shipped.

---

## Definition of Done

- [ ] Every acceptance criterion maps to concrete evidence (command + output, or screenshot).
- [ ] Two consecutive clean rounds of suite + review + UAT.
- [ ] Independent reviewer signed off on the final diff, not an earlier one.
- [ ] Released artifact installed from the public path and exercised.
- [ ] CHANGELOG, STATE, KNOWLEDGE current; scaffolding gone.
- [ ] Every deviation from the original goal stated out loud.

## Guardrails

Verify-gate before every commit · no `git push` / PR / tag unless asked · scope to the change plus `su-code/` memory · stop only on a true blocker (missing credential, destructive irreversible action) — never on ambiguity: choose the reversible option and log it · report what is NOT done as plainly as what is.
