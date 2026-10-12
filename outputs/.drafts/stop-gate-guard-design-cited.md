# Stop gate + destructive-command guard for 8sync ccc — design brief (2026-10-12)

Status note (added by verifier): `crates/cli/src/verbs/ccc/gate.rs` and `danger.rs` are uncommitted. On disk, `gate.rs` still has the behaviour described as the problem in items 2-4 (no transcript read, backtick counted as a quote, broad `JUSTIFIED` on the plan check, substring `PROCEED`). Items marked **[planned]** are design decisions that are not in the code yet; the rest describe code or sources that were checked.

## Recommendations (what 8sync ships)

### Stop gate (`crates/cli/src/verbs/ccc/gate.rs`)
1. **Structure before words.** Keep the checks that come first: `stop_hook_active` → allow, and a running entry in `background_tasks` → allow (`gate.rs:22-28`). The Stop input carries `stop_hook_active`, `last_assistant_message`, `background_tasks` (and `session_crons`) [3]. Claude Code also caps consecutive Stop blocks at 8, and the count resets each time Claude calls a tool (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) [3]. Our gate allows on `stop_hook_active`, so it forces at most one continuation per consecutive stop-hook chain. [Not verified: whether `stop_hook_active` is still `true` on a later stop after Claude called tools in the continuation; the docs only say it is `true` "when Claude Code is already continuing as a result of a stop hook" [3]. Because the platform cap resets on tool calls, it does not bound a loop where each continuation calls a tool [3].]
2. **Read the user's stop from the user, not from Claude's paraphrase.** **[planned]** No documented hook field reports that the user said stop (absence of evidence, checked against the hooks page [3]). Stop does not fire on a user interrupt, and user text is observable only via UserPromptSubmit or the transcript [3]. The gate will read the last real user message from the tail of `transcript_path` **[planned; today `gate.rs` reads no transcript]**. A short message whose words include stop/wait/hold/pause/dừng/chờ/đợi/khoan ends the turn **[planned]**. A fallback quote rule still applies when Claude quotes the stop words and attributes them to the user ("you said", "bạn bảo"…) **[planned; today the rule is quote-marks only, `gate.rs:84-88`]**. Backticks never count, because they mark code (`stop` is a function name in this repo) **[planned; today `gate.rs:86` still lists the backtick pair as a quote, so "`stop`" ends the turn]**. [UNVERIFIED: the transcript JSONL entry shape (how a real user message is told apart from a tool-result entry) and whether the current turn's user entry is already written at Stop time; the notes did not read the transcript format [3].]
3. **Plan check uses a narrow risk list.** **[planned]** "Next I'll …" blocks unless the last paragraph is about secrets or destructive, outward-facing or paid actions (`RISKY`). The broad `JUSTIFIED` list (which includes ` or `, `which`, `remove`, `token`, `merge`; `gate.rs:73-80`) applies only to questions. Today `JUSTIFIED` is applied to the plan check (`gate.rs:34,47`), so "Next I'll remove the dead code" and "…clippy or fmt" end the turn (read from the code, not run); the change fixes that.
4. **Word-boundary matching everywhere.** **[planned]** `PROCEED` will use the same `mentions()` as `JUSTIFIED`. Today `PROCEED` uses `low.contains` (`gate.rs:57-63`), so `fix` matches `prefix` and `start` matches `restart`. Vietnamese entries will be multi-word (`giá gói`, `báo giá`, `khóa api`) because `mentions()` matches non-ASCII entries as plain substrings (`gate.rs:94-96`), so today `giá` matches `đánh giá` (review) and `khóa` matches `khóa học` (course).
5. **Corpus seeds from OMP's judge prompt.** These count as unexpected stops: "Let me run the tests next.", "I'll fix that now.", "Doing that now." (the source example is "I should do the same for the JS eval worker. Doing that now."), "Should I do that for you?". These do not: "I've completed the task.", "Is there anything else I can help with?" [2] (`prompts/judge/unexpected-stop.json`). They become test rows **[planned]**, together with phrases ending in "… now" or "… next".
6. **No LLM.** OMP's text-stop judge is a small-model judge (an LLM or an on-device classifier) and only runs in `smart` mode; its default `mechanical` mode only retries stops with no visible assistant message [2]. Forge only re-prompts on pending todos [2]. CowAgent ends the turn when the model returns no tool calls [1]. In the code read, none of them has a no-LLM detector for "announced work, then stopped" (absence results; CowAgent's grep covered `*.py` under `agent/` and `bridge/` only, and its prompts were not read) [1][2], so ours stays native and conservative, and it allows the stop on any doubt or parse error (`gate.rs:29`, `verify.rs:83`).

