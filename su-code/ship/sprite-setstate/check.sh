#!/usr/bin/env bash
# Acceptance checks for sprite-setstate: bash check.sh <C1|C2|C3|C4> [run-id]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
t=apps/hq-ui/tests/sprite-setstate.test.ts
src=apps/hq-ui/lib/sprite/render.ts

vit() { (cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/sprite-setstate.test.ts "$@"); }

# mutate <label> <exact text> <replacement>: the test must FAIL on the mutated source.
mutate() {
  node -e '
    const fs = require("fs"); const [f, a, b] = process.argv.slice(1);
    const s = fs.readFileSync(f, "utf8");
    if (!s.includes(a)) { console.error("mutation target not found: " + a); process.exit(2); }
    fs.writeFileSync(f, s.replace(a, b));' "$src" "$2" "$3"
  if vit > /dev/null 2>&1; then echo "C3-fail: mutation '$1' survived"; return 1; fi
  git checkout -- "$src"
  echo "killed: $1"
}

case "${1:-}" in
  C1)
    grep -q 'mountSprite(' "$t" && grep -q 'setState(' "$t" || { echo "C1-fail: $t lacks mountSprite/setState"; exit 1; }
    echo "C1-ok: $(grep -c '^  it(' "$t") cases in $t" ;;
  C2)
    out=$(vit 2>&1) || { echo "$out" | tail -20; echo "C2-fail"; exit 1; }
    echo "$out" | grep -E 'Tests +[0-9]+ passed' | tail -1
    echo "C2-ok" ;;
  C3)
    git diff --quiet -- "$src" || { echo "C3-fail: $src has local changes; refusing to mutate"; exit 1; }
    trap 'git checkout -- "$src"' EXIT
    mutate "no transition" 'const via = reduced ? null : transitionFor(target(), next);' 'const via = null;'
    mutate "no repeated-target guard" 'if (next === target() && next !== "done") return;' 'if (next === "never") return;'
    mutate "one-shot never hands over" 'clip = then ?? "idle";' 'clip = clip;'
    git diff --quiet -- "$src" || { echo "C3-fail: $src not restored"; exit 1; }
    echo "C3-ok: 3/3 mutations killed, $src restored" ;;
  C4)
    run="${2:?run id}"
    jobs=$(gh run view "$run" --json jobs --jq '.jobs[]|"\(.name)=\(.conclusion)"')
    echo "$jobs"
    for j in hq-ui-test "test (ubuntu-latest)" "test (macos-latest)" "test (windows-latest)"; do
      echo "$jobs" | grep -qx "$j=success" || { echo "C4-fail: $j not success"; exit 1; }
    done
    echo "C4-ok: hq-ui-test + test on 3 OS success (run $run)" ;;
  *) echo "usage: check.sh <C1|C2|C3|C4> [run-id]" >&2; exit 2 ;;
esac
