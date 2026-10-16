#!/usr/bin/env bash
# C2-C4 checks on one CI run: bash cjob.sh <run-id> <C2|C3|C4>
set -euo pipefail
run="$1"; c="$2"
job=$(gh run view "$run" --json jobs --jq '.jobs[]|select(.name=="size-gate")|.databaseId')
[ -n "$job" ] || { echo "$c-fail: no size-gate job in run $run"; exit 1; }
case "$c" in
  C2)
    concl=$(gh run view "$run" --json jobs --jq '.jobs[]|select(.name=="size-gate")|.conclusion')
    [ "$concl" = success ] || { echo "C2-fail: size-gate conclusion=$concl"; exit 1; }
    echo "C2-ok: run $run job $job success" ;;
  C3)
    line=$(gh run view "$run" --job "$job" --log | grep -o 'size    [0-9]* bytes' | head -1 || true)
    echo "measured: ${line:-none}"
    [ "$line" = "size    6973520 bytes" ] || { echo "C3-fail: want 6973520 (v0.98.1 asset)"; exit 1; }
    echo "C3-ok: $line = v0.98.1 linux-x86_64 asset" ;;
  C4)
    gh run view "$run" --job "$job" --log | grep -q 'self-test ok' || { echo "C4-fail: no self-test ok"; exit 1; }
    echo "C4-ok: self-test ok in job $job" ;;
  *) echo "usage: cjob.sh <run-id> <C2|C3|C4>" >&2; exit 2 ;;
esac
