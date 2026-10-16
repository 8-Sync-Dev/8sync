# PLAN — sprite-setstate: test `mountSprite.setState` over time

## Goal
`su-code/STATE.md` (Next, reviewer SHOULD 9): "sprite tests still cover only `transitionFor`, not `mountSprite.setState` over time". Add a vitest file that mounts a desk sprite on a fake canvas, drives the shared rAF loop with a manual clock, and asserts the clip sequence `setState` produces: stand-up/sit-down transitions hand over after their one-shot duration, a repeated target does not restart a transition, `done` re-triggers and hands to idle, reduced motion jumps straight to frame 0 of the new state, and `dispose` stops drawing.

## Non-goals
No change to `lib/sprite/render.ts` (test only; if the test finds a bug, record it). No jsdom dependency (node environment + small stubs).

## Acceptance criteria
| # | Criterion | Check (exit 0 = pass) |
|---|---|---|
| C1 | Test file exists and mounts real `mountSprite` | `bash su-code/ship/sprite-setstate/check.sh C1` (grep `mountSprite` + `setState` in `apps/hq-ui/tests/sprite-setstate.test.ts`) |
| C2 | It passes locally | `bash su-code/ship/sprite-setstate/check.sh C2` (`pnpm exec vitest run tests/sprite-setstate.test.ts` in apps/hq-ui) |
| C3 | It catches regressions: each of 3 mutations of `render.ts` (no transition; no repeated-target guard; one-shot never hands over) makes it fail; source restored after | `bash su-code/ship/sprite-setstate/check.sh C3` |
| C4 | CI on the branch: `hq-ui-test` (tsc + all vitest) success and `test` green on 3 OS | `bash su-code/ship/sprite-setstate/check.sh C4 <run-id>` |

## Tasks
- `apps/hq-ui/tests/sprite-setstate.test.ts` (stubs: document, window.matchMedia/devicePixelRatio, requestAnimationFrame queue, performance.now; frames read from the desk-cache key via a `memo` wrapper that still paints).
- CHANGELOG Unreleased (tests), STATE.md Next line is the owner's file: brief only.

## Risks
- Coupling to the cache key format `role|clip|i|blink|shirt` (documented in the test).
- Module state (shared loop, `raf`, `last`) leaks across tests: re-import the module per test (`vi.resetModules`).
