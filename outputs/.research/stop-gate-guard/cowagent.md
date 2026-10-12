# CowAgent (zhayujie/CowAgent, MIT, commit aa5f4c9) - stop gate and command guard evidence
Read locally 2026-10-12, read-only, nothing executed. Paths relative to C:\Users\Admin\research\gate-guard\src\CowAgent. 1494 tracked files.

## Evidence table
| # | Claim | Source | Version | Confidence |
|---|---|---|---|---|
| S1 | Loop is `while turn < self.max_turns`; default 50 in ctor, config `agent_max_steps: 30` (initializer falls back to 20) | agent/protocol/agent_stream.py:259,991; config.py:313; bridge/agent_initializer.py:84 | aa5f4c9 | high |
| S2 | Turn ends ONLY when the model returns no tool_calls. No "final answer" text parsing, no reflection, no todo/plan completion check (grep for todo/checklist/reflect found nothing in the loop) | agent_stream.py:1028 (`if not tool_calls:`), 1101-1109 | aa5f4c9 | high |
| S3 | Empty reply handling: retry once inside _call_llm_stream; if still empty and turn>1, inject user message "请向用户说明刚才工具执行的结果或回答用户的问题。", call LLM again, then pop the injected prompt from history; else localized fallback apology | agent_stream.py:2100-2114, 1031-1076, 384-408 | aa5f4c9 | high |
| S4 | Max-step exit: if `turn >= max_turns and not finished_with_answer`, inject a temporary "you hit the step limit, summarize, do not call tools" prompt, one more LLM call, then remove prompt. `finished_with_answer` flag exists because an answer on the last turn must not be overwritten (regression test) | agent_stream.py:988-989,1291-1334; tests/test_agent_stream_max_turns.py:1-14 | aa5f4c9 | high |
| S5 | Loop detection (hash = md5 of sorted-json args, 8 hex chars): 3+ successful identical calls in last 10 history entries (turn>=3) append a user hint "工具已成功执行并返回结果。请基于这些信息向用户做出回复，不要重复调用相同的工具。" | agent_stream.py:812-817,1243-1265 | aa5f4c9 | high |
| S6 | Hard tool circuit-breakers in _check_consecutive_failures: same tool+args 5 consecutive calls (any outcome) stop; same args 3 consecutive failures stop; same tool 6 failures (any args) stop; 8 failures = critical abort with apology. History capped at last 50 | agent_stream.py:819-880, 884-890 | aa5f4c9 | high |
| S7 | NO heuristic found for "model announced more work but stopped" or "asked a routine permission question". grep for "shall I / do you want me to / 是否继续 / 需要我继续" over *.py in agent/ and bridge/ returned nothing. A text-only reply is always treated as done (subject to steering) | agent_stream.py:1028-1109; grep negative | aa5f4c9 | medium-high (negative result, limited scope) |
| S8 | stop_reason is captured and emitted in turn_end events but never used to decide continue; only `finish_reason in ("length","max_tokens")` is used to flag truncated tool-call JSON | agent_stream.py:214-217,1005,1101-1109 | aa5f4c9 | high |
| S9 | Mid-task user cancel: threading.Event registry keyed by request_id and session_id; `/cancel` fast-path bypasses the per-session queue (`_BYPASS_QUEUE_COMMANDS = ("/cancel",)`), matched by exact `stripped` equality, NOT free text. Comment says /stop avoided to not collide with `cow stop` CLI | channel/chat_channel.py:513-515,543-547,567-594; agent/protocol/cancel.py:20-121 | aa5f4c9 | high |
| S10 | Cancel is polled at: top of each turn (994), between tool calls in a turn (1138), mid LLM stream every N chunks (1679), while awaiting parallel tools (2235); bash tool receives `cancel_event` (2374). On cancel `AgentCancelledError` -> _handle_cancelled repairs history so tool_use/tool_result stay paired, returns partial text or "_(Cancelled)_" | agent_stream.py:369-376,994,1138,1342-1344,1679,2235,2374; cancel.py:19-26 | aa5f4c9 | high |
| S11 | /steer: separate bounded inbox (16 msgs, 8000 chars). Accepted only while exactly one run is active; idle session never starts a run. Drained at turn top, after LLM stream (skipped tool calls get synthetic is_error tool_result "Skipped because the user redirected the active task."), between tools, and before finishing (atomic close_if_empty closes a race). Injected as user text "[Steering update for the active task]..." | agent/protocol/steer.py:12-70; agent_stream.py:420-476,1000-1025,1136-1150; chat_channel.py:550; tests/test_agent_steering.py:81-323 | aa5f4c9 | high |
| S12 | Bash tool shell guard 1 (on when `safety_mode`, default True): `command.lower().split()` whitespace tokens (NOT shlex). Blocks only: `rm` with recursive+force (short clusters or long flags, any order) then target exactly `/` or `/*`; `dd` with `if=/dev/zero`; regex `\b(shutdown\|reboot\|halt\|poweroff)\b`. Block returns ToolResult.fail telling the model to ask the user to confirm first | agent/tools/bash/bash.py:87-88,158-163,558-603; tests/test_bash_rm_safety_flags.py:12-30 | aa5f4c9 | high |
| S13 | Bash credential guard: `re.search(r'\.cow[/\\]\.env', command)` denies the command (both slash kinds). Progress output redaction: regex `(?i)\b(API_KEY\|TOKEN\|PASSWORD\|AUTHORIZATION)\s*=\s*[^\s]+` -> `=[REDACTED]`, plus literal replace of any .env value >= 6 chars | bash.py:152-156,545-556 | aa5f4c9 | high |
| S14 | File-tool credential guard: realpath + normpath compare to ~/.cow/.env (symlink-resolved), and regex `^/proc/(\d+\|self\|thread-self)/environ$`. Motivation in file: guarding only `read` left edit-diff output as a bypass (issues #2863, #2913 cited) | agent/tools/utils/credentials.py:1-57 | aa5f4c9 | high |
| S15 | Permission modes read-only / workspace-write / full-access (default full-access for compatibility). Enforced in `_execute_tool` via `_permission_denial` -> `check_tool_call`; wrapped in try/except so a broken check FAILS OPEN | agent/permission/policy.py:1-30,595-625; agent_stream.py:2295,2451-2480 | aa5f4c9 | high |
| S16 | Command parsing = Python `shlex.shlex(posix=True, punctuation_chars=True)`, whitespace_split; segments split on `; && \|\| \| & \|& ( ) { } \n`; backticks rewritten to `$(...)`; `<(..)`/`>(..)` bodies extracted by a quote-aware scanner and classified as their own segments first; unlexable line => read-only DENY (fail closed) but workspace-write ALLOW (fail open, documented "best effort") | policy.py:268-368 (collect/parse), 681-690 (read-only deny), `_check_bash_workspace_write` "return ALLOW" on None segments | aa5f4c9 | high (line ranges approximate for the last two) |
| S17 | Command-name normalisation: strips leading `VAR=x`, wrappers (env nohup time timeout nice ionice stdbuf xargs command builtin exec watch setsid) and their leading `-` flags, basename, lowercase, strips `.exe`. So `env FOO=1 nohup rm -rf /` classifies as rm | policy.py `_WRAPPER_COMMANDS`, `_command_name` (~lines 255-262, 371-396) | aa5f4c9 | high |
| S18 | Read-only mode = ALLOWLIST (fail closed on unknown command) incl. Windows names dir/findstr/where/ver/systeminfo/tasklist/chdir/cd; per-command write-flag tables (find -delete/-exec/-fprint..., fd --exec, sort -o/--output, sed -i/--in-place and `w` command regex, xxd -r, awk system()/getline\|/print > "..."); git has read-subcommand allowlist plus write-flag lists, global options (-C, -c) skipped, `git branch name`/`git tag name` = create => deny, `git config` read only with --get/--list | policy.py:144-210,640-735 | aa5f4c9 | high |
| S19 | Workspace-write = path containment: redirect targets and operands of `rm rmdir mv cp rsync dd truncate shred ln mkdir touch chmod chown tee sed zip tar del erase move copy ren rd md ...` resolved with expandvars/expanduser/realpath and `os.path.commonpath` against roots (cwd + temp + extras; ValueError for different Windows drives = outside); destination-only logic for cp/mv/ln; `dd of=`; protected files (mcp.json, config.json, .env, session settings) refused even inside roots; sudo/doas/su/runas/pkexec denied | policy.py `_PATH_MUTATING_COMMANDS`, `_inside_roots`, `_check_bash_workspace_write` (~lines 243-283, 520-546, 786-856) | aa5f4c9 | high |
| S20 | Windows/PowerShell: policy.py defines `_IS_WIN` but never uses it (only line 66). NO PowerShell parser in permission code. Bash tool on Windows runs cmd.exe (description says "not ... PowerShell") and only adds hints for Unix-isms; Remove-Item, rd /s /q, del /f /s, format, Stop-Computer are NOT in guard 1. PowerShell appears only as a search_files backend | policy.py:66; bash.py:30,45,607-636; search_files.py:461,547 | aa5f4c9 | high |
| S21 | Relevant tests: test_bash_rm_safety_flags.py (rm root variants + negatives `rm -f /`, `rm --recursive /`, `rm -rf /tmp/x`); test_permission_shell_substitution.py (backtick and process-substitution bypass lists for read-only and workspace-write); test_permission_flag_driven_writes.py, test_permission_git_read_only.py, test_permission_git_global_options.py, test_permission_protected_files.py; test_agent_steering.py (11 tests); test_agent_stream_max_turns.py; cancel tests (test_chat_service_cancel, test_parallel_tool_cancel, test_web_sse_cancel, test_subagent_parent_cancel, test_chat_channel_cancel_deadlock). No eval corpus for premature-stop or permission-question detection | tests/ (ls) | aa5f4c9 | high |

## Key snippets
- Termination (agent_stream.py:1028): `if not tool_calls:` ... `finished_with_answer = True; break` (~1109-1110) after steering drain and `_close_or_apply_final_steering()`.
- Steer skip results (agent_stream.py:435-441): `"content": "Skipped because the user redirected the active task.", "is_error": True`.
- Root-rm guard (bash.py:566-593): tokenised by `command.lower().split()`; comment "Tokenize to avoid substring false positives (e.g. `rm -rf /tmp/x` must not match `rm -rf /`)".
- Fail-open note (agent_stream.py:2455-2457): "a broken permission check must not take the conversation down with it, so an error here falls through to the historical unrestricted behavior."
- Honesty note (policy.py:24-30): "these checks are argument-level, not an OS sandbox ... bash is best effort ... anyone who needs a hard boundary wants a container."

## Ideas worth borrowing (my assessment, not from the source)
Stop gate (native, no LLM call):
1. CowAgent has NO premature-stop heuristic (S2, S7), so that part must be designed from scratch (regex on last assistant text for announced-next-step phrases, routine permission questions, open todo list). Do not cite CowAgent as validating it.
2. Loop breakers keyed on md5(sorted-json args) over a rolling history of 50 (S5, S6): cheap, deterministic. The Stop hook needs its own cap (for example max 1-2 forced continuations per session via stop_hook_active or a state file), analogous to max_turns and finished_with_answer.
3. Final-answer moment races with user input (close_if_empty, S11): in a hook, a pending new user message must beat any gate.
4. Injected nudge prompts are removed from persisted history (S3, S4); keep a hook continuation reason short and one-shot.
5. `allow_empty_response` is a gate-bypass analogue for notify-only or scheduled runs.
Command guard:
1. shlex punctuation_chars tokenizer + segment split + wrapper/VAR=x/.exe unwrapping + backtick and `<()` extraction, per-segment checks (S16, S17). Better than substring regex. Fail closed on unlexable for a destructive guard.
2. rm flag handling for `-rf`, `-r -f`, `--recursive --force` and the test matrix of spellings (S12, S21).
3. Credential path guard with symlink realpath and /proc/*/environ, plus the lesson that every content-returning tool needs the same check (S14).
4. Per-command write-form tables (find -delete, sed -i, sort -o) (S18) for a read-only profile.
5. Deny message written for the model ("Do not retry the same call: use a route the current mode allows", policy.py ~566-580) reduces retry loops.
6. commonpath containment with ValueError handled for different drives (S19).

## What NOT to borrow
- rm guard matches only `/` or `/*` and uses naive `.split()`: misses `rm -rf ~`, `$HOME`, `.`, `/home`, quoted `"/"`. Too narrow.
- shutdown/reboot `\b` regex over the whole command string false-positives on `echo reboot`, `git log --grep=reboot`.
- Fail-open on exceptions and on unparsable workspace-write commands (S15, S16): wrong default for a safety guard.
- No Windows/PowerShell/cmd destructive coverage (S20). We must write our own (Remove-Item -Recurse -Force, rd /s /q, del /f /s /q, format, Stop-Computer, Clear-Disk, git clean -fdx, git reset --hard). None of these exist in CowAgent.
- MCP tool-name verb heuristic (policy.py ~127-140): name guessing, irrelevant to a Bash hook.
- Package managers deliberately unguarded (policy.py ~236-240): their scope choice, not ours.
- `/cancel` is an exact-match command only; no natural-language "stop/wait" detection (S9). Claude Code handles interrupt itself; nothing to port.

## Contradictions between sources
- Default max steps differs by place: ctor 50 (agent_stream.py:259), config 30 (config.py:313), initializer fallback 20 (agent_initializer.py:84).
- Bash tool description says "For destructive commands out of workspace, explain and confirm first" (bash.py:51) but code enforces only the narrow set in S12; the rest relies on the model.

## Not found / not verified
- No eval corpus or benchmark for premature-stop, permission-question, or reflection behavior. I did not inspect agent/prompt/ or docs/ or skills/ markdown, so prompt-level rules (for example "do not ask for confirmation") are NOT verified absent.
- Not read: agent/subagent, agent/multiagent, evolution/executor.py (test_evolution_safety.py exists), tools other than bash/credentials.
- The "shall I / 是否继续" grep covered *.py under agent and bridge only.
- Behavior of the `.split()` guard under all inputs is from reading, not execution (per instruction).
- Line ranges marked "~" were not re-verified individually.
