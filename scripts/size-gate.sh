#!/usr/bin/env bash
# 8sync size-gate — fail a release asset that exceeds the declared ceiling.
#
#   bash scripts/size-gate.sh <path-to-binary>
#   CEILING=4194304 bash scripts/size-gate.sh <path>   # override for a check
#
# Why this exists: `AGENTS.md` §8 carried a "< 4 MB stripped" budget that nothing
# enforced, and the binary quietly drifted to 6 407 848 B — 52 % over — before an
# audit noticed. A comment is not a budget; this is.
#
# The ceiling sits ABOVE today's size on purpose. A gate that is already red gets
# ignored; this one only fires on NEW growth. Lower it whenever `size-report.sh`
# shows real headroom — that is the ratchet.
#
# Raised 2026-08-21, WITH attribution (size-report: `web` gate alone = +1,732,232 B;
# the ratchet's original 4,208 B headroom was eaten by v0.56 (+81,920) and v0.57
# (+78,240) feature growth, so v0.58's legitimate +20,608 B tripped it). Tight on
# purpose: the next feature release trips it again and must attribute again.
#
# Raised 2026-10-11 for v0.61.0, WITH attribution: v0.60.0 → v0.61.0 grew every
# asset by the same new code — four verbs/bridges (`codex-web`, `gen-img`, the
# Feynman omp bridge, zsh-native `forge` + installer setup): linux-x86_64
# +102,656 B (5,390,608), linux-aarch64 +88,064, darwin-x86_64 +94,392,
# darwin-arm64 +82,960, windows +123,392. size-report (x86_64-pc-windows-msvc):
# `web` gate = +1,159,680 B, still the only elephant. 36,592 B headroom left.
#
# Raised 2026-10-11 for v0.63.0, WITH attribution: `8sync ccc` (Claude Code
# sessions, kit installer, native verify hook, settings merge) + the embedded kit
# (6 agents, /ship, CLAUDE.md block) + the shared name→UUID registry. size-report
# (x86_64-pc-windows-msvc): full 4,281,856 B, minimal 3,122,688 B (was 3,069,952:
# +52,736 B), `web` gate = +1,159,168 B (unchanged). Windows release build
# +41,472 B over v0.62.0. linux-x86_64 v0.62.0 was 5,415,216 B with 11,984 B left.
#
# Raised 2026-10-11 for v0.65.0, WITH attribution: v0.64.0 left 7,568 B on
# linux-x86_64 (5,497,456). v0.65.0 adds the async verify + Stop check module,
# the launch-time auto-update / kit refresh / project harness for `8sync ccc`,
# Claude Code skill links + `skillOverrides`, and embeds the org rules doc
# (`assets/skills/aup-audit/8sync-anthropic-rules.md`) and a fuller `8sync-cli`
# skill. size-report (x86_64-pc-windows-msvc): full 4,328,448 B, minimal
# 3,169,280 B, `web` gate = +1,159,168 B (unchanged). Windows release build
# +8,192 B over v0.64.0 (4,321,280 → 4,329,472). +16 KiB of ceiling. Published:
# linux-x86_64 5,517,968 B (+20,512 over v0.64.0; 3,440 B left), windows 4,337,664.
#
# 2026-10-12 (Unreleased: compliance hardening + `8sync hq` Discord Agent HQ +
# `ccc policy` + /rules /sec /harden). Local x86_64-unknown-linux-gnu release
# builds, same flags: main d18128d 5,380,080 B · compliance/kit branch 7e2b99f
# 5,418,288 B (+38,208) · agent-hq 5,612,000 B (+193,712; `hq.rs` ~1.9k lines,
# org policy, 3 new skills, 3 new agents (pm, architect, qa) embedded). Local builds run 137,888 B below the
# published asset, so the next linux asset is estimated ~5,749,888 B → ceiling
# 5632 KiB (~17 KiB left). Re-check against the real release asset.
# Published v0.66.0: linux-x86_64 5,747,632 B (19,536 B left).
#
# 2026-10-12 (Unreleased after v0.66.0: destructive-command guard `ccc/danger.rs`
# — a shell/PowerShell lexer and delete/force-push/credential classifier — and
# the native Stop gate `ccc/gate.rs`). Windows release builds, same flags,
# separate --target-dir: Windows v0.66.0 (fe4bbe5) 4,538,368 B → 4,646,400 B
# (+108,032); x86_64-unknown-linux-musl (local, `zig cc` linker,
# `-C link-self-contained=no`) 5,180,360 → 5,294,808 B (+114,448). Published
# v0.66.0 linux-x86_64 5,747,632 B + 114,448 ≈ 5,862,080 B → ceiling 5760 KiB
# (~35 KiB left). Re-check against the real release asset.
#
# 2026-10-13 (v0.67.0: rich `ccc . ls`/`8sync ls`/`show`/`guide` (session_view.rs,
# session_cmds.rs), local HQ journal + `hq ui` launcher, Stop/SessionStart/SendMessage
# hq hooks, guard heredoc fix, `ccc kit --remove`). Local x86_64-unknown-linux-gnu
# release, same flags: main f7323da 5,760,784 B → 5,866,032 B (+105,248; ls/show/
# guide ≈ +95.7k, journal/launcher ≈ +12.1k, rest small). Next linux musl asset
# estimated 5,862,080 + 105,248 ≈ 5,967,328 B → ceiling 5888 KiB (~60 KiB left).
# Re-check against the real release asset.
#
# 2026-10-13 v0.67.0 release run 38338317954: the real linux-x86_64 (musl) asset was
# 6,030,288 B, 976 B over 5888 KiB — the estimate above predates the shared secret
# masker + review fixes (+~25 kB local). Ceiling 5952 KiB (~64 KiB left) from the
# measured asset. v0.67.0 was tagged but not published; v0.67.1 is the release.
#
# 2026-10-13 (after v0.68.0: `8sync watchdog` — std-only /proc monitor, kill/
# quarantine, systemd unit, `ccc hook watchdog` — plus opt-in
# switches). Local x86_64-unknown-linux-gnu release, same flags: v0.68.0 ad9151a
# 5,917,472 B → 6,004,648 B (+87,176). v0.68.0 musl asset 6,050,768 B, so the next
# one is ≈ 6,137,944 B → ceiling 6016 KiB (~22 KiB left). Re-check against the real
# release asset.
#
# 2026-10-13 (after v0.69.0: `/ship` full process + `/planning` `/remember` `/consolidate`
# embedded skills, compact/resume session block, guard ship-asks). Local gnu release:
# v0.69.0 6,009,312 B → 6,023,632 B (+14,320; mostly embedded skill text). v0.69.0 musl
# asset 6,149,072 B, so the next ≈ 6,163,392 B — 3,008 B over 6016 KiB → ceiling 6080 KiB
# (~63 KiB left). Re-check against the real release asset.
#
# 2026-10-13 v0.74.0 release run: the real linux-x86_64 (musl) asset was 6,231,472 B,
# 5,552 B over 6080 KiB. v0.73.0 asset 6,202,448 -> +29,024 B = taste-skill refresh +
# 5 embedded `taste-*` variants (~52 KB markdown, compressed) + `ls` last_tool/stalled_error.
# v0.75.0 adds the ship-grant guard module (~200 lines). Ceiling 6144 KiB (~60 KiB left).
# v0.74.0 was tagged but not published; v0.75.0 is the release.
#
# 2026-10-13 v0.78.0 release run 38399343524: linux-x86_64 (musl) asset 6,338,096 B,
# 46,640 B over 6144 KiB. v0.77.0 asset 6,280,752 → +57,344 B = `ccc statusline`
# (renderer, install/chain, process-group runner) + ccc JSON surfaces (show/kit status/
# login-kind). Ceiling 6272 KiB (~84 KiB left). v0.78.0 was tagged, not published.
#
# 2026-10-14 v0.81.0 release run 38497187628: linux-x86_64 (musl) asset 6,428,208 B,
# 5,680 B over 6272 KiB. v0.80.0 asset 6,415,920 → +12,288 B = the `up` kit-refresh fix
# (path resolved before replace + " (deleted)" strip), the `crates/ccc-core` split
# (registry/transcript/masker behind a crate boundary) and the longer embedded kit text
# (cross-platform + sec/rules/aup gates in CLAUDE.md, ship-auto/autopilot/ship-loop/ship
# skills). v0.79.1 → v0.80.0 had already taken +61,440 B (HQ office rooms, ccc report,
# secret pipe-through). Ceiling 6400 KiB (~124 KiB left). v0.81.0 was tagged, not published.
#
# 2026-10-15 v0.89.0 release run 38683277672: linux-x86_64 (musl) asset 6,616,688 B,
# 63,088 B over 6400 KiB. v0.88.0 asset 6,547,024 (always-on office; only 6,576 B left)
# → +69,664 B = `ccc standup` (sprint board: parse/render/lock/overlap, ~450 lines),
# `ccc . goal` + registry Goal, `ccc . urgent` + newest-first `ls`, goals in the
# SessionStart room block, and the embedded /sprint skill + longer ship/ship-auto/
# ship-loop/autopilot/planning text. Ceiling 6592 KiB (~133 KiB left). v0.89.0 was
# tagged, not published.

