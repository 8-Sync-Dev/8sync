#!/usr/bin/env bash
# Acceptance checks for handoff-scripts-utf8: bash check.sh <C1|C2|C3|C4> [run-id]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
s=su-code/handoff/scripts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

case "${1:-}" in
  C1)
    bash "$s/test-scripts.sh"
    echo "C1-ok" ;;
  C2)
    # origin/main's merge-changelog.py (text=True, locale codec) with today's bump-version.py.
    git show origin/main:"$s/merge-changelog.py" > "$tmp/merge-changelog.py"
    cp "$s/bump-version.py" "$tmp/"
    if SCRIPTS_DIR="$tmp" bash "$s/test-scripts.sh" > "$tmp/out" 2>&1; then echo "C2-fail: old merge-changelog.py passed"; exit 1; fi
    grep -q 'FAIL: merge-changelog.py' "$tmp/out" || { tail -3 "$tmp/out"; echo "C2-fail: failed for another reason"; exit 1; }
    echo "C2-ok: origin/main's merge-changelog.py fails the UTF-8 fixture" ;;
  C3)
    # Drop newline="" from bump-version.py: text mode writes CRLF on Windows.
    cp "$s/merge-changelog.py" "$tmp/"
    node -e '
      const fs = require("fs"); const [src, dst] = process.argv.slice(1), a = ", newline=\"\")";
      const t = fs.readFileSync(src, "utf8");
      if (t.split(a).length !== 2) { console.error("mutation target not unique"); process.exit(2); }
      fs.writeFileSync(dst, t.replace(a, ")"));' "$s/bump-version.py" "$tmp/bump-version.py"
    if SCRIPTS_DIR="$tmp" bash "$s/test-scripts.sh" > "$tmp/out" 2>&1; then echo "C3-fail: CRLF output passed"; exit 1; fi
    grep -q 'FAIL: CR in' "$tmp/out" || { tail -3 "$tmp/out"; echo "C3-fail: failed for another reason"; exit 1; }
    echo "C3-ok: without newline=\"\" the LF check fails" ;;
  C4)
    run="${2:?run id}"
    jobs=$(gh run view "$run" --json jobs --jq '.jobs[]|"\(.name)=\(.conclusion)"')
    echo "$jobs"
    for j in "test (ubuntu-latest)" "test (macos-latest)" "test (windows-latest)"; do
      echo "$jobs" | grep -qx "$j=success" || { echo "C4-fail: $j not success"; exit 1; }
    done
    n=$(gh run view "$run" --log | grep -c 'handoff scripts ok (' || true)
    [ "$n" -ge 3 ] || { echo "C4-fail: 'handoff scripts ok' in $n job logs, want 3"; exit 1; }
    echo "C4-ok: test on 3 OS success, helper scripts ok in $n logs (run $run)" ;;
  *) echo "usage: check.sh <C1|C2|C3|C4> [run-id]" >&2; exit 2 ;;
esac
