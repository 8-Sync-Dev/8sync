# Workflow: ccc self-improve loop (8sync CLI + Claude Code kit)

Status: READY TO BUILD (specified 2026-10-13 via /loop-me in auto mode: every open question was answered with the Recommended option; decisions carry their date).

## Purpose
Keep **ccc** (official Claude Code CLI driven by `8sync ccc`: kit, hooks, skills, agents, watchdog, hq) improving without the owner watching: learn from failures, track CI and releases, refresh skills from upstream, and ship small verified improvements. Ask the owner once, late, only for merge to `main`, tags/releases, publishing, secrets, or anything destructive or paid.

## Parts
1. **Poller** (no AI): finds changes cheaply; starts an agent run only when something changed or the daily heartbeat fires.
2. **Agent run**: one Claude Code session named `ccc-loop` in a worktree of `8-Sync-Dev/su-code`, following the steps below with the kit's skills (`/ship`, `/sec`, `/rules`, `/aup-audit`, `/deep-research`, `/remember`, `/consolidate`).

## Trigger (event-driven, 2026-10-13)
- Poller = `8sync` systemd **user** timer every 5 min (`Nice=19`, `CPUQuota=5%`), plus a daily heartbeat at 08:13 local that runs the agent unconditionally. Until the timer exists, the session-only `/loop 5m` cron in a live session plays this role (expires after 7 days).
- Each poll, using `gh api` with ETags (304 = no change, no tokens):
  - `8-Sync-Dev/su-code`: `main` head, open PRs (`updated_at`), Actions runs completed since the last poll;
  - issues labelled `ccc` or `8sync`;
  - upstream skills, at most daily: `pbakaus/impeccable` releases, `Leonxlnx/taste-skill`, `anthropics/skills`, `nextlevelbuilder/ui-ux-pro-max-skill` (latest commit or tag);
  - Claude Code CHANGELOG (new hooks, settings or skill features), at most daily;
  - local signals: new `failure:` lines in `su-code/KNOWLEDGE.md`, watchdog alerts (`~/.local/state/8sync/watchdog/alerts.jsonl`), StopFailure records.
- State: `~/.local/state/8sync/ccc-loop/state.json`. Lock: `run.lock` (flock). While a run is going, a poll only records events.

## Agent run steps
1. **Sync.** `git fetch`; work only in `~/tools/su-code-*` worktrees on branches `loop/<slug>`. Never switch a checkout another session uses (`8sync ccc . ls`, ListAgents).
2. **Read state.** `su-code/STATE.md`, `su-code/ship/ACTIVE`, the last 20 `failure:`/`validated:`/`decision:` lines, `outputs/ccc-harness-next.md` (roadmap), events from the poller.
3. **Track CI.** A failed run on a `loop/*` branch is fixed in step 5. A flake (runner, network) is re-run once with `gh run rerun --failed`. A failure on someone else's branch → SendMessage that session with the link and a ≤20-line log excerpt; no edits.
4. **Pick one item** (bounded, 2026-10-13), in this order:
   1. red CI or broken install on `main`;
   2. a `failure:` without a guard or test;
   3. an open `ccc` issue with acceptance criteria and no assignee;
   4. the next unchecked roadmap item;
   5. an upstream skill refresh: diff it; vendor only if the license allows, it fits the size ceiling, and it needs no runtime binary download or keys (impeccable 4.5.2 was deferred for exactly this);
   6. a new Claude Code feature the kit should adopt.

   Product-direction choices go to the brief, not the code.
5. **Ship it with `/ship <item>`.**
   - Plan, then code with tests.
   - Locally only light checks (`cargo check -j2`, one test module, lint, all under `nice -n 19 ionice -c3`). Full test, build and size run on GitHub Actions (`gh workflow run ci.yml --ref loop/<slug>`, `gh run watch` in background).
   - Run `/sec` on every diff. Run `/rules` and `/aup-audit` when the diff touches subscription/OAuth, third-party tools, data collection, or messaging people.
   - A `reviewer` subagent must reach MERGEABLE.
   - Update CHANGELOG `Unreleased`.
6. **Release (owner checkpoint, pushed right).**
   - Open a PR and wait for CI to go green.
   - Then a single brief: what changed, why, evidence (CI link, tests), and risk.
   - The guard asks the owner at `gh pr merge` and at the tag push. Batch several green PRs into one release when they land within the same day.
   - The release workflow writes notes from the CHANGELOG section.
   - After release: `8sync up`, `8sync ccc kit`, and a smoke run of the changed command, recorded in STATE.
7. **Learn.**
   - Every fixed failure or verified procedure → `/remember`, with evidence.
   - Weekly (Monday heartbeat) → `/consolidate`.
   - A validated multi-step procedure → `su-code/PLAYBOOKS.md`.
8. **Brief.** A ≤10-line summary in the session and in the `## Brief` block of `su-code/STATE.md`: items done (links), items waiting for the owner, items skipped and why.

## Checkpoints
Only: merge to `main`, tag/release, `publish`, a secret or credential, paid services, destructive actions, product direction. Everything else is autonomous.

## Never
- Touch omp provider config or another account's settings.
- Edit client repos (`~/works/*`, CloudGo).
- Flip repo visibility.
- Read or print secrets.
- Run heavy builds on the owner's machine.
- Use `bypassPermissions`.
- Message people outside the team.

## Done (per run)
CI green on the branch, reviewer MERGEABLE, CHANGELOG updated, STATE brief written. Or a brief explaining why nothing was safe to do.
