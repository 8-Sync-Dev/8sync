# Plan: loop-harness — strongest continuous, compliant auto loop for 8sync ccc

Owner (2026-10-16): "tự đề xuất tốt nhất làm đi … cách sài tốt nhất harness mạnh nhất auto mạnh nhất của loop … độc lập liên tục".

## Key questions
1. Which official Claude Code features keep a room working without the owner typing: `/loop` (fixed vs self-paced), `.claude/loop.md`, `/goal`, background sessions (agent view), cron restore on `--resume`, `autoContinueAtUsageLimit`, Desktop scheduled tasks, Routines (cloud)? Exact behaviour, limits, versions.
2. Which of these are allowed on a subscription (Team/Pro/Max OAuth) vs need a Console API key? Usage-limit behaviour.
3. What does 8sync already ship (auto --loop, idle, HQ auto-tick, ship-loop, loop verb) and what is the smallest change that gives the strongest loop?

## Evidence needed
- code.claude.com docs pages (scheduled-tasks, goal, agent-view, routines, desktop-scheduled-tasks, settings, legal-and-compliance), dated.
- Local: crates/cli/src/verbs/ccc/{auto,idle}.rs, apps/hq-ui/lib/auto-tick.ts.

## Scale
Survey, 2 sub-questions external → 2 `researcher` agents (Q1, Q2). Q3 is local, lead answers.

## Ledger
- [ ] R1 Q1 features → outputs/.drafts/loop-harness-r1.md
- [ ] R2 Q2 compliance/limits → outputs/.drafts/loop-harness-r2.md
- [ ] Draft → outputs/.drafts/loop-harness-draft.md
- [ ] Verify → outputs/.drafts/loop-harness-cited.md
- [ ] Review FATAL/MAJOR/MINOR
- [ ] Final outputs/loop-harness.md + provenance
- [ ] Implement recommended change (owner: "làm đi"), tests, gates, PR #57
