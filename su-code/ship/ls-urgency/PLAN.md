# ls-urgency — `ccc . ls` sorted by time, with an urgency level each agent sets for its own session

Owner ask (2026-10-15): "`. ls` xếp theo giờ và có màu mức độ urgent mà cho session do agent đặt cho".

## Design
- **Sort:** `8sync ccc . ls` (text + `--json`) lists sessions newest `last_active` first (was: registry insertion order).
- **Urgency store:** `ccc_core::registry::Session` gains `urgency: Option<Urgency { level, note, set_at }>` (`serde(default)`,
  skipped when empty), so old `index.json` files load unchanged. Written through the existing locked `Store::update`.
- **Agent sets it:** `8sync ccc . urgent <high|med|low|clear> [note…] [--session <name>]`.
  - Target = `--session <name>`, else the session whose `conversation_id` equals `$CLAUDE_CODE_SESSION_ID`
    (set by Claude Code 2.1.299 in every Bash tool call, seen 2026-10-15; not in the env-var docs → not verified elsewhere).
  - No match → error telling the agent to pass `--session`. Note: first line, ≤80 chars, secrets masked.
- **Show it:** line 1 of each session gets a chip with text + colour (never colour only):
  `▲ high` red bold · `◆ med` yellow · `▽ low` cyan, then line `flag <note> · <ago>`. JSON row gets `urgency`.
- **Agents learn it:** kit docs (`8sync-cli` skill table, `ccc help`) mention the verb and when to use it
  (high = blocked on the owner/needs a decision now; med = waiting on a teammate; low = FYI; clear when resolved).
- Out of scope: urgency in `8sync ls --all` / HQ UI (follow-up), auto-expiry.

## Acceptance criteria (each one command, exit 0 = pass)
| # | Criterion | Command |
|---|---|---|
| C1 | registry: urgency round-trips, old index loads, set/clear by name and by id, unknown → None | `nice -n 19 ionice -c3 cargo test -j2 -p ccc-core registry` |
| C2 | ls: newest-first order; chip text per level; note masked/clipped; JSON field | `nice -n 19 ionice -c3 cargo test -j2 -p su-code --bin 8sync -- ccc::urgent session_view` |
| C3 | UAT: real binary, temp config: `urgent high` via env id, `ls` shows `▲ high` first-by-time, `--json` has level, `clear` removes | `bash scripts/uat/ls-urgency.sh` |
| C4 | CI green on ubuntu, macos, windows (PR checks) | `gh pr checks <pr> --watch` |
