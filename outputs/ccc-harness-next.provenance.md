# Provenance — ccc-harness-next (2026-10-13)

- **Pipeline:** plan → 4 `researcher` agents in parallel (omp; ForgeCode/Feynman/CowAgent; hot harnesses + Claude Code features; compliance + ccc inventory). Mid-run, the owner asked for a `/planning` focus, which was sent to 3 of them. Then lead draft → `verifier` → lead closed 2 UNVERIFIED by rebuild + repro → `reviewer` → final.
- **Verifier:** 52 OK / 13 FIXED / 10 UNVERIFIED / 0 dead links. The lead then closed 2 (binary matches HEAD, researcher B's guard hit), leaving 8.
- **Reviewer:** 0 FATAL, 11 MAJOR, 7 MINOR. All MAJOR items were folded into the final:
  - P0-2 demoted to P2-4 with a measure-first step.
  - `onFailure:"block"` added as P0-1.
  - `/planning` made opt-in, with a spike step, a minimal lint, step IDs, and dependencies on P2-1/P2-3.
  - P3-6 marked optional because of the `forceLoginMethod` conflict.
  - P3-1 placed before P3-2.
  - A safety test list added to the heredoc fix.
  - A ≤15 ms hook budget added.
  - Plan mode stated not to be a security boundary.

  The fixes were not re-reviewed; with no FATAL items, the skill does not require a second pass.
- **Local sources:** read only; nothing from the clones was run. `C:\Users\Admin\research\gate-guard\src\` (SOURCES.lock) — oh-my-pi 7738a3f082, forge 8703dec, feynman d28d964, CowAgent aa5f4c9, claude-code 3deb873, claude-plugins-official f359d43.
- **Web:** code.claude.com/docs (hooks, permission-modes, settings-reference, goal, channels, routines, plugin-evals, worktrees, workflows, statusline, output-styles, sandboxing, changelog — first ~100k chars only), anthropic.com/legal (AUP, consumer, commercial), support.claude.com, GitHub API (stars on 2026-10-13).
- **Measured locally:** guard verdicts on 5 heredoc cases, release build from clean `e4c94fa` (2026-10-13 06:30).
- **Not read / not verified:**
  - Kiro specs, Conductor, the Mods page.
  - The full Claude Code changelog.
  - Whether the 2026-11-12 AUP applies early.
  - The `/planning` spike behaviours: deny → resubmit, `additionalContext` → tasks, the clear-context path.
  - Actual `git push` behaviour in auto and `-p` modes.
  - `/goal` vs gate interaction.
  - claude-mem's hosted-default scope.
- **Remaining [UNVERIFIED]:** 8, listed in `outputs/.drafts/ccc-harness-next-cited.md`.
- **Verification: PASS** (with caveats above). **Review: PASS** (no FATAL).