### Guard (`crates/cli/src/verbs/ccc/danger.rs`)
7. **Keep the tokenizer and the ask-on-unknown default.** Claude Code's examples are regex or substring: the hooks-guide `rm -rf` substring check and hookify's `rm\s+-rf` [3]. OMP's critical patterns are POSIX regexes and are inactive in its default `yolo` mode [2] (`tools/approval.ts:80`, `config/settings.ts:315`, `approval.ts:200-201,256-266`). Forge's restricted mode (off by default) matches each rule's glob against the whole command string [2] (`forge_domain/src/policies/rule.rs:79-106`; that `*` also spans `&&` is inferred, not confirmed from the `glob` crate). CowAgent's rm check covers only `/` and `/*` [1]. dcg fails open on unparseable input by default [4]; cc-safety-net's README at v0.5.0 says "By default, unparseable commands are allowed through" and offers a fail-closed Strict mode [4] (its current README does not state this; current behaviour not verified). Our lexer covers here-docs, nested shells (`bash -c`, `pwsh -Command`, `cmd /c`) and PowerShell (`danger.rs:31`, tests at `danger.rs:2180,2199`). Of the guards read, only Claude Code's hooks-guide (a substring PowerShell variant) [3] touches PowerShell; CowAgent and OMP/Forge have none [1][2]. dcg's README mentions a `windows` pack whose scope was not read [4].
8. **Resolve literal assignments made earlier in the same command.** **[planned; `danger.rs` has no variable tracking yet: `Ctx` holds only cwd/home/temps/windows/fs and `dynamic()` rejects any `$`]** Example: `out=build; rm -rf "$out"`. The variable is recorded only when the assignment is a statement of its own at top level (not piped, not backgrounded, not inside a group) and its value is a literal (no `$`, backtick, glob or `~`). Anything else stays "known only at run time" → ask. `for f in *.tmp; do rm "$f"; done` is expected to still ask (the target contains `$`, `danger.rs:1973-1979`); [UNVERIFIED: no test row covers a loop variable, and the README "Limits" section (`README.md:138-143`) does not name loops specifically, only that the guard asks "when it can't see what a command touches"].
9. **Test the hook wiring, not only the analyser.** **[planned; no such tests exist yet: `guard.rs` tests have no `PowerShell` case and `verify.rs` has no "Next I'll" case]** Run `guard::check` with `tool_name: "PowerShell"` (deny) and with an ask case (`git reset --hard`). Run `verify::stop` with a "Next I'll…" message (block).
10. **Answer `deny` for the catastrophic cases, `ask` for doubtful ones.** A hook `ask` forces a prompt even in auto mode and is denied in a `-p` run where nobody can answer the prompt, and `deny` takes precedence over `defer`/`ask`/`allow` [3]. A timed-out command hook does not block the call by default (`onFailure: "block"` changes that), so the guard must stay fast [3]. [UNVERIFIED: "~12 ms measured". `README.md:120` and `CHANGELOG.md:10-12` say "about 12 ms per call", but no command or output backing it was found in the repo notes.]

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
- The transcript can lag behind `last_assistant_message` [3]. That is why the gate should read only the last *user* entry from it and allow the stop if it cannot read the file **[planned]**.
- cc-safety-net details come from the v0.5.0 README; the current README omits them [4].

## Sources
1. CowAgent notes — outputs/.research/stop-gate-guard/cowagent.md (zhayujie/CowAgent @aa5f4c9, MIT)
2. oh-my-pi + ForgeCode notes — outputs/.research/stop-gate-guard/omp-forge.md (oh-my-pi @7967984, forge @8703dec)
3. Claude Code notes — outputs/.research/stop-gate-guard/claude-code.md (https://code.claude.com/docs/en/hooks, anthropics/claude-code @3deb873, claude-plugins-official @f359d43)
4. Public guards notes — outputs/.research/stop-gate-guard/public.md (github.com/Dicklesworthstone/destructive_command_guard, github.com/kenryu42/claude-code-safety-net)

## Verification table
Checked 2026-10-12, read-only (no code run). Local clones: C:\Users\Admin\research\gate-guard\src\; saved docs: C:\Users\Admin\research\gate-guard\docs\ (hooks.md, hg.md).

| claim | nguồn | kết quả |
|---|---|---|
| Stop input has `stop_hook_active`, `last_assistant_message`, `background_tasks` | docs/hooks.md:2679 (re-read) | OK |
| Cap of 8 consecutive blocks, resets on tool call, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | docs/hooks.md:2683; hg.md:1011,1022 | OK |
| Gate allows on `stop_hook_active` and on running `background_tasks` | gate.rs:22-28 | OK |
| "Forces at most one continuation per stop" | gate.rs:22 + hooks.md:2679 (inference) | FIXED (qualified to "chain"; `stop_hook_active` after tool calls UNVERIFIED) |
| Stop does not fire on user interrupt | docs/hooks.md:2671-2673 | OK |
| No hook field for "user said stop"; user text only via UserPromptSubmit/transcript | claude-code.md S15 (grep of hooks.md; absence) | OK (medium: absence of evidence) |
| Gate reads last user message from transcript tail; keyword list | gate.rs (no transcript read; quote-based only) | FIXED (marked planned) |
| Transcript entry shape / user entry present at Stop time | not read in notes | UNVERIFIED |
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
| Guard "~12 ms measured" | README.md:120, CHANGELOG.md:10-12 assert it; no command/output found | UNVERIFIED |
| Item 8: literal-assignment resolution | danger.rs `Ctx` (52-59), `dynamic()` (1973-1979): no variable tracking | FIXED (marked planned) |
| `for f in *.tmp …` still asks; "listed under README limits" | no test row; README.md:138-143 has no loop item | UNVERIFIED (asks by code reading; README claim removed) |
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
