# Stop gate + destructive-command guard for 8sync ccc — design brief (2026-10-12)

## Recommendations (what 8sync ships)

### Stop gate (`crates/cli/src/verbs/ccc/gate.rs`)
1. **Structure before words.** Keep the checks that come first: `stop_hook_active` → allow, and a running entry in `background_tasks` → allow. The Stop input carries `stop_hook_active`, `last_assistant_message` and `background_tasks` [3]. Claude Code also caps consecutive Stop blocks at 8 (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) [3]. Our gate allows on `stop_hook_active`, so it forces at most one continuation per stop.
2. **Read the user's stop from the user, not from Claude's paraphrase.** No hook field reports that the user said stop. Stop does not fire on a user interrupt, and user text only appears in UserPromptSubmit or the transcript [3]. The gate reads the last real user message from the tail of `transcript_path`. A short message whose words include stop/wait/hold/pause/dừng/chờ/đợi/khoan ends the turn. A fallback quote rule still applies when Claude quotes the stop words and attributes them to the user ("you said", "bạn bảo"…). Backticks never count, because they mark code (`stop` is a function name in this repo).
3. **Plan check uses a narrow risk list.** "Next I'll …" blocks unless the last paragraph is about secrets or destructive, outward-facing or paid actions (`RISKY`). The broad `JUSTIFIED` list (which includes `or`, `which`, `remove`, `token`, `merge`) applies only to questions. This fixes "Next I'll remove the dead code" and "…clippy or fmt" ending the turn.
4. **Word-boundary matching everywhere.** `PROCEED` uses the same `mentions()` as `JUSTIFIED`, so `fix` ≠ `prefix` and `start` ≠ `restart`. Vietnamese entries are multi-word (`giá gói`, `báo giá`, `khóa api`) so that `đánh giá` (review) and `khóa học` (course) do not match.
5. **Corpus seeds from OMP's judge prompt.** These count as unexpected stops: "Let me run the tests next.", "I'll fix that now.", "Doing that now.", "Should I do that for you?". These do not: "I've completed the task.", "Is there anything else I can help with?" [2]. They become test rows, together with phrases ending in "… now" or "… next".
6. **No LLM.** OMP's text-stop judge is an LLM and only runs in `smart` mode; its default `mechanical` mode only retries empty stops [2]. Forge only re-prompts on pending todos [2]. CowAgent ends the turn when the model returns no tool calls [1]. None of them has a no-LLM detector for "announced work, then stopped", so ours stays native and conservative, and it allows the stop on any doubt or parse error.

### Guard (`crates/cli/src/verbs/ccc/danger.rs`)
7. **Keep the tokenizer and the ask-on-unknown default.** Official examples are regex or substring (`rm\s+-rf`) [3]. OMP's critical patterns are POSIX regexes and are inactive in its default `yolo` mode [2]. Forge's restricted mode globs the whole command [2]. CowAgent's rm check covers only `/` and `/*` [1]. dcg and cc-safety-net fail open on input they cannot parse [4]. Our lexer covers here-docs, nested shells and PowerShell; none of the guards above handles PowerShell [1][2][3].
8. **Resolve literal assignments made earlier in the same command.** Example: `out=build; rm -rf "$out"`. The variable is recorded only when the assignment is a statement of its own at top level (not piped, not backgrounded, not inside a group) and its value is a literal (no `$`, backtick, glob or `~`). Anything else stays "known only at run time" → ask. `for f in *.tmp; do rm "$f"; done` still asks; this is listed under the README limits.
9. **Test the hook wiring, not only the analyser.** Run `guard::check` with `tool_name: "PowerShell"` (deny) and with an ask case (`git reset --hard`). Run `verify::stop` with a "Next I'll…" message (block).
10. **Answer `deny` for the catastrophic cases, `ask` for doubtful ones.** A hook `ask` forces a prompt even in auto mode and becomes a denial under `-p`, and `deny` takes precedence over `ask`/`allow` [3]. A timeout fails open, so the guard must stay fast (~12 ms measured).

## Evidence by source
| Source | Turn-end logic | Command safety | PowerShell |
|---|---|---|---|
| CowAgent aa5f4c9 [1] | stops when there are no tool_calls; max_turns; identical-call loop breakers; `/cancel` event | rm `/`+`/*`, dd, shutdown regex; shlex segment parser in permission modes, fail-open in workspace-write | none |
| oh-my-pi 7967984 [2] | todo reminder (cap 3), "awaiting user answer" regex, LLM judge only in `smart` | ~20 POSIX regexes, `override:true`, off in `yolo`; opt-in git guard on brush-parser | none |
| ForgeCode 8703dec [2] | `End` hook re-prompts on pending todos (dedup by todo set) | allow/deny/confirm globs on the whole string, default allow-all | none (cmd /C) |
| Claude Code docs + plugins [3] | Stop input fields, block cap 8, ralph-loop max_iterations, security-guidance own counter | hooks-guide / hookify regex examples | matcher `Bash\|PowerShell` needed |
| dcg, cc-safety-net [4] | — | regex tiers + AST for heredocs; fail-open default; temp and cwd allowlists | not documented |

## Caveats
- Stop behaviour under `claude -p` is not documented explicitly; the evidence is indirect [3].
- Not verified: dcg's and cc-safety-net's test counts and performance (READMEs only) [4].
- The transcript can lag behind `last_assistant_message` [3]. That is why the gate reads only the last *user* entry from it, and allows the stop if it cannot read the file.

## Sources
1. CowAgent notes — outputs/.research/stop-gate-guard/cowagent.md (zhayujie/CowAgent @aa5f4c9, MIT)
2. oh-my-pi + ForgeCode notes — outputs/.research/stop-gate-guard/omp-forge.md (oh-my-pi @7967984, forge @8703dec)
3. Claude Code notes — outputs/.research/stop-gate-guard/claude-code.md (https://code.claude.com/docs/en/hooks, anthropics/claude-code @3deb873, claude-plugins-official @f359d43)
4. Public guards notes — outputs/.research/stop-gate-guard/public.md (github.com/Dicklesworthstone/destructive_command_guard, github.com/kenryu42/claude-code-safety-net)
