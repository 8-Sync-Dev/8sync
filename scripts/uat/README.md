# scripts/uat — real-world acceptance scripts

Each script runs a real binary (official `claude`, a released `8sync`) in a `mktemp` sandbox, prints
PASS/FAIL per assertion and exits non-zero on failure. No API key is read or set; `claude` uses the
owner's existing subscription login. Nothing here touches the owner's `~/.claude/settings.json`,
`~/.local/bin/8sync` or `~/.config/8sync`. Not run in CI (they spend real tokens / need network).

## hook-latency.sh — how long the kit hooks keep Claude waiting (no model, free)

`bash scripts/uat/hook-latency.sh [8sync] [runs]`: sandbox HOME, each hook fed the JSON Claude Code would send,
median of 7 runs against a budget — guard, wake, watchdog, resume-note ≤ 20 ms; `verify` with a file outside any
project (its no-op path) ≤ 50 ms. The real verify check (tsc/cargo) runs with `asyncRewake` and never blocks the
model. Measured 2026-10-15 on Linux (v0.90.0 + this branch): every hook median 3 ms, PASS; the Orca per-event shell
hook on the same machine ≈ 5 ms. Timing uses bash 5 `EPOCHREALTIME` with a `date +%s%N` fallback — not verified on
macOS `/bin/bash` 3.2 (run it with Homebrew bash) or Windows.

## no-idle-hook.sh — "không ai rảnh" ladder and rails (no model, free)

`bash scripts/uat/no-idle-hook.sh target/debug/8sync`: sandbox HOME + a fake team task list; checks
off-by-default, teammate takes the next task (exit 2), loop → rest, lead Stop block, rest, and subscription
without a lease → rest, plus the `task-done` gate (an unchecked code edit on a dirty tree holds the task, a test run
lets it pass, the next idle asks for one `/remember` lesson). Measured 2026-10-14 on Linux: 15/15 ok, PASS.

Live run (owner-run, interactive — agent teams do not spawn under `claude -p`): `8sync ccc idle on --hours 1
--usd-per-hour 2`, `8sync ccc kit`, open a new `8sync ccc . uat-idle --team`, ask the lead for 2 teammates and
4 small tasks. Expect: a teammate that finishes takes the next task by itself; the
lead stops when nothing is open; `8sync ccc idle status` shows each member and the rest reason. Gate check: ask a
teammate to edit a `.rs` file and mark its task done without testing → the task stays open with the
"8sync task-done" reason; the lead editing a file must not hold a teammate's task (the teammate transcript is read
from `<lead id>/subagents/agent-<agent_id>.jsonl`, a layout seen on disk, not documented: not verified live). On a
subscription login keep it attended (lease); unattended runs belong on a Console API key. Then `idle off`.

## compact-window.sh — `CLAUDE_CODE_AUTO_COMPACT_WINDOW` moves the trigger

