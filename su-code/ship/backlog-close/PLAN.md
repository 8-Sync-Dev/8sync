# PLAN — backlog-close (owner /ship-loop 2026-10-14: "ok continue go full")

Goal: close every open item from the v0.80.0 report with evidence: the 60 % auto-compact is real, `8sync up` really refreshes the kit, the stray KNOWLEDGE archive is committed, the HQ UX research has a final cited brief, /ship-auto and /autopilot are UAT'd, and `crates/ccc-core` exists for ZUS (S5 of `8sync-startup/outputs/zus-ccc-harness-plan.md`).

## Acceptance criteria (exit 0 = pass)
- **C1 compact 60 % is real.** `scripts/uat/compact.sh` runs official `claude -p` (Haiku, `--max-budget-usd` cap) in a throwaway dir with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60` and a PreCompact hook that logs `trigger` + context tokens from the transcript; pass when an `auto` compaction is logged at ≤ 65 % of the model window. Check: `bash scripts/uat/compact.sh`
- **C2 `8sync up` refreshes the kit.** `scripts/uat/up-kit.sh` downloads the v0.79.1 release binary into a temp HOME, stamps an old kit, runs `8sync up`, and asserts the binary is the latest release and `~/.claude/settings.json` (temp) has the 8sync statusLine + compact env + the new kit stamp. Check: `bash scripts/uat/up-kit.sh`
- **C3 stray archive committed.** Check: `git ls-files --error-unmatch su-code/archive/KNOWLEDGE-1791268148.md` (after commit; before commit `test -f`).
- **C4 HQ UX brief final.** deep-research pipeline: draft → verifier → reviewer → `outputs/hq-team-ux.md` + provenance. Check: `grep -q '^## Sources' outputs/hq-team-ux.md && grep -q '^Verification:' outputs/hq-team-ux.provenance.md`
- **C5 /ship-auto + /autopilot UAT.** `scripts/uat/auto-levels.sh <level>` builds a throwaway repo with failing tests (no remote), runs `claude -p "/<level> …" --permission-mode auto --max-turns N --max-budget-usd B`; pass when tests go green, work is committed, nothing was pushed, and the run stopped at the Ship gate (no remote → no merge/release). Check: `bash scripts/uat/auto-levels.sh ship-auto && bash scripts/uat/auto-levels.sh autopilot`
- **C6 ccc-core crate.** `crates/ccc-core` (lib): secret masker, uuid session registry, session view/transcript scan, JSON row types (`schema: 1`); `crates/cli` uses it (no duplicate copies). Check: `nice -n 19 ionice -c3 cargo test -p ccc-core -j2 && grep -q 'ccc-core' crates/cli/Cargo.toml`
- **C7 CI green.** Check: `gh pr checks <pr> -R 8-Sync-Dev/su-code` all SUCCESS (+ release size gate estimate noted).

## Assumptions (auto)
- Caps: max-iter 12, max-min 240 (owner said "go full"; six items).
- C1/C5 spend a little subscription usage inside official Claude Code (`claude -p`, budget-capped); no API key, no proxy.
- C5 runs offline on a local repo: pushing/merging is out of scope by design, so "stopped at Ship" is the expected end.
- Release only through one `Ship` question after all green.
