# scripts/uat — real-world acceptance scripts

Each script runs a real binary (official `claude`, a released `8sync`) in a `mktemp` sandbox, prints
PASS/FAIL per assertion and exits non-zero on failure. No API key is read or set; `claude` uses the
owner's existing subscription login. Nothing here touches the owner's `~/.claude/settings.json`,
`~/.local/bin/8sync` or `~/.config/8sync`. Not run in CI (they spend real tokens / need network).

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
