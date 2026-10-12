# Stop gate + destructive-command guard for 8sync ccc — design brief (2026-10-12)

Status: implemented in the working tree after v0.66.0, three reviewer rounds (round 3: MERGEABLE, its SHOULDs fixed); tests named below, full suite `cargo test` 249/249.

## Recommendations (what 8sync ships)

### Stop gate (`crates/cli/src/verbs/ccc/gate.rs`)
1. **Structure before words.** The first checks allow the stop: `stop_hook_active`, then any `background_tasks` entry that is still running. The Stop input carries `stop_hook_active`, `last_assistant_message` and `background_tasks` [3]. Claude Code caps consecutive Stop blocks at 8 (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) and resets the count on a tool call [3]. Because the gate allows on `stop_hook_active`, it never forces two continuations in a row without Claude doing work in between.
2. **Read the user's stop from the user.** No documented hook field reports that the user said stop. Stop does not fire on a user interrupt, and user text only appears in UserPromptSubmit or the transcript [3]. The gate reads the tail (512 KiB) of `transcript_path` and takes the last `user` entry whose `origin.kind` is `human`, or that has no `origin` at all. Tool results, task notifications and `isMeta` skill bodies are skipped. If that message starts with a stop/wait word (stop, wait, hold on, pause, dừng, tạm dừng, khoan, chờ, đợi, ngừng, thôi), the turn ends. An unreadable file changes nothing. Fallback: the turn also ends when Claude quotes the stop word and attributes it to the user ("you said \"stop\"", "bạn bảo “dừng”"). Backticks never count, because they mark code. Test: `the_users_last_message_saying_stop_ends_the_turn`.
3. **Plans are judged against a narrow risk list.** "Next I'll …" and "I'll fix that now." / "Let me run the tests next." keep the turn going unless the last paragraph names a secret or a destructive, outward-facing or paid action (`RISKY`), or the line is a hand-off. Hand-offs: "let me know", "once the…", "for now", "I'll need", "I'll wait/stop/leave", "summarise", "khi bạn…". The broader `JUSTIFIED` list (which includes ` or `, `which`, `remove`, `token`) applies only to questions.
4. **Word-boundary matching.** `PROCEED` and the lists use `mentions()`, so `fix` ≠ `prefix` and `start` ≠ `restart`. Vietnamese entries are phrases (`giá gói`, `báo giá`, `khóa api`), so `đánh giá` (review) and `khóa học` (course) do not match.
5. **Corpus seeds from OMP's judge prompt** [2]. Unexpected stops: "Let me run the tests next.", "I'll fix that now.", "I should do the same for the JS eval worker. Doing that now.", "Should I do that for you?". Not stops: "I've completed the task.", "Is there anything else I can help with?", "The fix is done and tests pass.". These are table rows in `unfinished_plans_and_routine_go_ahead_questions_block` and `answers_summaries_extras_and_justified_questions_end_the_turn`, next to the reviewer's false-positive rows.
6. **No model call.** OMP judges text stops with a small model, and only in `smart` mode; its default `mechanical` mode retries only stops with no visible message [2]. Forge re-prompts only on pending todos [2]. CowAgent ends a turn when the model returns no tool calls [1]. None of them has a no-model detector for "announced work, then stopped". So ours stays native and conservative: any doubt lets the turn end.

### Guard (`crates/cli/src/verbs/ccc/danger.rs`)
7. **Keep the tokenizer; deny the catastrophic, ask on doubt.** Claude Code's examples are regex or substring matches [3]. OMP's critical patterns are POSIX regexes and are ignored in its default `yolo` mode [2]. Forge globs the whole command, and only in restricted mode [2]. CowAgent's rm check covers `/` and `/*` [1]. dcg and cc-safety-net v0.5.0 fail open on input they cannot parse [4]. Our lexer handles quotes, here-docs, nested shells and PowerShell, and adds a raw-text backstop for root, home and force-push. When it cannot see the target, it asks.
8. **Resolve literals only in straight-line Bash.** In `out=build; rm -rf "$out"`, the target is resolved. In `X=/; rm -rf "$X"`, the command is denied. A variable is recorded only from an assignment-only statement that surely runs: top level, after the start or `;`, not piped, not in a group. Its value must be a literal: no `$`, backtick, glob, `~`, `{` or whitespace. Some constructs turn resolution off for the whole command: loops, functions, `+=`, `IFS`, `eval`, `source`/`.`, `declare`/`local`/`export`/`read`/`printf`/`let`/`unset`. Words holding a script for another shell (whitespace or `;|&`) are never rewritten. Round 2 of the review found bypasses through nested `bash -c`, `+=`, loops, `IFS`, functions, `source`, `eval` and namerefs. Each is now a test row in `literal_variables_set_earlier_in_the_command_are_resolved`. `eval "$(…)"` asks unless it runs a known shell-init generator.
9. **Test the hook wiring.** Tests: `shell_commands_get_deny_ask_or_pass_through_the_hook` (PowerShell deny, `git reset --hard` ask, everyday pass, through `guard::check`) and `stop_runs_the_native_gate_when_the_build_is_fine` (`verify::stop` → gate block).
10. **`deny` for the catastrophic, `ask` for doubt.** A hook `ask` prompts even in auto mode and becomes a denial under `-p`. `deny` takes precedence over `defer`/`ask`/`allow` [3]. A timed-out command hook does not block by default [3], so the guard must stay fast. Measured 2026-10-12 on a release build, 30 runs: 9.3 ms median (p90 10.8), of which `8sync --version` alone takes 8.6 ms.