Run: `scripts/uat/compact-window.sh [WINDOW=200000] [PCT=60] [MODEL=claude-haiku-5-5]`. Same harness as compact.sh but the window comes
from the env var (what `8sync ccc compact --window` writes), no `--autocompact` flag. A secret token sits in the first file and is asked for at the end.
Docs ([env-vars](https://code.claude.com/docs/en/env-vars)): "from `100000` to `1000000`. Accepts a plain integer such as `500000` only ... The effective window is also capped at the model's context window. Takes precedence over the `/autocompact` command, the `--autocompact` flag, and the `autoCompactWindow` setting."
Result (2026-10-14, claude 2.1.296, override 60): window 200000 -> first auto-compaction at 119,955 tokens = 60.0 % (PASS, US$0.21, recall ok);
window 120000 -> 58,098 (48.4 %, expected ~72K); window 100000 -> 50,136 (50.1 %). The var does move the trigger, but at <=120K it fires below pct x window (cause not verified) and
those runs stop with "Autocompact is thrashing" (the 34 KB files refill the context), so recall is not reachable there; that is a test-size artefact, not proof of token loss.
400K (the kit default) was not run (~US$1+): not verified.

## compact.sh — auto-compaction honours `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`

Run: `scripts/uat/compact.sh [WINDOW=100000] [PCT=60] [MODEL=claude-haiku-5-5]`
(`PCT=none` = control run without the variable; `KEEP=1` keeps the sandbox + transcript for inspection).
Cost: about US$0.04 per run (Haiku 5.5, `total_cost_usd` from the JSON output; hard cap `--max-budget-usd 2`).
Needs: `claude`, `jq`, `python3`.

How: temp cwd with 14 generated ~34 KB text files; `claude -p --model claude-haiku-5-5 --permission-mode auto
--max-turns 24 --max-budget-usd 2 --setting-sources local --settings <tmp json> --autocompact 100000`
with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60` exported for that child only. The settings JSON adds a `PreCompact`
hook that logs the hook's stdin JSON (+ last assistant usage). The prompt makes the model Read the files
one per step, so context grows past 60 % of the window. Pass = a `trigger=auto` PreCompact event exists and
the first `compact_boundary.preTokens` in the transcript is within 50..65 % of the window.

Design decisions (documented sources, fetched 2026-10-14):
- Haiku 5.5 has a 1M window and "Sessions auto-compact at about 967K tokens by default"
  ([model-config](https://code.claude.com/docs/en/model-config#haiku-55-context-window-and-pricing)).
  60 % of that is ~580K tokens per run, too expensive, so the auto-compact window is pinned to the documented
  minimum with `--autocompact 100000` (range "100K to 1M tokens",
  [model-config#set-the-auto-compact-window](https://code.claude.com/docs/en/model-config#set-the-auto-compact-window)).
- env-vars: "`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` — Set the percentage (1-100) of the auto-compact window at which
  auto-compaction triggers. Use lower values like `50` to compact earlier; the variable can't raise the threshold,
  so values above the default percentage are ignored." ([env-vars](https://code.claude.com/docs/en/env-vars)).
  So the percentage is of the auto-compact window, hence the denominator in the report is 100000, not 1M.
- hooks: PreCompact matcher `auto` = "Auto-compact when the conversation reaches the auto-compact window";
  input adds `trigger` and `custom_instructions` to the common fields (`session_id`, `transcript_path`, `cwd`, ...)
  ([hooks#precompact](https://code.claude.com/docs/en/hooks#precompact)).
- `-p` can auto-compact: the run shows `trigger: auto` events (the docs do not say otherwise; no tmux fallback needed).
  In `-p` there is no second user turn, so the "reply next" loop is replaced by one prompt asking for one Read per step.
- "Tokens at compaction" is taken from the transcript's `system/compact_boundary` record (`compactMetadata.preTokens`),
  because the last assistant `usage` (also logged) lags by the pending tool_result (~6k tokens here).
- `claude` exits 1 in this setup (turn cap / compaction loop at a 100K window); the verdict ignores that exit code.

Result of the real run (2026-10-14, claude 2.1.296): first auto-compaction at 58,130 tokens = 58.1 % of the 100,000
window with override 60 → PASS (later compactions at 48.6 % and 53.5 % are logged as well; they follow a compacted
context, so only the first is judged). Control (`PCT=none`, same window): first auto-compaction at 75,587 tokens = 75.6 % (default threshold is higher
than 60 %, so the override is what moved it from ~76 % to ~58 %).

## tool-output.sh — the kit's tool-output budget cuts tokens, answer still found

Run: `scripts/uat/tool-output.sh [MODEL=claude-haiku-5-5]` (`KEEP=1` keeps the sandbox). Cost: about US$0.02 per run pair (cap `--max-budget-usd 1` per arm). Needs: `claude`, `jq`, `python3`.

How: two fresh temp dirs with the same generated corpus (`big.txt` ~58 KB, a token on its last line; `gen.py` prints ~27k chars ending in a SUMMARY line with a token).
`claude -p` with `--setting-sources local --settings <tmp json>` (owner's user settings are NOT read, so the kit env already installed on the machine cannot leak into the baseline).
Baseline settings = `{}`; kit settings = `env.BASH_MAX_OUTPUT_LENGTH=20000`, `env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=15000`.
Tokens = input + cache_creation + cache_read from the JSON `usage`. Pass = both answers contain both tokens AND kit tokens < baseline.

Documented basis (fetched 2026-10-14): env-vars "`BASH_MAX_OUTPUT_LENGTH` ... (default: 30000; maximum: 150000). If you set the `bashOutputMaxChars` setting, Claude Code ignores this variable."; "`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` Override the default token limit for file reads, which is 25,000 tokens."
tools-reference: valid Bash output past the limit becomes "the path of a file saved to the session directory ... plus a preview", and Claude reads the rest when needed; a Read over the limit returns "the first page of the file, with a `PARTIAL view` notice".

Result (2026-10-14, claude 2.1.296, two runs): baseline 171,115 and 171,177 tokens (4 turns); kit 98,897 and 98,863 tokens (5 turns); about -42 %; hidden check passed in all four runs. Caveat: one task; Read and Bash effects are not separated.

## up-kit.sh — `8sync up` refreshes the kit on another machine

Run: `scripts/uat/up-kit.sh [OLD_TAG=v0.79.1]`   Cost: free (public release download, ~5 MB x2).
Needs: `gh` (already logged in; `GH_CONFIG_DIR` is kept so gh works despite the HOME redirect), `curl`, `jq`, linux.

How: downloads the old release asset into a temp dir, runs it with `HOME`, `XDG_*`, `CLAUDE_CONFIG_DIR` all inside
that dir (`selfup::installed_path()` = `current_exe()`, so `up` replaces only the temp copy; stamp lives in
`$CLAUDE_CONFIG_DIR/.8sync-kit.json`, features in `$HOME/.config/8sync/features.toml`), pre-seeds a foreign
`statusLine` (`echo orca`), runs `ccc kit` (offline), then `<tmp>/8sync up`. Asserts: exe `--version` == latest tag,
`statusLine.command` contains `8sync ccc statusline`, `features.toml` has `statusLine_prev` with `echo orca`,
`env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` present, kit stamp == new version. On failure the sandbox is kept for inspection.

Known failing assertion at time of writing: kit stamp stays at the old version because `refresh_kit` cannot
re-exec the replaced binary on Linux (root cause in the task report; Rust fix belongs to crates/cli).

## omc-cancel-risk.sh — `8sync ccc risk` on the real diff, `8sync ccc cancel` fail-closed (no model, free)

`bash scripts/uat/omc-cancel-risk.sh [target/debug/8sync]`: `risk --json` on this repo's working tree must name
`sec` first with a valid level; `risk --paths apps/web/login.ts,CHANGELOG.md` must require `/rules`; then in a
`mktemp` repo: `cancel` with no session id → exit 1 naming `--session`, an unknown `--session` → exit 1 and ACTIVE
untouched, a live `loop init` named in ACTIVE + an unregistered session id → cancelled (`"stopped": "cancelled"`),
ACTIVE removed. Linux/macOS only (`env -u`, `mktemp -t`, python3); Windows is covered by the unit tests
(`cancel_*`, `risk_*`). Measured 2026-10-16 on Linux (debug build of this branch): PASS.
