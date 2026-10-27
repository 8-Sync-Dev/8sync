---
name: sx-auto
argument-hint: '[<goal> | status | resume]'
description: 8sync autonomous engine — decompose a goal into slices/tasks and run to DONE on omp core via the code-enforced engine_* tools (durable state, verify-with-retry gate, git worktree). Right-sized, token-lean (trail/headroom), ponytail/karpathy discipline.
---

# /sx-auto — run to done on the 8sync engine

`$ARGUMENTS` first word: `<goal>` = plan + run · `status` = report · `resume`/empty = continue the saved plan.

You drive the **8sync-engine** (model-callable `engine_*` tools). It owns the durable plan state, the verify gate, and worktrees in CODE — you supply judgement. Obey `~/.omp/agent/APPEND_SYSTEM.md` (code-intel first; always-on skills).

## 0. Ground (token-lean)
Read `su-code/STATE.md` + the recent `failure:` entries in `su-code/KNOWLEDGE.md`. Explore with **trail** (`trail ask` / `trail callers` / `trail skeleton`) — never grep/Read-all. `headroom_compress` any tool output > ~50 lines.

## 1. Right-size first (ponytail)
Trivial / small (a few files, clear path) → just do it, no engine ceremony. Medium / large / multi-slice → use the engine.

## 2. Research, then plan (research is INTEGRATED into planning)
First **research** the unknowns so the plan is grounded — never guess:
- Scout the codebase: **trail** (`trail ask`, `trail callers <symbol>`).
- Domain/external unknowns: **feynman** skills (`deep-research` / `research-paper`; benchmark loops: owner runs `/autoresearch`) + `web_search` / `last30days`. Log decisions under `## Assumptions` in `su-code/STATE.md`.
Then call **engine_plan** with the goal + slices; each slice's atomic tasks; each task's `verify` commands = the project's REAL lint/test/build (this is the gate). Smallest-first.

## 3. Loop until done (in an autonomous run, do not yield between tasks)
1. **engine_next** → next task + scoped context. Understand before editing (`trail callers` / `trail ask` + `git log/blame` + `su-code/DECISIONS.md`).
2. Implement at the right size. Prefer targeted edits over blind whole-file rewrites.
3. **engine_verify** `{taskId}` — the gate runs the commands. FAILED → fix the cause, call engine_verify again — with a DIFFERENT fix: 2 identical failures warn, 3 BLOCK the task early (no-progress/doom-loop guard). BLOCKED → write a `failure:` to `su-code/KNOWLEDGE.md`, move to the next unblocked task or escalate.
4. **engine_advance** `{taskId, commit:true}` — code-REFUSED unless engine_verify passed (your own "done" is not a stop signal); gitleaks clean.
5. Tick `su-code/STATE.md` (Current/Next); distill a `validated:` runbook into `su-code/PLAYBOOKS.md` when a multi-step procedure worked.
6. Loop. Use **engine_worktree** to isolate a risky/large slice (open → work → merge squash → remove).

## 4. Closeout — re-evaluate HARD before handing back (large / multi-slice)
When engine_status shows all done, hand over ONLY if green:
1. **Full test suite** (not just changed tests) + add missing coverage.
2. **QA / UAT the running thing** — exercise real end-to-end flows in a **browser** (web app or the desktop web-debug port; see below). Catch what unit tests miss.
3. **Independent re-review** — a fresh `reviewer` (+ `senior-security` for anything sensitive) subagent reads the whole diff vs the goal + Definition-of-Done.
4. Doc-hygiene (`8sync harness audit`) + handoff summary; every goal item ↔ concrete evidence. Any gap → back into the loop.

## Use omp's tools (they are strong)
- **browser** — verify any web/visual change for real (open, screenshot, click), never guess. **Web app** → point it at the dev URL. **Desktop app (Tauri v2 / WRY-WebKit)** → run it with its web-inspector/remote-debug port enabled, then point the SAME `browser` tool at that port — identical DOM/console/network verification as web.
- **task** subagents — independent parallel work / context-heavy isolation / specialization you lack.
- **irc** — coordinate with siblings before editing a shared file.

## Guardrails
Verify-gate before every commit (engine_verify enforces it; engine_advance refuses unverified tasks) · scope to the change + `su-code/` memory · NO `git push` / PR unless asked · unattended needs omp `tools.approvalMode: yolo` AND a hard token ceiling (budget `+Nk!`) — a turn/token cap is a stop signal, agent say-so is not · stop only on a true blocker (missing credential, irreversible/destructive action), never on ambiguity — pick the reversible option and log it.

## Model + context budget
Use the models in `~/.config/8sync/models.toml` (view/edit: `8sync harness model`); route per task class — cheaper for trivial, stronger for review/debug — **never above the configured ceiling**, and let omp fall back to an authenticated model when the configured one isn't logged in. When context nears the limit (auto-compacts at 50%), write a structured handoff into `su-code/STATE.md` BEFORE it fires so the next session resumes clean.

Begin: ground, right-size, then act on `$ARGUMENTS`.
