## auto-levels.sh — UAT of /ship-auto (level 3) and /autopilot (level 5)

`bash scripts/uat/auto-levels.sh ship-auto|autopilot` builds a throwaway repo in `mktemp` (3 small bugs, failing tests,
no git remote), runs the official `claude -p` headless with `--permission-mode auto` (sonnet-5-5; ship-auto 60 turns/$3,
autopilot 100 turns/$5 with `--max-items 2`), then asserts: tests pass, a conventional commit exists, no remote,
result mentions Ship/remote/CI, `~/.claude/settings.json` mtime unchanged, `total_cost_usd` present. Exit non-zero on any FAIL.
Needs `claude` (subscription login), `node`, `jq`. Never sets keys or bypasses permissions.