## Evidence by source
| Source | Turn-end logic | Command safety | PowerShell |
|---|---|---|---|
| CowAgent aa5f4c9 [1] | stops when there are no tool_calls; max_turns; identical-call loop breakers; `/cancel` event | rm `/`+`/*`, dd, shutdown regex; shlex segment parser in permission modes; unlexable command = deny in read-only, allow in workspace-write; whole permission check fails open on exception | none |
| oh-my-pi 7967984 [2] | todo reminder (cap 3), "awaiting user answer" regex, small-model judge only in `smart` | ~20 POSIX regexes, `override:true`, ignored in `yolo` (the default); opt-in git guard on brush-parser | none |
| ForgeCode 8703dec [2] | `End` hook re-prompts on pending todos (dedup by todo set) | allow/deny/confirm globs on the whole string (restricted mode only, off by default), default policy allow-all | none (cmd /C) |
| Claude Code docs + plugins [3] | Stop input fields, block cap 8, ralph-loop max_iterations, security-guidance own counter | hooks-guide / hookify regex and substring examples | hooks-guide has a substring PowerShell variant; matcher `Bash\|PowerShell` needed |
| dcg [4] | — | regex tiers + tree-sitter/ast-grep for heredocs and inline scripts; fail-open default; temp-dir allowances in `core.filesystem` | README mentions a `windows` pack; scope not read |
| cc-safety-net [4] | — | parser (name not found); allows temp and cwd-relative `rm -rf` and fails open by default (v0.5.0 README only); Strict = fail-closed | not documented |

