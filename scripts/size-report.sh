#!/usr/bin/env bash
# 8sync size-report — attribute binary weight to the optional feature gates.
#
# Builds every feature combination into its own --target-dir and prints the
# stripped byte count plus the delta against the full build. This is the
# measurement half of `assets/skills/deep-research/SKILL.md` §5 ("Native &
# Binary-Weight Audits") — no size claim about this repo ships without it.
#
#   bash scripts/size-report.sh            # four combinations, release profile
#   KEEP=1 bash scripts/size-report.sh     # keep the scratch target dirs
#
# Why an explicit --target: without it, RUSTFLAGS and profile overrides also
# apply to host build scripts and proc-macros, which both slows the build and
# has already broken it once (`-C relocation-model=static` vs `indoc`).
# See su-code/KNOWLEDGE.md.

set -euo pipefail

# awk emits `52.76`; a comma-decimal locale makes printf %f reject it. Pin C.
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${TARGET:-$(rustc -vV | sed -n 's/^host: //p')}"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/8sync-size-report}"
BUDGET=4194304   # AGENTS.md §8: "< 4 MB stripped"

# name : cargo feature flags
COMBOS=(
  "full     :"
  "minimal  :--no-default-features"
)

say() { printf "\033[1;36m[size-report]\033[0m %s\n" "$*"; }

command -v cargo >/dev/null || { echo "cargo not found" >&2; exit 1; }
say "target = $TARGET"
say "scratch = $SCRATCH"

declare -A SIZE
for entry in "${COMBOS[@]}"; do
  name="$(echo "${entry%%:*}" | xargs)"
  flags="${entry#*:}"
  dir="$SCRATCH/$name"
  say "building $name ${flags:-(default features)}"
  # shellcheck disable=SC2086
  ( cd "$ROOT" && cargo build --release --target "$TARGET" --target-dir "$dir" $flags >/dev/null 2>&1 )
  bin="$dir/$TARGET/release/8sync"
  [ -f "$bin" ] || bin="$bin.exe"   # Windows host targets
  SIZE[$name]=$(stat -c%s "$bin")
done

full=${SIZE[full]}
printf '\n%-16s %14s %14s %9s\n' COMBINATION BYTES "vs full" "vs 4MiB"
printf '%s\n' "------------------------------------------------------------"
for entry in "${COMBOS[@]}"; do
  name="$(echo "${entry%%:*}" | xargs)"
  b=${SIZE[$name]}
  printf '%-16s %14d %+14d %+9.2f%%\n' \
    "$name" "$b" "$((b - full))" "$(awk -v b="$b" -v c="$BUDGET" 'BEGIN{printf "%.2f", (b-c)*100/c}')"
done

printf '\n%s\n' "gate cost (full minus the build without it):"
printf '  %-12s %+d bytes\n' "web" "$(( ${SIZE[full]} - ${SIZE[minimal]} ))"
printf '\nbudget (AGENTS.md §8): %d bytes\n' "$BUDGET"

[ -n "${KEEP:-}" ] || { rm -rf "$SCRATCH"; say "scratch removed (KEEP=1 to retain)"; }
