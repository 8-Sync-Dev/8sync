# omp research for ccc-harness-next

Source: local clone `C:\Users\Admin\research\gate-guard\src\oh-my-pi` @ 7738a3f082 (MIT). Read only, nothing executed. Date read: 2026-10-13.
All omp paths below are relative to `packages/coding-agent/src/` unless they start with `packages/` or `crates/`.
Already done in ccc and NOT re-proposed: see `plans/2026-10-12-ccc-beyond-omp.md` and CHANGELOG 0.66.0 / Unreleased (native Stop gate, danger guard, role-routed agents, prewalk-via-/ship, session-start digest, LSP plugins, deferred MCP tools, researcher/verifier, short subagent envelope, skillOverrides).

IMPORTANT CAVEAT: I did NOT fetch Claude Code docs in this run (turn limit). Every "CC mechanism" below is from the prior plan doc or general knowledge and is marked "CC: not verified" where it matters. A verifier pass against https://code.claude.com/docs/en/hooks and /permission-modes is still needed before building.

## Evidence table

| # | Claim | Source | Date/version | Confidence |
|---|---|---|---|---|
| S1 | Plan mode state is `{enabled, planFilePath, workflow: "parallel"\|"iterative", reentry}` | plan-mode/state.ts:1-6 | 7738a3f | high |
| S2 | Plan files live at `local://<slug>-plan.md` (session-local artifact dir), never renamed on approval | plan-mode/approved-plan.ts:111-116; prompts/system/plan-mode-active.md:5,23 | 7738a3f | high |
| S3 | Optional autosave of approved plan to `<project>/.omp/plans/<TOPIC>_PLAN.md`, off by default, collision-safe (`wx`) | plan-mode/plan-autosave.ts:12-31,60-77; plan-mode/settings.ts:37-48 | 7738a3f | high |
| S4 | Enter/exit: `/plan` command or keybind `app.plan.toggle`; plan off by setting `plan.enabled` (default true); `plan.defaultOnStartup` default false | modes/interactive-mode.ts:5869-5910; modes/controllers/input-controller.ts:666-669; plan-mode/settings.ts:12-35 | 7738a3f | high |
| S5 | Enter swaps active tools: keeps previous tools, adds built-in `write` (needed to draft plan + `xd://propose`); sets plan state, switches model to the `plan` role, records mode change | modes/interactive-mode.ts:4943-5020 | 7738a3f | high |
| S6 | Exit restores tools and pre-plan model; exit mid-plan with a draft asks "Exit plan mode?"; `paused` state allows toggle back | modes/interactive-mode.ts:5061-5160, 5880-5900 | 7738a3f | high |
| S7 | Read-only is enforced IN CODE only for write/edit: rename and delete refused, writes allowed only inside `local://` sandbox (symlink-safe realpath check) | tools/plan-mode-guard.ts:129-150, 18-38; crates/pi-edit/src/path_policy.rs:211-244 | 7738a3f | high |
| S8 | No plan-mode check found for bash: grep of `plan` in tools/bash.ts and exec/*.ts returned nothing. "No state-changing commands" is prompt-only (plan-mode-active.md:3). | grep result this run; prompts/system/plan-mode-active.md:3 | 7738a3f | medium (grep only, not full read) |
| S9 | Plan prompt: "execution spec, not design doc"; implementer must execute top-to-bottom with zero design decisions; bans Non-Goals/Alternatives/Risks sections; required sections Context, Approach, Critical files (<=5), Verification (>=1 new-behavior check), Assumptions & contingencies (pre-decided fallbacks) | prompts/system/plan-mode-active.md:14-16,80-103 | 7738a3f | high |
| S10 | Plan prompt says resolve discoverable facts by exploring, ask only preferences/tradeoffs, 2-4 options + recommended default, batch questions; parallel workflow = Understand (scout subagents) -> Design (optional critique subagent) -> Review -> Write; iterative workflow = explore/interview/update/calibrate | prompts/system/plan-mode-active.md:37-44,60-78 | 7738a3f | high |
| S11 | Approval is NOT prose or ask: model writes the slug to `xd://propose`; plan-active prompt forbids asking for approval via prose or ask | prompts/system/plan-mode-active.md:7,9,122; tools/resolve.ts:1-20 | 7738a3f | high |
| S12 | Turn-end enforcement: if a plan-mode turn ends with neither `ask` nor propose, host forces `tool_choice: required` and appends a reminder; capped by PLAN_MODE_REMINDER_MAX | session/agent-session.ts:10612-10666; prompts/system/plan-mode-tool-decision-reminder.md | 7738a3f | high |
| S13 | On propose, host validates plan file exists (finds it via slug, else newest `*plan.md`, else state path) and returns "Plan ready for review." | session/agent-session.ts:1608-1623; plan-mode/approved-plan.ts:156-190 | 7738a3f | high |
| S14 | Review UI: agent is aborted silently so it cannot re-submit while the popup is open; popup is a fullscreen overlay with options Approve and execute / Approve and compact context / Approve and keep context (~tokens/window, disabled if too big) / Refine plan / Save and quit | modes/interactive-mode.ts:6533-6573 (options 6567-6573) | 7738a3f | high |
| S15 | Overlay: plan split into sections by heading, scrollable markdown, Contents sidebar when wide and >=2 headings, per-section delete (with undo) and per-section annotations; annotations become Refine feedback; Tab cycles toc/body/actions; external editor key opens plan in $EDITOR | packages/tui/src/overlays/plan-review-overlay.ts:1-20; modes/interactive-mode.ts:5603-5640, 6600-6625 | 7738a3f | high |
| S16 | Model-tier slider in the review: pick which role model (smol/default/slow) executes the plan; starts on `default`; hidden if <2 roles resolve | modes/interactive-mode.ts:6575-6600 | 7738a3f | high |
| S17 | Edits made in overlay are mirrored to the plan file on disk and carried into the approved prompt | modes/interactive-mode.ts:6612-6616, 6700-6706 | 7738a3f | high |
| S18 | Execute options: "execute" = clear session, copy local artifacts, write plan to new session; "compact" = compaction with plan-specific distillation prompt then execute; "keep" = execute in same context; "save" = write plan to chosen path, exit, start new session | modes/interactive-mode.ts:5540-5580 (save), 5680-5735 (approve/compact/clear); prompts/system/plan-mode-compact-instructions.md | 7738a3f | high |
| S19 | Compaction instructions: keep rationale, rejected alternatives, decisions, discovered files, user prefs; drop tool noise and superseded drafts; do not restate plan body (re-inlined later) | prompts/system/plan-mode-compact-instructions.md:3-16 | 7738a3f | high |
| S20 | After approval a hidden synthetic prompt inlines the full plan + path, tells the agent to init `todo`, update after each step, verify each step before the next, not re-read the file while inline copy is intact | prompts/system/plan-mode-approved.md:1-25; modes/interactive-mode.ts:5792-5820 | 7738a3f | high |
| S21 | Plan reference re-injected on later turns (hidden `plan-mode-reference` message) until sent once; plan read results are protected from prune/shake so the plan survives compaction | session/agent-session.ts:6995-7020, 7878-7882; plan-mode/plan-protection.ts:16-32 | 7738a3f | high |
| S22 | Subagents receive the approved plan via `loadOverallPlanReference` (skipped during plan mode itself) | plan-mode/plan-handoff.ts:12-42 | 7738a3f | high |
| S23 | A plan-mode subagent prompt: read-only architect, ends with "Critical Files for Implementation" (3-5 files) | prompts/system/plan-mode-subagent.md:1-33 | 7738a3f | high |
| S24 | Planning model = `plan` role: switch on entry, restore on exit, re-resolve when the role is reassigned mid-plan, deferred if streaming | plan-mode/model-transition.ts:1-51; modes/interactive-mode.ts:4687-4720 | 7738a3f | high |
| S25 | plan-yolo: start in read-only plan mode, auto-approve first propose, switch to a cheap model (`--plan-yolo-into`, default smol role) and steer with handoff prompt "re-read plan; confirm every step completed" before ending | session/prewalk.ts:380-500 (esp. 440-500); session/agent-session-types.ts:113-123; prompts/system/plan-yolo-handoff.md:1-8; commands/launch-help.ts:34-38 | 7738a3f | high |
| S26 | Prewalk (non-plan): strong model plans, writes 5-9 todo items, switches to smol at first write/exec-tier edit; read-only calls do not trigger the switch | session/prewalk.ts:36-60; prompts/system/prewalk-plan.md:1-8; setting at session/settings.ts:73-81 | 7738a3f | high |
| S27 | `ask` timeout (auto-select recommended) is disabled in plan mode | tools/ask.ts:743-745; modes/settings.ts:1226-1243 | 7738a3f | high |
| S28 | Plan drift: no dedicated drift detector found in code. What exists: plan re-injected (S21), plan survives compaction (S21), todo reminders (S31), handoff "re-read plan and confirm every step" (S25), prewalk checklist (S34) | grep of plan-mode/*, session/agent-session.ts | 7738a3f | medium (absence claim, limited search) |
| S29 | ask tool schema: per question `id, question, header (chip), options[{label, description, preview}], multi, recommended (0-based)`; "(Recommended)" suffix added automatically; "Other (type your own)" added by UI; timeout auto-selects recommended | tools/ask.ts:1-17,60-76,133-167,457-475 | 7738a3f | high |
| S30 | ask tool description tells the model: ask ONLY for materially different tradeoffs; default is act using code/config/docs/history; if several viable, pick conservative/standard, proceed and say so | prompts/tools/ask.md:1-6 | 7738a3f | high |
| S31 | Todo: phased list; ops init/start/done/rm/drop/block/unblock/append/view; statuses pending/in_progress/completed/abandoned/blocked; host normalizes so exactly one task is in_progress | tools/todo.ts:50-75, 128-142; plan-mode/ n/a | 7738a3f | high |
| S32 | Eager todo: `todo.eager` modes default/preferred/always; "always" forces a todo `init` before substantive work covering investigation through verification, 5-10 word labels | session/todo-tracker.ts:6-9; prompts/system/eager-todo.md:1-12; tools/settings.ts:390-400 | 7738a3f | high |
| S33 | Mid-run nudge: after 12 mutating tool calls (bash/edit/write/ast_edit/eval) without a todo update and incomplete items, hidden reminder, max 2 per cycle, not in plan mode; stop-time todo reminders default on, max 3 | session/todo-tracker.ts:17-26,310-340; tools/settings.ts:360-380; prompts/system/mid-run-todo-nudge.md | 7738a3f | high |
| S34 | Prewalk checklist asked before "complete": consistency (grep all call sites), scope (smallest diff), verification (run whole test file, not only the flipped test) | prompts/system/prewalk-checklist.md:1-8 | 7738a3f | high |
| S35 | Tool-call loop guard: same tool + identical canonicalized args N times in a row (default threshold 5, enabled by default, exempt list) -> interrupt notice "NEVER call X with those arguments again" | packages/ai/src/utils/tool-call-loop-guard.ts:1-60; session/settings.ts:272-300; prompts/system/tool-call-loop-redirect.md | 7738a3f | high |
| S36 | Thinking-loop redirect: repeated near-identical reasoning -> "pick the most boring viable option; act" | prompts/system/thinking-loop-redirect.md; session/turn-recovery.ts:92 | 7738a3f | high |
| S37 | Generated-file edit guard: blocks edit/write to auto-generated files by filename (`zz_generated.`, `.pb.go`, `_pb2.py`, `.gen.go/ts`, `.mock.*`) and header markers (`@generated`, "code generated by", "DO NOT EDIT", known generators); message tells the model to edit the source/generator and regenerate | tools/auto-generated-guard.ts:1-22; crates/pi-edit/src/path_policy.rs:272-292,554-591 | 7738a3f | high |
| S38 | Read tool: default 300 lines when no limit; whole-file read without selector returns tree-sitter structural summary (function bodies folded) when long enough | tools/settings.ts:161-168,192-223; tools/read-summary.ts:1-40 | 7738a3f | high |
| S39 | Superseded reads pruned: a complete bare-path read supersedes earlier range reads of the same file | tools/read-supersede.ts:1-18; packages/agent/src/compaction/pruning.ts:1-50 | 7738a3f | high |
| S40 | Checkpoint/rewind tools: model opens an investigation checkpoint with a goal, later rewinds context and keeps only a report | tools/checkpoint.ts:1-40; prompts/tools/checkpoint.md, rewind.md | 7738a3f | medium (header read only) |
| S41 | Goal mode: `goal` tool create/get/resume/complete/drop with objective + optional token budget; hidden continuation prompt each turn; "complete" only after auditing each deliverable against current-state evidence; budget-limit prompt says wrap up, do not mark complete | goals/runtime.ts:1-60; prompts/tools/goal.md; prompts/goals/goal-continuation.md:1-25; goal-budget-limit.md | 7738a3f | high |
| S42 | `/guided-goal` interviews user (one question per turn, <=6) until 5 fields are fixed: binary success criteria, verification command, attempt cap, scope boundaries, stop/escalation conditions; rejects "until it works" | prompts/goals/guided-goal-interview.md:1-30 | 7738a3f | high |
| S43 | `/loop` continue-condition is a shell command; exit 1 = stop, exit >1 = broken condition surfaced as error (not read as "done"); iteration and duration limits | modes/loop-condition.ts:1-25; modes/loop-limit.ts:1-25 | 7738a3f | high |
| S44 | Magic keywords in prompt text ("ultrathink", "orchestrate", "workflowz", "jevify") append a hidden per-turn notice; table-driven, tool-gated | modes/magic-keywords.ts:30-100 | 7738a3f | high |
| S45 | "orchestrate" contract: never yield before closure; flatten referenced checklists into todo items; parallel task calls in one message; subagents never lint/format/verify, orchestrator verifies once per phase; corrective subagent for gaps; no "v1/MVP" relabeling | prompts/system/orchestrate-notice.md:1-25 | 7738a3f | high |
| S46 | Eager task: "settle approach yourself, then fan out; batch independent slices in ONE call; work alone for single-file <~30 line edits, direct answers, one runnable slice" | prompts/system/eager-task.md:1-7 | 7738a3f | high |
| S47 | Task results: <=5000 chars inline then `agent://<id>` pointer; read-only agents detected by tool allowlist (fail-safe) | task/result-summary.ts:16-50; task/read-only-policy.ts:1-28 | 7738a3f | high |
| S48 | Bundled `scout` agent: model `@smol`, tools read/find/grep/glob/web_search, structured output {summary, files[path:range], architecture, optional report} | prompts/agents/scout.md:1-40 | 7738a3f | high |
| S49 | Subagent progress probe: orchestrator asks a worker "what % complete" with phase anchors (0-15 explore ... 90-99 final review) and previous estimate | prompts/system/subagent-completion-probe.md:1-21; task/completion-probe.ts:18 | 7738a3f | high |
| S50 | Speculative subagent launch: batch `task` items start as soon as each JSON item closes while the call still streams; aborted if call invalid/changed | task/speculative-launch.ts:1-22 | 7738a3f | high |
| S51 | TTSR rules: frontmatter `condition` regex, `astCondition`, `question` (judge model yes/no), `scope` (text/thinking/tool:edit(*.ts)), `agents` globs, `interruptMode`; regex match aborts the stream, injects rule, retries | capability/rule.ts:19-80; export/ttsr.ts:1-45; session/ttsr-coordinator.ts; prompts/system/ttsr-interrupt.md | 7738a3f | high |
| S52 | LSP: after edit/write, writethrough sends file to LSP, returns diagnostics inline; late diagnostics arrive as a notice; DiagnosticsLedger shows only NEW diagnostics per file (dedupe) | lsp/writethrough.ts:1-30; lsp/diagnostics-ledger.ts:1-30; lsp/deferred-diagnostics.ts; prompts/tools/lsp-late-diagnostic.md | 7738a3f | high |
| S53 | Compaction methods ordered list: remote (provider-native) / snapcompact / handoff / soft / shake (drop recoverable heavy content, no LLM); per-model thresholds | session/compaction-methods.ts:1-45; session/model-compaction-threshold.ts | 7738a3f | high |
| S54 | Experimental context notebook (16 KiB) that survives context reset, `new_context` signal | session/context-notes.ts:1-12; tools/context-notes.ts | 7738a3f | high |
| S55 | Auto-learn: after substantive stop, nudge to save lessons and create managed skills in an isolated dir, never touching authored skills; 64 KB cap; default off | autolearn/controller.ts:1-20; autolearn/managed-skills.ts:1-30; autolearn/settings.ts:8-25 | 7738a3f | high |
| S56 | Memory writes redact credential-shaped tokens before storing, because recalled memory re-enters the prompt every turn | memory-backend/redact.ts:1-30 | 7738a3f | high |
| S57 | Whole-session secret obfuscation: secrets replaced by placeholders before sending to provider, restored on the way back | secrets/obfuscator.ts, secrets/message-transform.ts (headers read only) | 7738a3f | medium |
| S58 | Async jobs: bash auto-backgrounds after 60 s foreground wait; results self-deliver as `async-result` follow-up, >12k chars spill to artifact with 4k preview; max 15 running | async/auto-background.ts:1-15; session/async-job-delivery.ts:30-40; async/job-manager.ts:35 | 7738a3f | high |
| S59 | Extension/hook event set: session_start/switch/branch/compact/compacting/shutdown/stop, context, agent_start/end, turn_start/end, auto_compaction, auto_retry, ttsr_triggered, todo_reminder, before_agent_start, user_bash, input, plan_review_requested/resolved | extensibility/shared-events.ts:31-311; extensibility/extensions/types.ts:1604-1641; modes/interactive-mode.ts:6670-6690 | 7738a3f | high |
| S60 | Approval modes `always-ask` / `write` / `yolo` by tool tier read<write<exec, per-tool allow/deny/prompt overrides; fail-closed when no settings; schema default is yolo | tools/approval.ts:17,53-85,120-184 | 7738a3f | high |
| S61 | `cleanse`: run language checkers (tsc, cargo check, ...), group diagnostics per file by weighted burden, dispatch @smol repair agents per file group, then verify | cleanse/index.ts:1-40; cleanse/balance.ts:1-30; cleanse/loop.ts:1-40 | 7738a3f | high |
| S62 | `ratchet`: eval hillclimb with host-side keep/revert gate, frozen split, held-out leakage checks, `.omp/ratchet/<flow>/` | ratchet/ratchet.ts:1-30 | 7738a3f | high |
| S63 | Judge role: small model answers typed yes/no questions (unexpected stop, auto-thinking difficulty, TTSR judged rules) | judgment/index.ts:1-15; auto-thinking/classifier.ts:1-15; session/unexpected-stop-classifier.ts:1-12 | 7738a3f | high |
| S64 | Cache warmer replays a request to keep prompt cache alive; Anthropic "slow mode" ports Claude Code `/low-priority` using subscription rate-limit headers | session/cache-warmer.ts:1-20; session/anthropic-slow-mode.ts:1-25 | 7738a3f | high |
| S65 | `+500k` / `+500k!` turn-token-budget directive typed in a prompt (advisory or hard) | modes/turn-budget.ts:1-25 | 7738a3f | high |
| S66 | Hashline edit format (line-tag anchored patches) | prompts/edit/ hashline-compact.md under edit/ (edit/hashline-compact.md:1-20) | 7738a3f | high |

## Plan mode (owner request: dedicated `/planning` for ccc)

### How omp does it, in order
1. Enter: `/plan [prompt]` or toggle key (S4). Refuses if goal mode or vibe mode is on (interactive-mode.ts:4948-4955). Plan path is chosen, tool set widened with `write` only, model switched to `plan` role (S5, S24).
2. While active: working tree read-only for write/edit by code (S7), bash by prompt only (S8). `local://` is a scratch area the agent may write freely. The agent drafts `local://<slug>-plan.md` incrementally with edit, not all at the end (plan-mode-active.md:26).
3. Questions: ask tool, options + recommended, batched, timeout off in plan mode (S10, S27, S29).
4. Subagents: parallel `scout` readers for exploration and optional critique subagent before committing to a design (plan-mode-active.md:73-74; plan-mode-subagent.md).
5. Plan content standard: decision-complete, self-contained, no padding sections (S9). Test of quality: "an engineer unfamiliar with the conversation can execute every step without a design decision and tell when each step is done" (plan-mode-active.md:116).
6. Submit: write slug to `xd://propose` (S11). Host forces a decision each turn: ask or propose (S12). Host validates the file (S13).
7. Review UI: silent abort, then fullscreen overlay with TOC, section delete/undo, per-section annotations feeding Refine, external editor, model-tier slider, five choices (S14-S17). Remote extensions can also answer the review (`plan_review_requested/resolved`, S59).
8. Execute: four exits (S18). Compact path uses a plan-specific summary prompt (S19). Execution starts with a hidden synthetic prompt containing the plan, which tells the agent to init todos and verify each step (S20). Plan re-injected later and protected from pruning (S21). Subagents get the plan (S22).
9. Optional cheap executor: slider choice or `--plan-yolo-into` (S16, S25).
10. Drift: no hard detector (S28). Soft controls only: reference re-injection, todo nudges (S33), "re-read plan, confirm every step" handoff (S25), completion checklist (S34).

### What is better than Claude Code's built-in plan mode (CC side: not verified this run; I know CC has Shift+Tab plan mode, an ExitPlanMode approval dialog and plan files, but did not re-read the docs)
- Plan quality contract (S9): explicit sections and a "zero design decisions" test, plus pre-decided fallbacks. Pure prompt; portable to ccc as a skill or output-style.
- Approval options with a fresh-context, compact, or keep-context choice and a token-usage hint on "keep" (S14, S18). CC offers some context-clear options but the compact-with-distillation prompt and executor-model slider are not known in CC (not verified).
- Section-level review: delete a section, annotate a section, feedback loops into Refine (S15). No CC equivalent known; CC TUI is not extensible, so NOT portable as UI. Closest: plan file in `$EDITOR` plus a `/planning` skill that asks per-section questions via AskUserQuestion.
- Forced decision each turn so plan mode never ends in idle prose (S12): portable with a Stop hook (ccc already has a native Stop gate; add a "plan mode active and no ExitPlanMode/AskUserQuestion this turn" rule).
- Plan to todos hand-off in the approved prompt (S20) and re-injection after compaction (S21): portable via SessionStart/PostCompact hook that re-inlines the plan file (ccc already has a byte-stable session-start digest; extend with the active plan path).
- Planner on a stronger model, executor on a cheaper one (S16, S25, S26): ccc `/ship` already does Opus plan then Sonnet task; plan-yolo adds auto-approve for headless runs.
- Code-enforced read-only for working tree (S7) is stronger than omp's bash story (S8); in CC the equivalent is PreToolUse hook on Edit/Write/Bash while a state file says "planning" (feasible; CC: not verified that hooks see permissionMode in input).

### Suggested `/planning` for ccc (design sketch only)
- Skill `/planning <task>` + state file `su-code/.planning/active.json` + plan file `su-code/plans/<slug>-plan.md` (or `.claude/plans`).
- PreToolUse hook: while active, deny Edit/Write outside the plans dir; deny destructive Bash (reuse danger.rs) and any non-read-only Bash.
- Plan template from S9; workflow = explore subagents (haiku) then draft then AskUserQuestion for preferences only (S10, S30) then one critique subagent then submit.
- Submit = AskUserQuestion with options Approve & execute (fresh), Approve & compact, Approve & keep, Refine, Save & quit; recommended on option 1 (S14). Annotations replaced by "Refine: which section?" free-text.
- On approve: hook writes plan into todo list (TaskCreate per step), SessionStart/PostCompact re-inlines plan, Stop gate checks every todo done and last message cites verification output.
- Optional `--yolo`: auto-approve in headless runs then route executor to Sonnet.

## Per-area findings and CC mapping

| Area | omp feature (file:line) | CC equivalent | Rebuild in CC | NOT ALLOWED? |
|---|---|---|---|---|
| todo/progress | phased todo, blocked/abandoned, forced eager init, mid-run nudge after 12 mutations (S31-S33) | TodoWrite/Tasks, TaskCreated/TaskCompleted hooks, Stop hook | PostToolUse hook counts Edit/Write/Bash since last TaskUpdate, injects additionalContext after N (CC: additionalContext on PostToolUse not verified); UserPromptSubmit hook can add "init a task list first" for big requests | no |
| ask UX | recommended, preview, multi, header, auto-timeout (S29, S30) | AskUserQuestion (options, multiSelect) | ccc gate exists; port only the description rules (S30) and "(Recommended)" first-option convention; timeout auto-select not possible without faking UI answer: CC: not verified | no, but do not fake answers via proxy |
| subagents | eager-task fan-out rules, batch in one call, scout @smol, 5k envelope, read-only policy (S46-S48) | Agent tool, agent frontmatter model/effort/tools | rules into `/ship` and pm agent prompt; already partly done | no |
| TTSR | stream-aborting rule injection by regex/AST/judge (S51) | `.claude/rules/*.md` with `paths:` (per prior plan), PreToolUse `if:` | PreToolUse on Edit/Write matches new_string regex, returns deny+reason with the rule text. Cannot abort a streaming text mid-way: stream hooks do not exist in CC | stream interception via proxy = NOT ALLOWED |
| LSP | writethrough diagnostics, new-only ledger (S52) | official LSP plugins (already enabled in 0.66) | PostToolUse hook that dedupes repeated identical diagnostics: CC: not verified whether diagnostics are visible to hooks | no |
| compaction | shake, handoff, plan-aware distill, per-model thresholds (S53, S19) | auto-compact, PreCompact/PostCompact hooks, `/compact <focus>` | PreCompact hook adds custom instructions to preserve plan path, todos, failing test names; PostCompact re-injects (partly done) | replacing compaction engine/snapcompact = NOT ALLOWED / DROP |
| memory/resume | recall once, redact secrets before store, autolearn managed skills (S55, S56) | auto-memory, SessionStart hook, skills | redact filter on STATE/KNOWLEDGE digest (S56) is cheap and matches org rule on secrets; managed-skill auto-creation: write only to an isolated `skills/_managed/` dir, off by default | no |
| approval modes | read/write/exec tiers (S60) | permission modes, allow/deny rules, auto mode | already covered by guard + policy | no |
| prewalk | plan strong, implement cheap (S26) | /ship routing | done | no |
| edit tools | hashline (S66), generated-file guard (S37), conflict:// resolve | Edit tool fixed | generated-file guard as PreToolUse(Edit/Write): check filename patterns + first 1 KB markers, deny with "edit the generator". Fits Encore (`encore.gen.*`) and protobuf | hashline replacing Edit = needs custom client, DROP |
| background/async | auto-background bash at 60 s, self-delivered results (S58) | Bash `run_in_background`, background agents | mostly native; lesson from CHANGELOG (here-doc hit 120 s timeout): set Bash timeout guidance in agent prompt | no |
| hook API | rich event set incl. `context` (modify messages before each LLM call), `input`, `session_stop` (S59) | CC hooks: PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop, PreCompact, SessionStart, etc. | everything except `context` and in-stream events maps; `context` rewrite needs a proxy | rewriting requests via proxy = NOT ALLOWED |
| cost/token | read default 300 lines + summary folding (S38), supersede pruning (S39), judge role small model (S63), +Nk budget (S65), cache warmer (S64) | FILE_READ_MAX_OUTPUT_TOKENS env, PreToolUse updatedInput | Read hook sets `limit` when absent (CC: updatedInput not verified); budget directive via UserPromptSubmit + statusline | cache warmer and subscription slow-mode headers = NOT ALLOWED (replays requests, mimics Claude Code client with subscription token) |

## Ranked ideas (value / effort)

1. `/planning` skill + hooks (see Plan mode) — high value, medium effort (3-4 days).
2. Generated-file edit guard hook (S37) — medium value, low effort (0.5 day); Rust in `ccc/guard.rs` neighbor.
3. Tool-call loop guard via PostToolUse state file: identical (tool, canonical args) x5 -> inject "do something different" (S35, S36) — medium value, low effort.
4. Mid-run todo nudge after N mutations without task update (S33) — medium value, low effort.
5. Goal-style `/goal` skill: objective, 5-field interview, completion audit prompt, token/attempt cap, driven by existing Stop gate (S41-S43) — high value, medium effort. The "binary success criteria + verification command + attempt cap" interview (S42) is the reusable part.
6. `orchestrate` rules into `/ship` and pm: subagents skip lint/format, orchestrator verifies once per phase, no yielding before closure, no MVP relabel (S45, S46) — medium value, low effort (prompt only).
7. Ask-discipline text (S30) into the ask gate: ask only for materially different tradeoffs, otherwise pick standard and say so — medium value, low effort.
8. Redact credential-shaped tokens in session-start digest and any memory write (S56) — medium value (org rule), low effort.
9. `/cleanse` skill: run repo checkers, group diagnostics per file by weight, one Haiku/Sonnet `task` per file group, verify (S61) — medium value, medium effort.
10. Read hook limiting whole-file reads (S38) — medium value, low-medium effort, needs CC feasibility check.

## Contradictions between sources
- plan doc says omp `/plan-yolo`, prewalk hand off on "first edit" (plan §3 #2, S26: `prewalk.ts:36-60`); code (S26) switches only on write/exec-tier action, not read-only device calls. Consistent but more precise than the plan doc.
- Plan doc cites omp @ b83200e; this clone is 7738a3f. Line numbers in the plan doc may not match.
- Approval default: tools/approval.ts says schema default `yolo` while fail-closed is `always-ask` when no settings (approval.ts:53-85): not a contradiction, but easy to misquote.

## Not found / not verified
- Claude Code docs were not fetched this run: every CC mechanism above needs a check (PreToolUse `updatedInput`, `additionalContext` on PostToolUse, whether hooks see permission mode, ExitPlanMode hook matching, plan file location setting, AskUserQuestion option fields such as preview).
- Whether omp guards bash in plan mode beyond the prompt: only a grep (S8).
- Rest of the plan-review overlay (annotation data model, keys) read only from the header comment (plan-review-overlay.ts:1-20) and call sites; `plan-toc.ts` not opened.
- Mnemopi, hindsight, sharpshooter, vibe mode, predict/composer prediction, speculation host, tts, irc, collab, ida, security-scan were not read beyond file names.
- Real-world speed numbers for any omp feature: none collected.
- A background `find` for a Claude Code changelog clone was started and never read; no claim here depends on it.