## Caveats
- Stop behaviour under `claude -p` is not documented explicitly; the evidence is indirect [3].
- Not verified: dcg's and cc-safety-net's test counts and performance (READMEs only; dcg's "80+ tests" is one section) [4].
- The transcript can lag behind `last_assistant_message` [3]. That is why the gate reads only the last *user* entry from it and lets the turn end if it cannot read the file.
- cc-safety-net details come from the v0.5.0 README; the current README omits them [4].

## Sources
1. CowAgent notes — outputs/.research/stop-gate-guard/cowagent.md (zhayujie/CowAgent @aa5f4c9, MIT)
2. oh-my-pi + ForgeCode notes — outputs/.research/stop-gate-guard/omp-forge.md (oh-my-pi @7967984, forge @8703dec)
3. Claude Code notes — outputs/.research/stop-gate-guard/claude-code.md (https://code.claude.com/docs/en/hooks, anthropics/claude-code @3deb873, claude-plugins-official @f359d43)
4. Public guards notes — outputs/.research/stop-gate-guard/public.md (github.com/Dicklesworthstone/destructive_command_guard, github.com/kenryu42/claude-code-safety-net)

## Verification table
Snapshot of the verifier pass, which ran against the code *before* the changes above: its `gate.rs`/`danger.rs` line numbers and "today" statements describe that earlier state; the source-side rows (docs, clones) stand as checked. Checked 2026-10-12, read-only (no code run). Local clones: C:\Users\Admin\research\gate-guard\src\; saved docs: C:\Users\Admin\research\gate-guard\docs\ (hooks.md, hg.md).

| claim | nguồn | kết quả |
|---|---|---|
| Stop input has `stop_hook_active`, `last_assistant_message`, `background_tasks` | docs/hooks.md:2679 (re-read) | OK |
| Cap of 8 consecutive blocks, resets on tool call, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | docs/hooks.md:2683; hg.md:1011,1022 | OK |
| Gate allows on `stop_hook_active` and on running `background_tasks` | gate.rs:22-28 | OK |
| "Forces at most one continuation per stop" | gate.rs:22 + hooks.md:2679 (inference) | FIXED (qualified to "chain"; `stop_hook_active` after tool calls UNVERIFIED) |
| Stop does not fire on user interrupt | docs/hooks.md:2671-2673 | OK |
| No hook field for "user said stop"; user text only via UserPromptSubmit/transcript | claude-code.md S15 (grep of hooks.md; absence) | OK (medium: absence of evidence) |
| Gate reads last user message from transcript tail; keyword list | gate.rs (no transcript read; quote-based only) | FIXED (marked planned) |
| Transcript entry shape | read from this session's own JSONL: user entries carry `origin.kind` (`human`, `task-notification`), tool results are `tool_result` parts, skill bodies `isMeta: true` | OK (shape); "user entry written by Stop time" not tested live |
| Backticks count as a quote today | gate.rs:86 | OK (diagnosis); fix marked planned |
| `JUSTIFIED` contains ` or `, `which`, `remove`, `token`, `merge`; used in plan check | gate.rs:34,47,73-80 | OK |
| "Next I'll remove dead code" / "clippy or fmt" end the turn today | gate.rs code reading (not run) | OK (by reading) |
| `RISKY` narrow list | design only | FIXED (marked planned) |
| `PROCEED` is substring (`fix`/`prefix`, `start`/`restart`) | gate.rs:57-63 | OK |
| Non-ASCII `mentions` is substring (`giá`/`đánh giá`, `khóa`/`khóa học`) | gate.rs:94-96, 78 | OK |
| OMP judge true/false examples | omp-forge.md S6; oh-my-pi/.../prompts/judge/unexpected-stop.json (re-read) | OK |
| "Doing that now." as a standalone example | json has "I should do the same for the JS eval worker. Doing that now." | FIXED |
| OMP text-stop judge is an LLM, only in `smart`; default `mechanical` | settings.ts:1052-1070 (default "mechanical"; "small model"); unexpected-stop-classifier.ts comment mentions keyword judges | FIXED (small-model: LLM or on-device classifier; mechanical = no visible message) |
| Forge re-prompts only on pending todos | omp-forge.md S26, S29 (absence medium-high) | OK |
| CowAgent ends turn when no tool_calls | cowagent.md S2 (agent_stream.py:1028) | OK |
| "None has a no-LLM detector for announce-then-stop" | omp-forge.md S6, S29; cowagent.md S7 (grep limited) | FIXED (qualified as "none found in code read") |
| Gate allows on any doubt/parse error | gate.rs:29; verify.rs:83 (`.ok()?`) | OK |
| Official examples are regex/substring (`rm\s+-rf`) | claude-code.md S27-S29; hg.md:217-225 | OK |
| OMP critical patterns POSIX regex; inactive in default `yolo` | approval.ts:80, 200-201, 256-266; settings.ts:315; bash.ts:178 | OK |
| Forge restricted mode globs the whole command | policies/rule.rs:79-106 (`glob::Pattern::matches` on full string); `*` over `&&` not confirmed | OK (whole-string match confirmed; `&&` behaviour inferred) |
| CowAgent rm covers only `/` and `/*` | bash.py:575-593 | OK |
| dcg fails open on unparseable input | README (re-fetched): "The default is fail-open (unparseable input is allowed)" | OK |
| cc-safety-net fails open on unparseable input | v0.5.0 README: "By default, unparseable commands are allowed through."; current README silent | FIXED (v0.5.0 only; current UNVERIFIED) |
| Our lexer covers here-docs, nested shells, PowerShell | danger.rs:31,177,1308, tests 2180-2216 | OK |
| "None of the guards above handles PowerShell [1][2][3]" | hg.md:167 (PowerShell variant); public.md S4 (dcg windows pack) | FIXED |
| Hook `ask` forces prompt in auto mode; denied under `-p`; deny > defer > ask > allow | docs/hooks.md:1903-1925; headless.md:319-326 | OK |
| Timeout fails open | docs/hooks.md:874-878 (`onFailure: "block"` exists) | FIXED (default only) |
| Guard latency | measured 2026-10-12, release build, 30 runs: guard 9.3 ms median / 10.8 p90, `--version` 8.6 ms (process start) | OK (docs updated from "~12 ms") |
| Item 8: literal-assignment resolution | danger.rs `Ctx` (52-59), `dynamic()` (1973-1979): no variable tracking | FIXED (marked planned) |
| `for f in *.tmp …` still asks | danger.rs test row added; README Limits now lists it | OK |
| Item 9: PowerShell deny / `git reset --hard` ask / `verify::stop` block tests | guard.rs, verify.rs: no such tests | FIXED (marked planned) |
| Table: CowAgent row | cowagent.md S1-S6, S12, S15-S16 | OK |
| Table: OMP row (judge wording, "off in yolo") | omp-forge.md S5, S13-S15, S21 | FIXED (judge wording; "default yolo") |
| Table: Forge row | omp-forge.md S25-S26, S32-S34 | OK |
| Table: Claude Code row | claude-code.md S2-S3, S24, S28-S33 | OK |
| Table: dcg / cc-safety-net row (temp and cwd allowlists, PowerShell) | public.md S2, S4, S5, S8 | FIXED (split by tool; cwd allowance and fail-open are safety-net v0.5.0; dcg windows pack) |
| `-p` Stop behaviour not explicit; indirect evidence | claude-code.md S16, N1 | OK |
| dcg/safety-net test counts and performance not verified | public.md S1, S6, S9 | OK |
| Transcript can lag `last_assistant_message` | docs/hooks.md:2685 (re-read) | OK |
| Source commits aa5f4c9 / 7967984 / 8703dec / 3deb873 / f359d43 | `git rev-parse` in each clone | OK |
| CowAgent license MIT | LICENSE header (MIT text) | OK |
