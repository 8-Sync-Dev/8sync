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

set -euo pipefail
export LC_ALL=C

CEILING="${CEILING:-5505024}"   # 5376 KiB (raised 2026-10-11 from 5300 KiB, see above). Goal is 4 MiB (4194304) — AGENTS.md §8.
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
