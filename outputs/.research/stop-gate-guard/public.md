# Stop gate + destructive-command guard: public prior art vs our design (read 2026-10-12)

## Part A - public evidence
| # | Claim (verbatim) | Source | Date/version | Confidence |
|---|---|---|---|---|
| S1 | dcg: "dual regex engine", "lazy-compiled regex patterns" with "SIMD-accelerated filtering"; claims "Sub-Millisecond Latency" | https://github.com/Dicklesworthstone/destructive_command_guard (README) | main, 2026-10-12 | med (README claim, no benchmark seen) |
| S2 | dcg heredoc/inline scan: "Heredoc and inline script scanning uses a three-tier pipeline"; T1 regex trigger <100us, T2 extraction <1ms, T3 "parsed using language-specific AST grammars (via tree-sitter/ast-grep)"; extraction "Timeout (default: 50ms)"; hook deadline default 1000ms | https://raw.githubusercontent.com/Dicklesworthstone/destructive_command_guard/main/README.md | main | med (design targets, not measurements) |
| S3 | dcg false positives: "Won't block `grep "rm -rf"` (data) but will block `rm -rf /` (execution)"; context classifier skips comments, heredoc bodies, quoted strings; `InlineCode` (-c/-e) "MUST check" | same README (offset 100000) | main | med-high |
| S4 | dcg temp paths: core.filesystem covers "Dangerous recursive rm operations ... outside literal temp subdirectories"; windows pack whitelists "temp-dir deletes" | same README | main | med |
| S5 | dcg policy: modes warn/log/ask/deny; "The default is **fail-open** (unparseable input is allowed)"; deadline/oversize "unverified" outcomes yield ask by default or deny with unverified_decision="deny"; critical rules cannot be downgraded; "A few extra prompts for manual confirmation are acceptable; lost work is not."; "A checked-in project allowlist is inert by default." | same README | main | med-high |
| S6 | dcg tests: "The test suite includes 80+ tests covering:" (one unit-test section; may be a subset) | same README | main | low-med |
| S7 | cc-safety-net: "It parses what the command does. Wrapping the command or reordering flags does not hide it."; blocks destructive commands "even inside `bash -c` or `python -c`"; "is not a sandbox"; presets Standard/Strict/Paranoid | https://github.com/kenryu42/claude-code-safety-net (README) | main | high |
| S8 | cc-safety-net rm policy: allowed rm -rf /tmp/..., /var/tmp/..., $TMPDIR/..., ./... "within cwd"; blocked paths outside cwd, /, ~, $HOME; Paranoid "blocks non-temp rm -rf even within the current working directory"; shell wrappers "Recursively analyzed (5 levels)"; "By default, unparseable commands are allowed through."; Strict = "fail-closed" | https://raw.githubusercontent.com/kenryu42/claude-code-safety-net/v0.5.0/README.md | v0.5.0 (old; current README omits these) | med (old version) |
| S9 | cc-safety-net tokenizer/parser name, test count, perf: not found in README/AGENTS.md (docs site ccsafetynet.com/docs not read) | README, AGENTS.md | main | - |
| S10 | Claude Code Stop hook: exit code 2 or decision "block"+reason makes Claude continue; `last_assistant_message` is provided on Stop; stop_hook_active is true when already continuing from a stop hook and must be checked to avoid infinite loops | https://code.claude.com/docs/en/hooks (first 100k chars read; stop_hook_active sentence came from a search summary of docs.anthropic.com, not read verbatim) | 2026-10-12 | med-high |
| S11 | Public Stop-hook heuristic (hezo issue #1150): allow when stop_hook_active; waiting on background work; Claude asks user a question / needs user-only action; task was a question/status/research and answered; work done and tests run. Block only if Claude could continue now | https://github.com/hezo-ai/hezo/issues/1150 (search snippet, not fetched) | 2026 | low-med |
| S12 | Other Stop approaches: verification-command gate (ralph-stop.py: block while command fails); plan-completion checker (geakstr/bruhook); tests-must-pass gate with 8-continuation cap (skylos.dev, cap not verified vs official docs) | https://skylos.dev/use-cases/claude-code-stop-hook ; https://github.com/geakstr/bruhook | snippets | low |
| S13 | Not searched deeply (stopped): safe-rm, shellcheck-style parsers, other tree-sitter-bash guards | - | - | - |

Takeaways: public guards are regex (dcg) or an unspecified parser (safety-net); dcg is fail-open by default with ask/deny opt-in; both whitelist /tmp and (safety-net) cwd-relative rm -rf; dcg classifies data vs execution contexts. Stop-gate heuristics in the wild key on structure (background tasks, stop_hook_active, tests, user-only question) rather than word lists; no public word-list gate found to compare false-positive rates.

## Part B - local findings (read-only)
Files: C:\Users\Projects\su-code\crates\cli\src\verbs\ccc\gate.rs (161 lines), danger.rs (2584 lines), uncommitted.

| # | Finding | file:line | vs Part A |
|---|---|---|---|
| L1 | Backticked word counts as a user stop quote: QUOTES includes ('`','`'), so "`stop`" (an identifier/flag) returns None and ends the turn. Confirmed | gate.rs:86-87 | no analog; fix: drop backtick pair, require a quoting cue ("you said") |
| L2 | JUSTIFIED too broad for the plan check: applied to the whole last paragraph, contains remove, delete, push, release, send, email, pay, cost, access, " or ", which... So "Next I'll remove dead code" or "Next I'll send the diff to the reviewer" never blocks. Test at line 142 ("Migration written. Next I'll drop the old columns") enshrines it | gate.rs:34, 47, 73-80, 142 | S11: exempt only when asking the user or needing user-only action; for PLAN use a narrow list (or require a question/offer) |
| L3 | PROCEED is plain `low.contains`: "fix" matches "prefix"/"suffix"/"fixture", "start" matches "restart"; `mentions` word-boundary logic is not used here | gate.rs:57-63 | reuse `mentions`-style boundaries |
| L4 | Non-ASCII JUSTIFIED entries use substring match: "giá" matches "đánh giá", "khóa"/"khoá" matches "khóa học" (course) | gate.rs:78, 94-96 | need Unicode word-boundary check |
| L5 | ASK substrings like "can i ", "may i ", "ok to " can match inside longer text; only the last line/paragraph is read, so a trailing sign-off after a plan hides it | gate.rs:30-33, 53-56 | - |
| L6 | Strengths: stop_hook_active + background_tasks guards, no transcript read, bilingual lists, tests both directions | gate.rs:22-28, 112-160 | matches S10/S11 |
| L7 | Guard: `rm -rf "$out_dir"` asks because any $VAR target makes resolve() None -> ask "only known when the command runs". Tests assert ask for "$BUILD_DIR", "$BUILD_DIR"/*, "${BUILD_DIR:?}"/. Under `claude -p` ask = denial (per brief; not verified in docs) | danger.rs:1983-2008, 2064; tests 2363-2370 | dcg default is fail-open and ask only where protocol supports it; safety-net allows /tmp, $TMPDIR, cwd-relative. Options: resolve a var assigned earlier in the same command from a literal/project-relative/mktemp value; allow `${VAR:?}` under a literal project subpath |
| L8 | Loops: no for/while parsing found in danger.rs (only `do`/`then` in the backstop at_start list); `for d in a b; do rm -rf "$d"; done` yields a runtime variable target -> ask. No test row with `for`. Not verified by execution | danger.rs:200, tests 2363-2404 | public guards cannot resolve loop vars either; dcg falls back to fail-open/ask |
| L9 | Policy stricter than public: deny on cwd/home/ancestors/temp roots; ask for unresolvable; unbalanced quote or depth >6 -> ask | danger.rs:104, 835-840, 2020-2110 | safety-net depth 5 and fail-open default (Strict = fail-closed); dcg fail-open default |
| L10 | Strengths: real tokenizer (quotes, heredocs, here-strings, subshells, cd tracking), PowerShell/cmd/WSL/ssh, raw-text backstop, TEXT list (echo/grep/git/gh...) for data contexts, project and temp-dir safe zones, linear-time test, large table tests | danger.rs:125, 2153-2584 | exceeds documented S1/S7 coverage |
| L11 | Backstop false-positive risk: data-context exemption is by first word of each raw segment only (TEXT list); text inside non-listed tools (jq, python -c, cat <<EOF with raw-split segments) can still deny; split on ; | & ignores quoting | danger.rs:125-134, 175-199 | dcg classifies per span (comment/heredoc/quote), ours per segment |

## Contradictions
- dcg README: fail-open default vs "ask ... fails closed on unsupported clients" (S5): different knobs, not a true conflict.
- safety-net v0.5.0 README documents rm/tmp/5-level details; current README drops them (S8 vs S7); current behaviour not verified.
- Official hooks page: only first 100k of 268k chars read; stop_hook_active wording not verified verbatim.

## Not found
- Test corpus sizes for safety-net; dcg's full test count (README says "80+" in one section); real benchmarks for either.
- safe-rm, shellcheck-based, other tree-sitter-bash guards (not searched).
- Any public word-list Stop gate to compare false-positive rates.
- How Claude Code maps hook "ask" under `claude -p` (taken from brief, not verified).