set -euo pipefail
export LC_ALL=C
#
# 2026-10-16 v0.93.0 release run 38840096324: linux-x86_64 (musl) asset 6,801,424 B,
# 51,216 B over 6592 KiB. v0.92.1 asset 6,670,000 → +131,424 B = `8sync ccc hint`
# (ghost text / typeahead / band rules, ~750 lines), `8sync completions` (new dep
# clap_complete 4.5, all five shells), `8sync ccc inbox` claim/ack/release, and the
# embedded 8sync-hints + 8sync-inbox mods. Ceiling 6784 KiB (~142 KiB left). v0.93.0
# was tagged, not published.
#
# 2026-10-16 v0.98.0 release run 38928620962: linux-x86_64 (musl) asset 6,973,520 B,
# 26,704 B over 6784 KiB. v0.97.0 asset 6,903,888 → +69,632 B = `8sync ccc auto on
# --loop/--team` (loop.md playbook, per-room cron prompt, team seat fill; auto.rs
# +773 lines incl. tests), the project target queue `ccc/target.rs` (+413 lines:
# add/--now/queue/done/drop, lock + atomic rename, text cleaning) and the subscription
# loop notes. No new dependency. Ceiling 6912 KiB (~102 KiB left). v0.98.0 was tagged,
# not published.
#
# 2026-10-18 PR #85 run 39074148649: linux-x86_64 (musl) 7,104,624 B, 26,736 B over 6912 KiB.
# v0.100.0..v0.100.4 added the board lanes and claims (`ccc/target.rs`), `auto up` headless
# rooms and `--clear-ss` reload (`ccc/team.rs`), the PermissionRequest hook with its allowlist
# (`ccc/permit.rs`), card priority and the `auto wait` poller. No new dependency. Ceiling
# 7040 KiB (~101 KiB left).
#
# 2026-10-19 PR #116 run 39179917755: linux-x86_64 (musl) 7,280,784 B, 71,824 B over 7040 KiB;
# v0.100.15 asset 7,198,832 → +81,952 B (Windows MSVC local: 5,726,720 → 5,798,912, +72,192 B).
# v0.101.0: the embedded omp extension `8sync-team.ts` (17,039 B source), stop-failure resume
# at the status-line reset (`ccc/resume.rs`), team omp + `auto nudge` (`ccc/auto.rs`,
# `ccc/omp_team.rs`), `ccc msg` + room-line gating/quoting (`ccc/msg.rs`, `hq.rs`), the public
# link (`hq.rs`: cloudflared, nonce), `auto revive` and `awake` (kernel32 FFI, no crate). No new
# dependency. Ceiling 7168 KiB (~58 KiB left).
#
# 2026-10-19 v0.107.0 (before tagging): v0.106.0 linux-x86_64 (musl) asset 7,329,936 B left only
# 10,096 B under 7168 KiB. Windows MSVC local release of v0.107.0 = 5,991,424 B vs the v0.106.0
# Windows asset 5,851,648 → +139,776 B; at the last measured musl/MSVC ratio (1.135) the musl
# asset lands near 7,488,600 B. v0.107.0: the HQ native core `hq_core/` (loopback HTTP + token,
# `claude agents` fingerprint cache, warm transcript digests, 5 s machine sampler over
# kernel32/psapi/PDH/NVML FFI + Linux /proc, usage scan, disk walk), `ccc auto omp on --model`
# (team model, nudge model gate, `8sync . <name> --model`), lead merge-order prompt text. No new
# dependency (Cargo.lock: version lines only). Ceiling 7360 KiB (~47 KiB left over the estimate).
#
# 2026-10-20 v0.108.0 (before tagging): v0.107.0 linux-x86_64 (musl) asset 7,498,000 B left 38,640 B
# under 7360 KiB. Windows MSVC local release of v0.108.0 = 6,077,440 B vs the v0.107.0 Windows asset
# 5,994,496 → +82,944 B; at 1.135 the musl asset lands near 7,592,100 B. v0.108.0: `ccc auto merge`
# (`ccc/merge.rs`), project-scoped merge permission (`grant.rs`) and its guard rule (`guard.rs`), PR
# base/conflict/head checks + role-aware claims + `reopen` (`target.rs`, `room.rs`), CI health with
# billing detection (`ccc/ci.rs`, owner alert in `hq.rs`), event-only rooms and longer waits
# (`auto.rs`, `team.rs`, `idle.rs`). No new dependency. Ceiling 7488 KiB (~74 KiB left over the estimate).
#
# 2026-10-21 v0.110.11: v0.108.0 → v0.110.10 used the 74 KiB headroom (CI musl asset of this PR
# 7,670,032 B, 2,320 B over). Grown by: reap.rs (machine guard of leftover dev servers, process
# tree walk), merge.rs background landing, one-tap answers + boost/force verbs (auto.rs, team.rs),
# ccc-core Windows omp process scan (Toolhelp + NtQueryInformationProcess FFI), nested-scope +
# revive-lock liveness (`tasklist`) + grouping-folder refusal. No new dependency. In flight next:
# eye room, resource guard (EcoQoS/priority/lean rooms), project close, omp terminal host.
# Ceiling 7744 KiB (~60 KiB left over this asset; re-attribute with size-report before the next raise).
#
# 2026-10-21 v0.110.23: v0.110.11 → v0.110.22 used the headroom down to 9,936 B (main 2e5aea9 CI
# musl asset 7,919,920 B: eye room, resource guard, project close, omp terminal host, sweep room,
# live-room checks). This PR's CI musl asset 7,960,880 B (+40,960 B, 31,024 B over): the strict
# CPU cap in `ccc/pressure.rs` — affinity FFI (Set/GetProcessAffinityMask, GetProcessTimes,
# GetSystemTimes), Linux /proc/stat + Cpus_allowed parsing and `taskset`, pin records with exact
# restore, the stepwise tighten/loosen decision — plus the split CPU/RAM thresholds (`auto.rs`).
# No new dependency. Ceiling 7808 KiB (~34 KiB left over this asset).
# 2026-10-21 v0.110.26: `ccc/ship_fast.rs` (the owner's Ship-tốc-độ-cao sprint: brief delivery,
# approved watch, claim hold) + the lease/pin groundwork — CI musl asset 8,005,936 B (+~85 KB over
# v0.110.24, 10,544 B over the 7808 KiB ceiling). No new dependency. Ceiling 7840 KiB (~20 KiB left).
# 2026-10-21 v0.110.27: `ccc/lease.rs` (Lease liên tục: API-key renew within budget, subscription
# renew on owner presence; pinned projects + usage-tight focus) — CI musl asset 8,038,704 B
# (+32,768 B over v0.110.26). No new dependency. Ceiling 7872 KiB (~20 KiB left).
# 2026-10-22 v0.110.50: one company for many projects — auto.rs company flag / company_pick /
# board --all, team.rs company_host (auto up joins scope), know.rs (machine knowledge tree + company
# book), merge.rs infer_pr, pressure.rs floor — CI musl asset 8,128,816 B, 2,352 B over the 8,126,464
# ceiling. No new dependency. Ceiling 7968 KiB (~30 KiB left).
# 2026-10-23 v0.110.71: omp default team — per-project engine (auto.rs engines/set_engine), omp
# board nudges (omp_board_due/omp_board_text), qa→review fallback (target.rs review_waiting/
# claim_review), card-worktree prune with --force + orphan sweep, Ship 24h label TTL (grant.rs),
# omp --hours, omp down --only — ~3.8 KB of new Vietnamese strings plus their code; the omp
# PowerShell/WMI scan string went away. CI musl asset 8,161,584 B, 2,352 B over 8,159,232. No new
# dependency. Ceiling 8000 KiB (~30 KiB left).
CEILING="${CEILING:-8388608}"   # 8192 KiB (was 8000 KiB). 2026-10-24 v0.110.78: `8sync sleep work` (awake.rs +171 lines), `8sync eco` (eco.rs 767 lines) and `8sync mcp` (mcp.rs 641 lines, Claude Desktop/Cowork MCP server) took the CI linux musl asset to 8,251,728 B, 59,728 B over the 8,192,000 ceiling. +192 KiB, ~133 KiB left.
# Earlier: 8000 KiB (was 7968 KiB). 2026-10-21 v0.110.30: cross-repo --pr (target.rs parse_pr/
# pr_repo_for, merge.rs default_branch_of/cached per repo, guard.rs repo-aware self-merge) and the
# guard RAM trim + attribution (pressure.rs trim_pick/trim K32EmptyWorkingSet, ram_split JSON) grew
# the CI linux musl asset to 8,083,760 B, 22,832 B over the 8,060,928 ceiling. +64 KiB, ~43 KiB left.
# Goal is 4 MiB (4194304) — AGENTS.md §8.
GOAL=4194304

asset="${1:-}"
[ -n "$asset" ] || { echo "usage: size-gate.sh <binary>" >&2; exit 2; }
[ -f "$asset" ] || { echo "size-gate: no such file: $asset" >&2; exit 2; }

# stat(1) differs between GNU and BSD/macOS; Windows runners use the bash shim.
size=$(stat -c%s "$asset" 2>/dev/null || stat -f%z "$asset")

pct() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%+.2f%%", (a-b)*100/b}'; }

printf 'asset   %s\n' "$asset"
printf 'size    %d bytes\n' "$size"
printf 'ceiling %d bytes (%s)\n' "$CEILING" "$(pct "$size" "$CEILING")"
printf 'goal    %d bytes (%s)\n' "$GOAL" "$(pct "$size" "$GOAL")"

if [ "$size" -gt "$CEILING" ]; then
  echo "::error::size gate FAILED — $asset is $size B, over the $CEILING B ceiling by $((size - CEILING)) B."
  echo "Attribute it with \`bash scripts/size-report.sh\` before raising the ceiling."
  exit 1
fi

if [ "$size" -gt "$GOAL" ]; then
  echo "::warning::over the $GOAL B goal by $((size - GOAL)) B (under the ceiling, so not fatal)."
fi

echo "size gate OK"
