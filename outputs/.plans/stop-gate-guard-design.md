# Plan — stop-gate-guard-design (2026-10-12)

## Question
Ideal design for 8sync ccc's (1) native Stop gate (`crates/cli/src/verbs/ccc/gate.rs`) and (2) destructive-command guard (`crates/cli/src/verbs/ccc/danger.rs`), learning from CowAgent, oh-my-pi, ForgeCode, Claude Code official repo/plugins/docs, and public destructive-command guards.

## Known problems (reviewer, 2026-10-12)
- gate: backticked `stop` counted as user stop quote; JUSTIFIED list too broad for the plan check ("Next I'll remove dead code" ends turn); PROCEED substring ("prefix" ⊃ "fix"); VN "giá"/"khóa" ambiguity; no integration test of verify::stop → gate.
- guard: no PowerShell / ask-path tests through `check`; run-time targets (`rm -rf "$out"`) ask → denied under `-p`.

## Sub-questions → workers (one batch)
1. CowAgent full scan: agent loop end-of-turn / continuation logic, tool approval, dangerous-command handling, memory of user stop. → researcher A
2. oh-my-pi + ForgeCode: same questions (stop/continue, bash safety, approval modes). → researcher B
3. Claude Code official: Stop/SubagentStop hook semantics (decision/block, stop_hook_active, background_tasks), example plugins (ralph-wiggum, hookify, security-guidance…), PreToolUse ask/deny. → researcher C
4. Public destructive-command guards + stop-hook heuristics (web): parsing approaches, false-positive handling, test corpora. → researcher D

## Evidence files
outputs/.research/stop-gate-guard/{cowagent,omp-forge,claude-code,public}.md

## Ledger
- [ ] gather (A-D) · [ ] draft · [ ] verify · [ ] review · [ ] final + provenance · [ ] implement + tests
