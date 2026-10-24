---
name: sx-pull-now
argument-hint: '[go]'
description: Cold-resume on this machine — git pull the latest, then read su-code/STATE.md (HANDOFF block) + recent KNOWLEDGE learnings + CHANGELOG to understand exactly where the project is, prepare the workspace (rebuild/harness + per-machine gotchas from the handoff), and report current state + the next concrete action. The receiving end of /sx-push-now. `go` = also start the next action; default = orient + prepare, then wait.
---

# /sx-pull-now — pull + understand + prepare (arriving on a machine)

`$ARGUMENTS`: `go` = after orienting, start the next action autonomously; empty = orient + prepare, then STOP and report (wait for the human). This is the **receiving end of `/sx-push-now`** — someone just handed the repo off and I'm continuing here, urgently. Obey `~/.omp/agent/APPEND_SYSTEM.md` (code-intel first; always-on skills).

## 1. Pull the latest (fast, safe)
- `git status --porcelain` first. **Uncommitted local changes?** STOP — show them and ask before pulling (never clobber). Clean → continue.
- `git fetch origin` then `git pull --ff-only` on the current branch. If not fast-forward (diverged): `git pull --rebase`; on conflict, STOP, list conflicted files, and report — do NOT force or reset.
- Report the range pulled (`<old>..<new>`) and the new HEAD subject.

## 2. Understand where the project is (the important part — read, don't guess)
Read, in order (token-lean; `headroom_compress` anything > ~50 lines):
1. **`su-code/STATE.md`** — especially the `## 🚚 HANDOFF` block (what changed last session, Done/Next/Blockers, per-machine gotchas, runbook) and `## Current step` / `## Next`.
2. **`su-code/KNOWLEDGE.md`** — the most recent `validated:` / `failure:` entries (append-only, at the tail) so I don't repeat a known dead-end.
3. **`CHANGELOG.md`** `## [Unreleased]` + top released version; **`git log --oneline -5`** to see what just landed.
4. If a large feature is active: `su-code/planning/ACTIVE.md` → the active slug's `STATE.md`.
Explore code with **trail** (`trail ask` / `trail callers`) — never grep/Read-all.

## 3. Prepare the workspace (make it actually runnable HERE)
Follow the handoff's new-machine runbook + per-machine section. Concretely:
- **Binary current?** If the pulled diff touched `crates/` or `assets/`, rebuild: `bash scripts/bootstrap.sh` (or `cargo build --release` + install). Then `8sync harness` so skills/commands/AGENTS/trail graph (`trail build`) refresh on THIS box.
- **Per-machine gotchas** the handoff called out (these live in `~`, NOT git) — verify each that's relevant, e.g.: `npm --version` prints a number (else fix the pnpm shim per KNOWLEDGE), `8sync feynman auth-omp` if using Feynman, `8sync harness browser`, custom models in `~/.omp/agent/models.yml`, VPN. Don't run heavyweight/sudo/reroute steps (`vpn install`/`on`, big AUR) unprompted — list them as "run if you need X".
- **Sanity:** `8sync doctor` (or the project's build/test smoke) to confirm green before continuing.

## 4. Report — orient the human, then decide
Print a tight status: **current state** (branch/HEAD, what's done vs in-progress from the handoff), **blockers**, **the single next concrete action** (exact file/command), and any per-machine step still pending.
- `$ARGUMENTS` = `go` → immediately start that next action (right-size per ponytail; use `/sx-auto` for a real multi-slice goal). Stop only on a true blocker.
- empty → **STOP here** and wait for the human's go — pulling + orienting is the deliverable, not committing to new work blindly.

## Guardrails
Current branch only; never force-pull / reset / clobber uncommitted work. Read-and-prepare is safe; the moment work would EDIT code, right-size and (for anything non-trivial) confirm the plan. No `git push` here — that's `/sx-push-now`. Skip destructive/sudo prep unless asked.

Begin: pull safely, read STATE + KNOWLEDGE + CHANGELOG, prepare the workspace, report — then act on `$ARGUMENTS`.
