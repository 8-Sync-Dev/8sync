# PLAN — hq-web-team: run the whole team from the HQ web, ccc-official

## Goal
Open `8sync hq ui` and run everything there: start sessions with a **role** (R&D, Plan, Fullstack, AI, Tester, Reviewer), each on the right **model** for cost/difficulty; **assign tasks** to a role or a person; watch each session's **live terminal**; see the **team thread** (owner → session, session → session handoffs, tasks created/done) as typed cards; desks animate from real events; an in-app **guide** explains every action. Sessions stay official Claude Code (tmux `claude`), no proxy, no model calls from the UI.

## Acceptance criteria (each with one check command, run from apps/hq-ui unless noted)
- AC1 Roles + model routing: `lib/roles.ts` maps role → {label VN, emoji/icon, model, permission hint}; R&D/Plan/Architect → opus, Fullstack/AI/Reviewer → sonnet, Tester/Quick → haiku; session start API accepts `role` and passes `--model <id>` to `claude`; floor/nav show role badge. Check: `pnpm exec vitest run tests/roles.test.ts`
- AC2 Assign task in web: "Giao việc" dialog (subject, role or session, priority) → POST /api/tasks routes to a running session with that role (or starts one) and types the task into its tmux pane; board shows owner+role. Check: `pnpm exec vitest run tests/assign.test.ts`
- AC3 Live terminal: clicking a desk opens a side panel with the live tmux screen (refresh ≤1 s, ANSI colours, read-only + "type to session" input reusing the existing message path). Check: `pnpm exec vitest run tests/terminal-api.test.ts`
- AC4 Team thread: one chronological thread merging owner messages, session replies, session_message (A → B handoff card), task created/completed, needs-you; filter by session/role. Check: `pnpm exec vitest run tests/team-thread.test.ts`
- AC5 Animation from real events: desk state changes within one refresh of a journal event (typing/running/reading/waiting/handoff), handoff shows a brief "A → B" bubble; reduced-motion respected. Check: `pnpm exec vitest run tests/floor.test.ts tests/sprite.test.ts`
- AC6 Guide: in-app "Cách dùng" panel (first-run + help button) covering start-with-role, assign task, terminal, thread, needs-you, rules; docs/hq.md section updated. Check: `grep -q "Giao việc" components/hq/guide.tsx && grep -q "Giao việc" ../../docs/hq.md`
- AC7 Compliance: no outbound network from the UI server except 127.0.0.1 + GitHub-free; gitleaks clean on branch diff. Check: `bash ../../scripts/hq-offline-check.sh` (greps app/ lib/ for fetch/http(s) targets other than 127.0.0.1/localhost) and `gitleaks detect --no-banner --redact --log-opts origin/main..HEAD`
- AC8 Types + all tests: `pnpm exec tsc --noEmit && pnpm exec vitest run`; CI hq-ui-test + package-hq-ui green on the branch.

## Assumptions (auto)
- Models: opus = claude-opus-5-5, sonnet = claude-sonnet-5-5, haiku = claude-haiku-5-5 (`claude --model`), owner can override per session.
- Roles map onto existing kit agents where useful (explore, task, reviewer, qa, architect, pm).
