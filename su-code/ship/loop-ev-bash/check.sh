#!/usr/bin/env bash
# Acceptance checks for loop-ev-bash: bash check.sh <C1|C2|C3|C4> [run-id]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
src=crates/cli/src/verbs/ccc/looper.rs
# Reuse the main checkout's target dir (warm cache) instead of a cold build in the worktree.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$(git rev-parse --git-common-dir)/../target}"

utest() { nice -n 19 cargo test -j2 -q -p su-code --bin 8sync looper 2>&1; }

case "${1:-}" in
  C1)
    out=$(utest) || { echo "$out" | tail -20; echo "C1-fail"; exit 1; }
    echo "$out" | grep -E '^test result: ok' | tail -1
    echo "C1-ok" ;;
  C2)
    cp "$src" "$src.orig"
    trap 'mv -f "$src.orig" "$src"' EXIT
    # `return shell();` exists only in program(): drop the routing, keep everything else.
    node -e '
      const fs = require("fs"); const f = process.argv[1], a = "return shell();";
      const s = fs.readFileSync(f, "utf8");
      if (s.split(a).length !== 2) { console.error("mutation target not unique"); process.exit(2); }
      fs.writeFileSync(f, s.replace(a, "return Ok(PathBuf::from(name));"));' "$src"
    if utest > /dev/null; then echo "C2-fail: unit test passed without the routing"; exit 1; fi
    echo "C2-ok: without the routing the looper test fails (source restored)" ;;
  C3)
    # Build warnings go to stderr, which `loop ev` prints after stdout: keep them out of the tail.
    nice -n 19 cargo build -j2 -q -p su-code --bin 8sync 2> /dev/null
    bin="$CARGO_TARGET_DIR/debug/8sync"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    # Outside a su-code project the loop files live in <cwd>/.claude/ship/<slug>/.
    (cd "$tmp" && 8sync ccc loop init old > /dev/null && 8sync ccc loop ev old X -- bash -c "command -v gh" > /dev/null) || true
    (cd "$tmp" && "$bin" ccc loop init new > /dev/null && "$bin" ccc loop ev new X -- bash -c "command -v gh" > /dev/null)
    echo "installed $(8sync --version 2>/dev/null | head -1): $(cat "$tmp/.claude/ship/old/LOOP.md" 2>/dev/null)"
    line=$(cat "$tmp/.claude/ship/new/LOOP.md")
    echo "this branch: $line"
    case "$line" in *"| exit 0 |"*) echo "C3-ok: argv bash found gh" ;; *) echo "C3-fail"; exit 1 ;; esac ;;
  C4)
    run="${2:?run id}"
    jobs=$(gh run view "$run" --json jobs --jq '.jobs[]|"\(.name)=\(.conclusion)"')
    echo "$jobs"
    for j in "test (ubuntu-latest)" "test (macos-latest)" "test (windows-latest)"; do
      echo "$jobs" | grep -qx "$j=success" || { echo "C4-fail: $j not success"; exit 1; }
    done
    echo "C4-ok: test on 3 OS success (run $run)" ;;
  *) echo "usage: check.sh <C1|C2|C3|C4> [run-id]" >&2; exit 2 ;;
esac
